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
from typing import Any

import pytest

import app.experiences.service as svc_module
from app.experiences.service import ExperienceService


class _RunnerStub:
    """Fake ExperienceRunner whose ``learn_from_trajectory`` blocks until released.

    Used to observe whether two concurrent ``ExperienceService.learn_from_trajectory``
    calls overlap or run serially.
    """

    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0
        self.release = asyncio.Event()
        self.playbook = SimpleNamespace(stats=lambda: {}, prune=lambda *a, **k: 0)

    async def learn_from_trajectory(
        self,
        trajectory: Any,
        progress: str | None = None,
    ) -> dict[str, Any]:
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await self.release.wait()
        finally:
            self.active -= 1
        return {"operations_applied": 0}


def _build_service(monkeypatch: pytest.MonkeyPatch) -> ExperienceService:
    monkeypatch.setattr(svc_module, "EXPERIENCES_ENABLED", True)
    service = ExperienceService()
    # Skip on-disk save; the lock semantics under test do not depend on it.
    monkeypatch.setattr(service, "_store", SimpleNamespace(save=lambda playbook, aid: None))
    return service


def _install_runner(service: ExperienceService, key: int | None, runner: _RunnerStub) -> None:
    service._runners[key] = runner


@pytest.mark.asyncio
async def test_same_agent_instance_serializes(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _build_service(monkeypatch)
    runner = _RunnerStub()
    _install_runner(service, 42, runner)

    trajectory = SimpleNamespace(task="t")
    task1 = asyncio.create_task(service.learn_from_trajectory(trajectory, agent_instance_id=42))
    task2 = asyncio.create_task(service.learn_from_trajectory(trajectory, agent_instance_id=42))

    # Let both tasks reach their internal await points.
    await asyncio.sleep(0.05)
    # If serialized, only one runner.learn_from_trajectory is active at a time.
    assert runner.active == 1, "lock should let only one call enter at a time"

    # Release the first; the second can now proceed.
    runner.release.set()
    await asyncio.gather(task1, task2)
    assert runner.max_active == 1


@pytest.mark.asyncio
async def test_different_agent_instances_run_in_parallel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _build_service(monkeypatch)
    runner_a = _RunnerStub()
    runner_b = _RunnerStub()
    _install_runner(service, 1, runner_a)
    _install_runner(service, 2, runner_b)

    trajectory = SimpleNamespace(task="t")
    task_a = asyncio.create_task(service.learn_from_trajectory(trajectory, agent_instance_id=1))
    task_b = asyncio.create_task(service.learn_from_trajectory(trajectory, agent_instance_id=2))

    await asyncio.sleep(0.05)
    # Different agent_instance_ids → independent locks → both should be active.
    assert runner_a.active == 1
    assert runner_b.active == 1

    runner_a.release.set()
    runner_b.release.set()
    await asyncio.gather(task_a, task_b)
