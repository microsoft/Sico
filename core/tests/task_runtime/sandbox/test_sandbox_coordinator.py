import logging
import time

import pytest

from app.biz.task_runtime.context import TurnContext
from app.biz.task_runtime.domain.models import (
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
    CapabilityDispatch,
)
from app.biz.task_runtime.sandbox.coordinator import SandboxCoordinator


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
            type="emulator",
            endpoint="127.0.0.1:5555",
            acquired_at=int(time.time() * 1000),
        )

    async def reset(self, lease: SandboxLeaseRef) -> None:
        raise RuntimeError("reset cooling down")

    async def heartbeat(self, lease: SandboxLeaseRef) -> None:
        return None

    async def release(self, lease: SandboxLeaseRef, outcome: str) -> None:
        return None


class _RecordingLeaseManager:
    def __init__(self) -> None:
        self.reserve_calls: list[tuple[str, str]] = []
        self.acquire_calls: list[str] = []
        self.reset_calls: list[str] = []
        self.release_calls: list[tuple[str, str]] = []
        self.active_lease_ids: set[str] = set()

    async def reserve(self, req: SandboxRequirement, run_id: str) -> ReservationToken:
        self.reserve_calls.append((req.type, run_id))
        return ReservationToken(
            reservation_id=f"reservation-{run_id}",
            run_id=run_id,
            type=req.type,
            expires_at=int((time.time() + 30) * 1000),
        )

    async def acquire(self, token: ReservationToken) -> SandboxLeaseRef:
        sandbox_id = f"sandbox-{token.run_id}"
        self.acquire_calls.append(token.reservation_id)
        self.active_lease_ids.add(sandbox_id)
        return SandboxLeaseRef(
            sandbox_id=sandbox_id,
            type=token.type,
            endpoint="127.0.0.1:5555",
            acquired_at=int(time.time() * 1000),
        )

    async def reset(self, lease: SandboxLeaseRef) -> None:
        self.reset_calls.append(lease.sandbox_id)

    async def heartbeat(self, lease: SandboxLeaseRef) -> None:
        return None

    async def release(self, lease: SandboxLeaseRef, outcome: str) -> None:
        self.release_calls.append((lease.sandbox_id, outcome))
        self.active_lease_ids.discard(lease.sandbox_id)


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
        dispatch=CapabilityDispatch(capability_id="builtin:echo"),
        required_sandbox="android",
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

    with caplog.at_level(logging.WARNING, logger="app.biz.task_runtime.sandbox.coordinator"):
        await coordinator.acquire(_ctx(), run)

    assert run.sandbox is not None
    assert progress.stages == [
        SANDBOX_STAGE_CAPACITY_WAIT,
        SANDBOX_STAGE_ACQUIRE,
        SANDBOX_STAGE_RESET,
        SANDBOX_STAGE_READY,
    ]
    assert any("sandbox acquire reset failed; continuing" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_sandbox_lifecycle_baseline_accounts_for_acquire_and_release() -> None:
    store = _FakeStore()
    progress = _FakeProgress()
    lease_manager = _RecordingLeaseManager()
    coordinator = SandboxCoordinator(store, progress, lease_manager=lease_manager)
    run = _run()

    await coordinator.acquire(_ctx(), run)
    released = await coordinator.release(_ctx(), run, "clean")

    assert released is True
    assert lease_manager.reserve_calls == [("android", "run-1")]
    assert lease_manager.acquire_calls == ["reservation-run-1"]
    assert lease_manager.reset_calls == ["sandbox-run-1"]
    assert lease_manager.release_calls == [("sandbox-run-1", "clean")]
    assert lease_manager.active_lease_ids == set()
    assert run.sandbox_released is True
    assert run.lease_outcome == "clean"


@pytest.mark.asyncio
async def test_sandbox_lifecycle_baseline_accounts_for_stale_release() -> None:
    lease_manager = _RecordingLeaseManager()
    coordinator = SandboxCoordinator(_FakeStore(), _FakeProgress(), lease_manager=lease_manager)
    run = _run()
    run.sandbox = SandboxLeaseRef(
        sandbox_id="sandbox-stale",
        type="android",
        endpoint="127.0.0.1:5555",
        acquired_at=int(time.time() * 1000),
    )
    run.lease_outcome = "dirty"
    lease_manager.active_lease_ids.add(run.sandbox.sandbox_id)

    released = await coordinator.release_stale(run)

    assert released is True
    assert lease_manager.release_calls == [("sandbox-stale", "dirty")]
    assert lease_manager.active_lease_ids == set()
    assert run.sandbox_released is True
    assert run.lease_outcome == "dirty"
