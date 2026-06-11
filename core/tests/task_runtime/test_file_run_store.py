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

from pathlib import Path

import pytest

from app.biz.task_runtime.models import (
    BatchRecord,
    BatchStatus,
    ErrorClass,
    SkillDispatch,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.store import FileRunStore, StaleWorkerError


@pytest.mark.asyncio
async def test_file_run_store_persists_batch_run_and_result(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    batch = _batch()
    run = _run(tmp_path)

    await store.create_batch(batch)
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    result = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary="done",
    )
    await store.write_result(run.run_id, result, token)

    loaded_run = await store.get_run(run.run_id)
    detail = await store.get_task_detail(run.run_id, "summary")

    assert loaded_run.status == TaskStatus.COMPLETED
    assert detail.result is not None
    assert detail.result.summary == "done"


@pytest.mark.asyncio
async def test_file_run_store_rejects_claim_while_running(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)

    await store.create_batch(_batch())
    await store.create_run(run)
    await store.claim_run(run.run_id, "worker-1")

    with pytest.raises(StaleWorkerError, match="cannot be claimed"):
        await store.claim_run(run.run_id, "worker-2")


@pytest.mark.asyncio
async def test_file_run_store_rejects_claim_after_terminal_result(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)

    await store.create_batch(_batch())
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    await store.write_result(
        run.run_id,
        TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.COMPLETED,
            title=run.spec.title,
            summary="done",
        ),
        token,
    )

    with pytest.raises(StaleWorkerError, match="cannot be claimed"):
        await store.claim_run(run.run_id, "worker-2")


@pytest.mark.asyncio
async def test_file_run_store_set_progress_records_latest_and_truncates(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)

    await store.create_batch(_batch())
    await store.create_run(run)

    await store.set_progress(run.run_id, "first", ts=100)
    snapshot = await store.get_run(run.run_id)
    assert snapshot.latest_progress_message == "first"
    assert snapshot.latest_progress_at == 100

    # Newer ts overwrites.
    await store.set_progress(run.run_id, "second", ts=200)
    snapshot = await store.get_run(run.run_id)
    assert snapshot.latest_progress_message == "second"
    assert snapshot.latest_progress_at == 200

    # Stale ts is dropped (replay-safe).
    await store.set_progress(run.run_id, "stale", ts=150)
    snapshot = await store.get_run(run.run_id)
    assert snapshot.latest_progress_message == "second"
    assert snapshot.latest_progress_at == 200

    # Oversized message is truncated to 1000 chars.
    huge = "x" * 1500
    await store.set_progress(run.run_id, huge, ts=300)
    snapshot = await store.get_run(run.run_id)
    assert len(snapshot.latest_progress_message) == 1000


@pytest.mark.asyncio
async def test_file_run_store_heartbeat_batch_bumps_active_runs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.biz.task_runtime.store as store_module

    store = FileRunStore(tmp_path)
    await store.create_batch(_batch())
    queued = _run(tmp_path, run_id="run-queued", idempotency_key="key-q")
    running = _run(tmp_path, run_id="run-running", idempotency_key="key-r")
    await store.create_run(queued)
    await store.create_run(running)
    token = await store.claim_run(running.run_id, "worker-1")
    running_before = (await store.get_run(running.run_id)).heartbeat_at

    # Advance the clock so the bump is observable regardless of wall-clock speed.
    bumped_ms = (running_before or 0) + 10_000
    monkeypatch.setattr(store_module, "_now_ms", lambda: bumped_ms)
    await store.heartbeat_batch("batch-1")

    queued_after = await store.get_run(queued.run_id)
    running_after = await store.get_run(running.run_id)
    # Both still-active runs ride the single batch-level liveness signal, so the
    # owning process keeps a long-running run alive as well as its queued siblings.
    assert queued_after.status == TaskStatus.QUEUED
    assert queued_after.heartbeat_at == bumped_ms
    assert running_after.heartbeat_at == bumped_ms
    # The fencing token for the running run is untouched by the batch heartbeat.
    assert running_after.fencing_token == token.token


async def _settle_failed(store: FileRunStore, run: TaskRun) -> None:
    token = await store.claim_run(run.run_id, "worker-1")
    await store.write_result(
        run.run_id,
        TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.FAILED,
            title=run.spec.title,
            summary="boom",
            error_class=ErrorClass.TRANSIENT,
            error_message="boom",
        ),
        token,
    )


