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

import logging
import time

import pytest

from app.biz.task_runtime.context import TurnContext
from app.biz.task_runtime.models import (
    ReservationToken,
    SANDBOX_STAGE_ACQUIRE,
    SANDBOX_STAGE_CAPACITY_WAIT,
    SANDBOX_STAGE_READY,
    SANDBOX_STAGE_RESET,
    SandboxLeaseRef,
    SandboxRequirement,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
    ToolDispatch,
)
from app.biz.task_runtime.sandbox_coordinator import SandboxCoordinator


class _FakePlanEditor:
    async def is_plan_cancelled(self) -> bool:
        return False


class _FakeStore:
    def __init__(self) -> None:
        self.runs: list[TaskRun] = []

    async def update_run(self, run: TaskRun) -> None:
        self.runs.append(run.model_copy(deep=True))


class _FakeProgress:
    def __init__(self) -> None:
        self.stages: list[str] = []
        self.deliverables: list[object] = []

    async def run_stage(self, ctx: TurnContext, run: TaskRun, *, stage: str) -> None:
        self.stages.append(stage)

    async def publish_deliverable(self, ctx: TurnContext, tool_call_id: int, deliverable: object, *, replace_key=None) -> None:
        self.deliverables.append(deliverable)


class _ResetFailingLeaseManager:
    async def reserve(self, req: SandboxRequirement, run_id: str) -> ReservationToken:
        return ReservationToken(
            reservation_id="reservation-1",
            run_id=run_id,
            type=req.type,
            expires_at=int((time.time() + 30) * 1000),
        )

    async def acquire(self, token: ReservationToken) -> SandboxLeaseRef:
        return SandboxLeaseRef(
            sandbox_id="sandbox-1",
            type=token.type,
            endpoint="127.0.0.1:5555",
            acquired_at=int(time.time() * 1000),
        )

    async def reset(self, lease: SandboxLeaseRef) -> None:
        raise RuntimeError("reset cooling down")

    async def heartbeat(self, lease: SandboxLeaseRef) -> None:
        return None

    async def release(self, lease: SandboxLeaseRef, outcome: str) -> None:
        return None


def _ctx() -> TurnContext:
    return TurnContext(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        conversation_id=1,
        turn_id=1,
        plan_editor=_FakePlanEditor(),
    )


def _run() -> TaskRun:
    spec = TaskSpec(
        task_id="task-1",
        title="Task 1",
        dispatch=ToolDispatch(tool_name="echo"),
        required_sandbox="emulator",
    )
    return TaskRun(
        run_id="run-1",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        parent_tool_call_id=10,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key="task-1",
        executor="in_process",
        queued_at=int(time.time() * 1000),
    )


@pytest.mark.asyncio
async def test_acquire_reset_failure_warns_and_continues(caplog) -> None:
    store = _FakeStore()
    progress = _FakeProgress()
    coordinator = SandboxCoordinator(
        store,
        progress,
        lease_manager=_ResetFailingLeaseManager(),
    )
    run = _run()

    with caplog.at_level(logging.WARNING, logger="app.biz.task_runtime.sandbox_coordinator"):
        await coordinator.acquire(_ctx(), run)

    assert run.sandbox is not None
    assert progress.stages == [
        SANDBOX_STAGE_CAPACITY_WAIT,
        SANDBOX_STAGE_ACQUIRE,
        SANDBOX_STAGE_RESET,
        SANDBOX_STAGE_READY,
    ]
    assert any("sandbox acquire reset failed; continuing" in record.message for record in caplog.records)
