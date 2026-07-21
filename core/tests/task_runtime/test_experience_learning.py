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

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.event_bus import BatchStateTransition, RuntimeEventBus
from app.biz.task_runtime.models import BatchStatus, SkillDispatch, TaskStatus, ToolDispatch
from app.biz.task_runtime.subscribers import experience_learning
from app.experiences.integrations.dw_registry import register_dw_parser


@pytest.fixture(autouse=True)
def _enable_experiences(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPERIENCES_ENABLED", "true")


@pytest.fixture
def scheduled(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Capture run_ids that would be dispatched, without running any background task."""
    captured: list[str] = []

    def _capture(run, result) -> None:
        captured.append(run.run_id)

    monkeypatch.setattr(experience_learning, "_schedule_dispatch", _capture)
    # Drop any state left over from a previous test's per_batch buffering.
    experience_learning._PENDING_BATCH_RUNS.clear()
    return captured


_TEST_SKILL = "test-dw-learning-skill"


def _make_run(
    *,
    skill_name: str | None = _TEST_SKILL,
    run_id: str = "run-1",
    batch_id: str = "batch-1",
    conv: int = 100,
    turn: int = 200,
    project: int = 7,
    agent_instance: int = 42,
    username: str = "alice",
) -> SimpleNamespace:
    dispatch = SkillDispatch(skill_name=skill_name) if skill_name is not None else ToolDispatch(tool_name="echo")
    spec = SimpleNamespace(dispatch=dispatch, task_id="task-X")
    return SimpleNamespace(
        run_id=run_id,
        batch_id=batch_id,
        parent_conversation_id=conv,
        parent_turn_id=turn,
        project_id=project,
        agent_instance_id=agent_instance,
        username=username,
        spec=spec,
    )


def _make_result(status: TaskStatus = TaskStatus.COMPLETED, output: str = "{}") -> SimpleNamespace:
    return SimpleNamespace(status=status, output=output)


# ---------------------------------------------------------------------------
# inline per-run trigger (on_run_terminal): mode gating + per_batch buffering
# ---------------------------------------------------------------------------


def test_per_run_schedules_dispatch(scheduled: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_run")

    experience_learning.on_run_terminal(_make_run(run_id="run-1"), _make_result())

    assert scheduled == ["run-1"]


def test_disabled_mode_is_noop(scheduled: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EPE_TRIGGER_MODE", "disabled")

    experience_learning.on_run_terminal(_make_run(), _make_result())

    assert scheduled == []


def test_experiences_disabled_is_noop(scheduled: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPERIENCES_ENABLED", "false")
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_run")

    experience_learning.on_run_terminal(_make_run(), _make_result())

    assert scheduled == []


def test_non_skill_run_is_noop(scheduled: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_run")

    # skill_name=None builds a ToolDispatch run -> _skill_name returns "" -> no-op.
    experience_learning.on_run_terminal(_make_run(skill_name=None), _make_result())

    assert scheduled == []


def test_per_batch_buffers_then_drains_on_batch_terminal(
    scheduled: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_batch")
    bus = RuntimeEventBus()
    experience_learning.register(bus)

    experience_learning.on_run_terminal(_make_run(run_id="run-a", batch_id="batch-9"), _make_result())
    experience_learning.on_run_terminal(
        _make_run(run_id="run-b", batch_id="batch-9"),
        _make_result(status=TaskStatus.FAILED),
    )
    # Buffered, not yet dispatched.
    assert scheduled == []

    bus.publish(BatchStateTransition(batch_id="batch-9", from_status=BatchStatus.RUNNING, to_status=BatchStatus.PARTIAL))

    assert scheduled == ["run-a", "run-b"]


def test_no_running_loop_is_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    # In a synchronous context with no running event loop, the real
    # _schedule_dispatch must no-op without raising and without creating a task.
    monkeypatch.setenv("EPE_TRIGGER_MODE", "per_run")
    experience_learning._PENDING_BATCH_RUNS.clear()
    experience_learning._BACKGROUND_TASKS.clear()

    experience_learning.on_run_terminal(_make_run(), _make_result())

    assert experience_learning._BACKGROUND_TASKS == set()


@pytest.mark.asyncio
async def test_batch_terminal_clears_generating_without_learning(monkeypatch: pytest.MonkeyPatch) -> None:
    # Even with no learning (EPE off), a skill batch's terminal must emit a
    # clearing PLAYBOOK_INGESTION so the "generating experience" placeholder resolves.
    monkeypatch.setenv("EXPERIENCES_ENABLED", "false")
    experience_learning._BATCH_META.clear()
    experience_learning._BATCH_TASKS.clear()

    emitted: list[tuple] = []
    import app.experiences.service as svc_module

    monkeypatch.setattr(svc_module, "emit_playbook_ingestion", lambda *a: emitted.append(a))

    bus = RuntimeEventBus()
    experience_learning.register(bus)

    experience_learning.on_run_terminal(
        _make_run(batch_id="batch-c", conv=11, turn=22, agent_instance=5),
        _make_result(),
    )
    assert experience_learning._BATCH_META["batch-c"] == (11, 22, 5)

    bus.publish(BatchStateTransition(batch_id="batch-c", from_status=BatchStatus.RUNNING, to_status=BatchStatus.PARTIAL))
    await asyncio.gather(*list(experience_learning._BACKGROUND_TASKS))

    assert emitted == [(11, 22, 0, 5)]
    assert "batch-c" not in experience_learning._BATCH_META


# ---------------------------------------------------------------------------
# dispatch core (_dispatch): parser lookup + filtering + add_playbook fan-out
# ---------------------------------------------------------------------------


def _meaningful_trajectory(task: str = "t"):
    # _has_meaningful_evidence requires > 2 chronological steps.
    return SimpleNamespace(task=task, total_steps=3, chronological_steps=[1, 2, 3])


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


def _register_parser(trajectories: list) -> None:
    def _parser(run_dir, run, result):
        return list(trajectories)

    register_dw_parser(_TEST_SKILL, _parser)


@pytest.mark.asyncio
async def test_dispatch_calls_add_playbook_per_meaningful_trajectory(monkeypatch: pytest.MonkeyPatch) -> None:
    trajectory = _meaningful_trajectory()
    _register_parser([trajectory, trajectory])
    calls = _stub_add_playbook(monkeypatch)

    await experience_learning._dispatch(_make_run(), _make_result())

    assert len(calls) == 2
    assert calls[0] == {
        "trajectory_data": trajectory,
        "project_id": 7,
        "agent_instance_id": 42,
        "conversation_id": 100,
        "turn_id": 200,
    }


@pytest.mark.asyncio
async def test_dispatch_filters_trajectories_with_too_few_steps(monkeypatch: pytest.MonkeyPatch) -> None:
    weak = SimpleNamespace(task="t", total_steps=1, chronological_steps=[1])
    _register_parser([weak])
    calls = _stub_add_playbook(monkeypatch)

    await experience_learning._dispatch(_make_run(), _make_result(output=""))

    assert calls == []


@pytest.mark.asyncio
async def test_dispatch_skips_unregistered_skill(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _stub_add_playbook(monkeypatch)

    await experience_learning._dispatch(_make_run(skill_name="totally-unknown-skill"), _make_result(output=""))

    assert calls == []


@pytest.mark.asyncio
async def test_dispatch_skips_non_skill_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    _register_parser([_meaningful_trajectory()])
    calls = _stub_add_playbook(monkeypatch)

    # skill_name=None builds a ToolDispatch run -> _skill_name returns "" -> no-op.
    await experience_learning._dispatch(_make_run(skill_name=None), _make_result(output=""))

    assert calls == []


@pytest.mark.asyncio
async def test_dispatch_swallows_add_playbook_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _register_parser([_meaningful_trajectory("a"), _meaningful_trajectory("b")])
    calls = _stub_add_playbook(monkeypatch, fail=True)

    # Must not raise; both trajectories are attempted even though each fails.
    await experience_learning._dispatch(_make_run(), _make_result(output=""))

    assert len(calls) == 2


@pytest.mark.asyncio
async def test_dispatch_swallows_parser_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(run_dir, run, result):
        raise RuntimeError("parser blew up")

    register_dw_parser(_TEST_SKILL, _boom)
    calls = _stub_add_playbook(monkeypatch)

    await experience_learning._dispatch(_make_run(), _make_result(output=""))

    assert calls == []


# ---------------------------------------------------------------------------
# _has_meaningful_evidence: step count / declared verdict / raw-trace branches
# ---------------------------------------------------------------------------


def test_meaningful_evidence_raw_trace_threshold() -> None:
    long_trace = SimpleNamespace(chronological_steps=[], judge_result=None, raw_trace="x" * 201)
    short_trace = SimpleNamespace(chronological_steps=[], judge_result=None, raw_trace="x" * 200)
    assert experience_learning._has_meaningful_evidence(long_trace) is True
    assert experience_learning._has_meaningful_evidence(short_trace) is False


def test_meaningful_evidence_declared_verdict_short_run() -> None:
    trajectory = SimpleNamespace(chronological_steps=[1], judge_result={"verdict": False, "reasoning": "x"}, raw_trace="")
    assert experience_learning._has_meaningful_evidence(trajectory) is True


def test_meaningful_evidence_thin_run_dropped() -> None:
    trajectory = SimpleNamespace(chronological_steps=[1, 2], judge_result=None, raw_trace="")
    assert experience_learning._has_meaningful_evidence(trajectory) is False