@pytest.mark.asyncio
async def test_file_run_store_reopen_for_retry_requeues_same_row(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    await _settle_failed(store, run)

    failed = await store.get_run(run.run_id)
    assert failed.status == TaskStatus.FAILED
    assert failed.attempt == 1

    next_run = failed.model_copy(
        update={
            "attempt": 2,
            "status": TaskStatus.QUEUED,
            "worker_id": None,
            "fencing_token": "",
            "started_at": None,
            "ended_at": None,
            "last_error_class": ErrorClass.TRANSIENT,
            "last_error": "boom",
        }
    )
    await store.reopen_run_for_retry(next_run, expected_attempt=1)

    reopened = await store.get_run(run.run_id)
    # Same row, not a sibling — keeps batch_item_index -> run_id 1:1 so counts hold.
    assert reopened.run_id == run.run_id
    assert reopened.status == TaskStatus.QUEUED
    assert reopened.attempt == 2
    # Prior terminal result is dropped so finalization never reads it back.
    detail = await store.get_task_detail(run.run_id, "summary")
    assert detail.result is None
    # And the requeued run is claimable again, so the retry can actually execute.
    await store.claim_run(run.run_id, "worker-2")


@pytest.mark.asyncio
async def test_file_run_store_reopen_rejects_attempt_mismatch(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    await _settle_failed(store, run)

    next_run = (await store.get_run(run.run_id)).model_copy(update={"attempt": 2, "status": TaskStatus.QUEUED})
    # expected_attempt=0 does not match the stored attempt (1): a stale/duplicate
    # reopen must not resurrect the run.
    with pytest.raises(StaleWorkerError, match="cannot be reopened"):
        await store.reopen_run_for_retry(next_run, expected_attempt=0)
    assert (await store.get_run(run.run_id)).status == TaskStatus.FAILED


@pytest.mark.asyncio
async def test_file_run_store_reopen_rejects_completed_run(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    await store.write_result(
        run.run_id,
        TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.COMPLETED,
            title=run.spec.title,
            summary="done",
        ),
        token,
    )

    next_run = (await store.get_run(run.run_id)).model_copy(update={"attempt": 2, "status": TaskStatus.QUEUED})
    # COMPLETED is absorbing — never reopened, even at the matching attempt.
    with pytest.raises(StaleWorkerError, match="cannot be reopened"):
        await store.reopen_run_for_retry(next_run, expected_attempt=1)


@pytest.mark.asyncio
async def test_file_run_store_reopen_rejects_malformed_payload(tmp_path: Path) -> None:
    # The incoming next-attempt payload must be a clean queued row (mirrors the
    # backend's ensureReopenPayload). Each malformed variant is rejected.
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    await _settle_failed(store, run)

    # A baseline payload that is valid in every dimension except the one each
    # variant mutates, so each assertion exercises exactly its own guard.
    base = (await store.get_run(run.run_id)).model_copy(
        update={
            "attempt": 2,
            "status": TaskStatus.QUEUED,
            "worker_id": None,
            "fencing_token": "",
            "started_at": None,
            "ended_at": None,
        }
    )
    bad_payloads = {
        "not-queued": base.model_copy(update={"status": TaskStatus.FAILED}),
        "wrong-attempt": base.model_copy(update={"attempt": 3}),
        "stale-worker": base.model_copy(update={"worker_id": "worker-9"}),
        "stale-fencing": base.model_copy(update={"fencing_token": "tok"}),
        "stale-started": base.model_copy(update={"started_at": 123}),
        "changed-batch-item-index": base.model_copy(update={"batch_item_index": 9}),
        "changed-parent-conversation": base.model_copy(update={"parent_conversation_id": 999}),
        "changed-parent-turn": base.model_copy(update={"parent_turn_id": 999}),
        "changed-task-id": base.model_copy(update={"spec": base.spec.model_copy(update={"task_id": "other"})}),
    }
    for label, payload in bad_payloads.items():
        with pytest.raises(StaleWorkerError):
            await store.reopen_run_for_retry(payload, expected_attempt=1)
        # The stored row stays FAILED — a malformed reopen never corrupts it.
        assert (await store.get_run(run.run_id)).status == TaskStatus.FAILED, label


def _batch() -> BatchRecord:
    return BatchRecord(
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        status=BatchStatus.QUEUED,
        total_count=1,
        created_at=1,
        updated_at=1,
    )


def _run(tmp_path: Path, *, run_id: str = "run-1", idempotency_key: str = "key") -> TaskRun:
    spec = TaskSpec(task_id="task-1", title="Task 1", dispatch=SkillDispatch(skill_name="mock"))
    return TaskRun(
        run_id=run_id,
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key=idempotency_key,
        executor="local_subprocess",
        queued_at=1,
    )
