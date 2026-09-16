from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.domain.models import BatchStatus, TaskResult, TaskStatus
from app.biz.task_runtime.orchestration.recovery import StaleReconciler
from app.biz.task_runtime.presentation.port import BatchProjectionOptions


class _Store:
    def __init__(self, run, result: TaskResult) -> None:
        self.run = run
        self.result = result

    async def list_batch_runs(self, batch_id: str):
        assert batch_id == "batch-1"
        return [self.run]

    async def get_task_detail(self, run_id: str, view: str):
        assert run_id == self.run.run_id
        assert view == "summary"
        return SimpleNamespace(result=self.result)


class _RecordingProgress:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def sync_batch_projection(
        self,
        ctx,
        batch,
        runs,
        results,
        *,
        options: BatchProjectionOptions | None = None,
    ) -> bool:
        self.calls.append(
            {
                "ctx": ctx,
                "batch": batch,
                "runs": runs,
                "results": results,
                "options": options,
            }
        )
        return True


@pytest.mark.asyncio
async def test_terminal_batch_recovery_uses_one_atomic_projection_reconciliation(tmp_path: Path) -> None:
    run = SimpleNamespace(
        run_id="run-1",
        username="alice@example.com",
        agent_instance_id=1,
        agent_id="agent",
        project_id=7,
        status=TaskStatus.COMPLETED,
    )
    result = TaskResult(
        run_id=run.run_id,
        task_id="task-1",
        status=TaskStatus.COMPLETED,
        title="Recovered task",
        summary="done",
    )
    batch = SimpleNamespace(
        batch_id="batch-1",
        parent_tool_call_id=4,
        parent_conversation_id=2,
        parent_turn_id=3,
        status=BatchStatus.COMPLETED,
        join_strategy="partial_ok",
    )
    ctx = SimpleNamespace(
        username=run.username,
        agent_instance_id=run.agent_instance_id,
        conversation_id=batch.parent_conversation_id,
        turn_id=batch.parent_turn_id,
    )
    progress = _RecordingProgress()
    reconciler = StaleReconciler(
        store=_Store(run, result),
        sandbox=None,
        progress=progress,
        batch_dir=lambda batch_id: tmp_path / batch_id,
    )

    await reconciler._publish_recovered_terminal_batch(ctx, batch)

    assert progress.calls == [
        {
            "ctx": ctx,
            "batch": batch,
            "runs": [run],
            "results": [result],
            "options": BatchProjectionOptions.recovery(),
        }
    ]
