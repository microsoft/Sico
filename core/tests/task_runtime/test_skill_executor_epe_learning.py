# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

"""Regression test: experience learning fires from ``SkillExecutor.run`` for
every skill run, WITHOUT relying on any in-process ``RunStateTransition`` event.

This is the test the old event-bus subscriber suite lacked: it drives a real
``SkillExecutor.run`` with a store whose ``write_result`` publishes NO bus event
(mirroring the production backend-backed ``DBRunStore``, which transitions runs
out-of-process). The old learning trigger subscribed to ``RunStateTransition``,
which that store never publishes, so learning silently never fired in
production while the subscriber tests stayed green by hand-publishing events.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.artifact_store import FileArtifactStore
from app.biz.task_runtime.executors.skill_executor import SkillExecutor
from app.biz.task_runtime.models import (
    FencingToken,
    SkillDispatch,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.skill_loader import SkillLoader
from app.biz.task_runtime.subscribers import experience_learning
from app.biz.task_runtime.workspace import reset_workspace_layout, set_workspace_layout
from app.experiences.integrations.dw_registry import register_dw_parser

_SKILL = "epe-regression-skill"


class _NonPublishingStore:
    """RunStore subset that persists results but publishes NO bus event.

    Mirrors the production DBRunStore: the run state transition happens in the
    backend over reverse gRPC, so no in-process ``RunStateTransition`` is ever
    emitted. If learning depended on that event it would never fire here.
    """

    def __init__(self) -> None:
        self.results: dict[str, TaskResult] = {}

    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken:
        return FencingToken(run_id=run_id, token=f"{worker_id}-tok", issued_at=0)

    async def heartbeat(self, run_id: str, token: FencingToken) -> None:
        return None

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        self.results[run_id] = result


class _FakeWorkspaceLayout:
    def __init__(self, root: Path) -> None:
        self._root = root

    def workspace_path(self, agent_instance_id: int, username: str) -> Path:
        return self._root


@pytest.fixture(autouse=True)
def _workspace_layout(tmp_path, request) -> None:
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "workspace"))
    request.addfinalizer(lambda: reset_workspace_layout(token))


@pytest.fixture(autouse=True)
def _clear_background_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPERIENCES_ENABLED", "true")
    experience_learning._BACKGROUND_TASKS.clear()
    experience_learning._PENDING_BATCH_RUNS.clear()


def _meaningful_trajectory():
    # _has_meaningful_evidence requires > 2 chronological steps.
    return SimpleNamespace(task="t", total_steps=3, chronological_steps=[1, 2, 3])


def _skill_run(skill_name: str = _SKILL) -> TaskRun:
    spec = TaskSpec(
        task_id="t-skill",
        title="Run a skill",
        dispatch=SkillDispatch(skill_name=skill_name, action_name="run"),
        args={},
    )
    return TaskRun(
        run_id="run-skill",
        batch_id="batch-1",
        parent_conversation_id=5,
        parent_turn_id=6,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=7,
        project_id=11,
        spec=spec,
        execution_policy=TaskExecutionPolicy(timeout_seconds=60),
        idempotency_key=spec.task_id,
        executor="local_subprocess",
        queued_at=int(time.time() * 1000),
    )


def _canned_result(run: TaskRun) -> TaskResult:
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary="done",
        output='{"event": "operator", "thought": "tap", "action": "tap"}',
    )


def _executor(tmp_path: Path) -> SkillExecutor:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    # _run_skill is monkeypatched in every test, so the backend is never used.
    backend = SimpleNamespace(open_session=lambda **_kwargs: None)
    return SkillExecutor(
        SkillLoader(workspace),
        artifact_store=FileArtifactStore(tmp_path / "artifacts"),
        sandbox_backend=backend,
    )


def _stub_add_playbook(monkeypatch: pytest.MonkeyPatch, *, fail: bool = False) -> list[dict]:
    calls: list[dict] = []

    async def fake_add_playbook(**kwargs):
        calls.append(kwargs)
        if fail:
            raise RuntimeError("simulated add_playbook failure")
        return {"skipped": False}

    import app.experiences.service as svc_module

    monkeypatch.setattr(svc_module, "add_playbook", fake_add_playbook)
    return calls


async def _drain_background_tasks() -> None:
    while experience_learning._BACKGROUND_TASKS:
        await asyncio.gather(*list(experience_learning._BACKGROUND_TASKS), return_exceptions=True)


@pytest.mark.asyncio
async def test_run_dispatches_learning_for_skill_run(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_run")
    register_dw_parser(_SKILL, lambda run_dir, run, result: [_meaningful_trajectory()])
    calls = _stub_add_playbook(monkeypatch)

    run = _skill_run()
    canned = _canned_result(run)
    monkeypatch.setattr(SkillExecutor, "_run_skill", lambda self, r: _async_return(canned))

    # The store publishes NO RunStateTransition, yet learning must still fire.
    result = await _executor(tmp_path).run(run, _NonPublishingStore())
    assert result is canned
    await _drain_background_tasks()

    assert len(calls) == 1
    assert calls[0]["project_id"] == 11
    assert calls[0]["agent_instance_id"] == 7
    assert calls[0]["conversation_id"] == 5
    assert calls[0]["turn_id"] == 6


@pytest.mark.asyncio
async def test_run_does_not_dispatch_for_unregistered_skill(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_run")
    calls = _stub_add_playbook(monkeypatch)

    run = _skill_run(skill_name="unregistered-skill-xyz")
    canned = _canned_result(run)
    monkeypatch.setattr(SkillExecutor, "_run_skill", lambda self, r: _async_return(canned))

    await _executor(tmp_path).run(run, _NonPublishingStore())
    await _drain_background_tasks()

    assert calls == []


@pytest.mark.asyncio
async def test_run_learning_failure_does_not_break_run(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_run")
    register_dw_parser(_SKILL, lambda run_dir, run, result: [_meaningful_trajectory()])
    _stub_add_playbook(monkeypatch, fail=True)

    run = _skill_run()
    canned = _canned_result(run)
    monkeypatch.setattr(SkillExecutor, "_run_skill", lambda self, r: _async_return(canned))

    # A learning failure must not break the run.
    result = await _executor(tmp_path).run(run, _NonPublishingStore())
    assert result is canned
    await _drain_background_tasks()


async def _async_return(value):
    return value
