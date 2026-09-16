import hashlib
import json
from pathlib import Path

import pytest

from app.biz.task_runtime.domain.models import (
    BatchRecord,
    BatchStatus,
    ErrorClass,
    CapabilityDispatch,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.storage.file_store import FileRunStore
from app.biz.task_runtime.storage.run_store import IdempotencyCollisionError, StaleWorkerError
from app.biz.task_runtime.domain.results import batch_results


@pytest.mark.asyncio
async def test_file_run_store_returns_authoritative_batch_mutations(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    batch = _batch()

    created = await store.create_batch(batch)
    duplicate = await store.create_batch(batch.model_copy(update={"reason": "duplicate payload"}))

    assert created.created
    assert created.batch == batch
    assert created.batch is not batch
    assert not duplicate.created
    assert duplicate.batch == batch

    cancelled = batch.model_copy(update={"status": BatchStatus.CANCELLED, "cancellation_reason": "user cancelled"})
    cancelled_before_update = cancelled.model_copy(deep=True)
    cancelled_update = await store.update_batch(cancelled)
    duplicate_cancel = await store.update_batch(
        cancelled.model_copy(update={"cancellation_reason": "later cancellation"})
    )
    rejected_update = await store.update_batch(batch.model_copy(update={"status": BatchStatus.COMPLETED}))

    assert cancelled_update.applied
    assert cancelled_update.batch.status == BatchStatus.CANCELLED
    assert cancelled == cancelled_before_update
    assert cancelled_update.batch is not cancelled
    assert not duplicate_cancel.applied
    assert duplicate_cancel.batch.cancellation_reason == "user cancelled"
    assert not rejected_update.applied
    assert rejected_update.batch.status == BatchStatus.CANCELLED


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
        output="café\n",
    )
    await store.write_result(run.run_id, result, token)

    loaded_run = await store.get_run(run.run_id)
    detail = await store.get_task_detail(run.run_id, "summary")
    persisted_result = json.loads((tmp_path / "batch-1" / "run-1" / "result.json").read_text(encoding="utf-8"))

    assert loaded_run.status == TaskStatus.COMPLETED
    assert "output" not in persisted_result
    output_bytes = result.output.encode("utf-8")
    content_digest = hashlib.sha256(output_bytes).hexdigest()
    assert persisted_result["output_ref"] == {
        "path": f"results/batch-1/run-1/attempt-1/output-{content_digest}.txt",
        "size": len(output_bytes),
    }
    assert _sidecar_path(tmp_path, persisted_result).read_bytes() == output_bytes
    assert detail.result is not None
    assert detail.result.summary == "done"
    assert detail.result.output == result.output
    assert detail.result.output_ref is not None


@pytest.mark.asyncio
async def test_file_run_store_reads_legacy_inline_output(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    result = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary="done",
        output="legacy inline output",
    )
    await store.write_result(run.run_id, result, token)
    persisted_result = json.loads((tmp_path / "batch-1" / "run-1" / "result.json").read_text(encoding="utf-8"))
    sidecar_path = _sidecar_path(tmp_path, persisted_result)
    (tmp_path / "batch-1" / "run-1" / "result.json").write_text(result.model_dump_json(), encoding="utf-8")
    sidecar_path.unlink()

    detail = await store.get_task_detail(run.run_id, "summary")

    assert detail.result is not None
    assert detail.result.output == "legacy inline output"
    assert detail.result.output_ref is None


@pytest.mark.asyncio
async def test_file_run_store_rejects_corrupted_sidecar(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    result = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary="done",
        output="good",
    )
    await store.write_result(run.run_id, result, token)
    persisted_result = json.loads((tmp_path / "batch-1" / "run-1" / "result.json").read_text(encoding="utf-8"))
    _sidecar_path(tmp_path, persisted_result).write_text("evil", encoding="utf-8")

    with pytest.raises(ValueError, match="checksum mismatch"):
        await store.get_task_detail(run.run_id, "summary")


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
async def test_batch_results_synthesizes_cancelled_run_without_result_file(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    await store.cancel_run(run.run_id, "user cancelled")
    cancelled = await store.get_run(run.run_id)

    results = await batch_results(store, [cancelled])

    assert len(results) == 1
    assert results[0].status == TaskStatus.CANCELLED
    assert results[0].summary == "user cancelled"
    assert results[0].error_class == ErrorClass.CANCELLED


@pytest.mark.asyncio
async def test_file_run_store_duplicate_create_preserves_runtime_state(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    queued = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(queued)
    token = await store.claim_run(queued.run_id, "worker-1")

    await store.create_run(queued)
    running = await store.get_run(queued.run_id)
    assert running.status == TaskStatus.RUNNING
    assert running.worker_id == "worker-1"
    assert running.fencing_token == token.token

    result = TaskResult(
        run_id=running.run_id,
        task_id=running.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=running.spec.title,
        summary="done",
    )
    await store.write_result(running.run_id, result, token)
    await store.create_run(queued)
    terminal = await store.get_run(queued.run_id)
    assert terminal.status == TaskStatus.COMPLETED
    assert (await store.get_task_detail(queued.run_id, "summary")).result == result

    with pytest.raises(IdempotencyCollisionError, match="different identity"):
        await store.create_run(queued.model_copy(update={"idempotency_key": "different"}))


@pytest.mark.asyncio
async def test_file_run_store_stale_update_does_not_resurrect_terminal_run(
    tmp_path: Path,
) -> None:
    store = FileRunStore(tmp_path)
    queued = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(queued)
    token = await store.claim_run(queued.run_id, "worker-1")
    running = await store.get_run(queued.run_id)
    result = TaskResult(
        run_id=running.run_id,
        task_id=running.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=running.spec.title,
        summary="done",
    )
    await store.write_result(running.run_id, result, token)

    await store.update_run(running)
    terminal = await store.get_run(running.run_id)
    assert terminal.status == TaskStatus.COMPLETED
    assert (await store.get_task_detail(running.run_id, "summary")).result == result


@pytest.mark.asyncio
async def test_file_run_store_rejects_second_result_with_consumed_token(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    committed = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary="committed",
        output="committed output",
    )
    await store.write_result(run.run_id, committed, token)

    with pytest.raises(StaleWorkerError):
        await store.write_result(
            run.run_id,
            committed.model_copy(update={"summary": "replacement", "output": "replacement output"}),
            token,
        )

    detail = await store.get_task_detail(run.run_id, "summary")
    assert detail.result is not None
    assert detail.result.summary == "committed"
    assert detail.result.output == "committed output"


@pytest.mark.asyncio
async def test_file_run_store_result_write_failure_keeps_run_active(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.biz.task_runtime.storage.file_store as store_module

    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    original_write = store_module._write_json_atomic

    def fail_result_write(path: Path, payload: dict) -> None:
        if path.name == "result.json":
            raise OSError("disk full")
        original_write(path, payload)

    monkeypatch.setattr(store_module, "_write_json_atomic", fail_result_write)
    with pytest.raises(OSError, match="disk full"):
        await store.write_result(
            run.run_id,
            TaskResult(
                run_id=run.run_id,
                task_id=run.spec.task_id,
                status=TaskStatus.COMPLETED,
                title=run.spec.title,
                summary="done",
                output="output",
            ),
            token,
        )

    stored_run = await store.get_run(run.run_id)
    assert stored_run.status == TaskStatus.RUNNING
    assert stored_run.fencing_token == token.token


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

    # Stale duplicate updates are dropped.
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
    import app.biz.task_runtime.storage.file_store as store_module

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
            output="failed attempt output",
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
    persisted_result = json.loads((tmp_path / "batch-1" / "run-1" / "result.json").read_text(encoding="utf-8"))
    failed_output_path = _sidecar_path(tmp_path, persisted_result)
    assert failed_output_path.exists()

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
    # Keep immutable prior-attempt output available to readers that fetched its
    # reference immediately before the reopen; a future retention job may reclaim it.
    assert failed_output_path.exists()
    # And the requeued run is claimable again, so the retry can actually execute.
    await store.claim_run(run.run_id, "worker-2")


@pytest.mark.asyncio
async def test_file_run_store_ignores_prior_result_during_interrupted_reopen(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    run = _run(tmp_path)
    await store.create_batch(_batch())
    await store.create_run(run)
    await _settle_failed(store, run)
    failed = await store.get_run(run.run_id)
    next_run = failed.model_copy(
        update={
            "attempt": 2,
            "status": TaskStatus.QUEUED,
            "worker_id": None,
            "fencing_token": "",
            "started_at": None,
            "ended_at": None,
        }
    )

    # Simulate a process stopping after reopen metadata is published but before
    # the prior result file is unlinked. Public update_run correctly rejects this
    # terminal-to-active transition; this fixture writes the interrupted disk state.
    metadata_path = store.run_dir(run.batch_id, run.run_id) / "metadata.json"
    metadata_path.write_text(next_run.model_dump_json(), encoding="utf-8")
    detail = await store.get_task_detail(run.run_id, "summary")

    assert detail.result is None


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


def _sidecar_path(results_root: Path, persisted_result: dict) -> Path:
    reference_path = Path(persisted_result["output_ref"]["path"])
    return results_root / reference_path.relative_to("results")


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
    spec = TaskSpec(task_id="task-1", title="Task 1", dispatch=CapabilityDispatch(capability_id="skill:mock.run"))
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
