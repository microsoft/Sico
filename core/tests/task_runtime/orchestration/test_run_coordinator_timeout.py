from __future__ import annotations

import asyncio

import pytest

from app.biz.task_runtime.domain.models import (
    CapabilityDispatch,
    ErrorClass,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.orchestration.run_coordinator import RunCoordinator
from app.biz.task_runtime.orchestration.run_support import RunClock
from app.biz.task_runtime.storage.file_store import FileRunStore


class _BlockingExecutor:
    def __init__(self) -> None:
        self.cancelled = asyncio.Event()

    async def run(self, run: TaskRun, store: FileRunStore):
        await store.claim_run(run.run_id, "blocking-executor")
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise


class _Progress:
    async def run_stage(self, ctx: object, run: TaskRun, *, stage: str) -> None:
        return None

    async def mirror_run_progress(self, ctx: object, run: TaskRun, stop: asyncio.Event) -> None:
        await stop.wait()


def _run() -> TaskRun:
    return TaskRun(
        run_id="run-timeout",
        batch_id="batch-timeout",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=TaskSpec(
            task_id="timeout",
            title="Timeout",
            dispatch=CapabilityDispatch(capability_id="builtin:echo"),
        ),
        execution_policy=TaskExecutionPolicy(timeout_seconds=1, executor="in_process"),
        idempotency_key="timeout",
        executor="in_process",
        queued_at=1,
    )


@pytest.mark.asyncio
async def test_execution_timeout_cancels_executor_and_persists_timed_out_result(tmp_path, monkeypatch) -> None:
    async def _never_cancelled(ctx: object) -> bool:
        await asyncio.Event().wait()
        return False

    import app.biz.task_runtime.orchestration.run_coordinator as coordinator_module

    monkeypatch.setattr(coordinator_module, "wait_for_plan_cancelled", _never_cancelled)
    run = _run()
    store = FileRunStore(tmp_path)
    await store.create_run(run)
    executor = _BlockingExecutor()
    coordinator = RunCoordinator(store, executor, _Progress(), sandbox=None)  # type: ignore[arg-type]

    result = await coordinator._execute_with_progress(None, run, RunClock())  # type: ignore[arg-type]

    assert executor.cancelled.is_set()
    assert result.status == TaskStatus.TIMED_OUT
    assert result.error_class == ErrorClass.TIMEOUT
    detail = await store.get_task_detail(run.run_id, "summary")
    assert detail.result is not None
    assert detail.result.status == TaskStatus.TIMED_OUT
    assert detail.run.status == TaskStatus.TIMED_OUT
