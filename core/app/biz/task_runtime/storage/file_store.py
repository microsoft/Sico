"""Filesystem-backed ``RunStore`` for tests and single-writer local runs."""

from __future__ import annotations

import uuid
from pathlib import Path

from ..domain.models import (
    TERMINAL_BATCH_STATUSES,
    TERMINAL_STATUSES,
    BatchRecord,
    BatchStatus,
    FencingToken,
    StaleRun,
    TaskDetail,
    TaskResult,
    TaskRun,
    TaskStatus,
)
from ..domain.state_machine import transition_batch, transition_run
from ..domain.time import now_ms as _now_ms
from .run_store import (
    IdempotencyCollisionError,
    StaleWorkerError,
    BatchCreateResult,
    BatchUpdateResult,
    TaskDetailView,
    _validate_reopen_payload,
    _hydrate_result_output,
    _persisted_result_payload,
    _write_json_atomic,
)


class FileRunStore:
    """Unlocked filesystem adapter; production deployments should use ``DBRunStore``."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def batch_dir(self, batch_id: str) -> Path:
        return self.root / batch_id

    def run_dir(self, batch_id: str, run_id: str) -> Path:
        return self.batch_dir(batch_id) / run_id

    async def create_batch(self, batch: BatchRecord) -> BatchCreateResult:
        batch_path = self.batch_dir(batch.batch_id)
        if (batch_path / "batch.json").exists():
            return BatchCreateResult(batch=await self.get_batch(batch.batch_id), created=False)
        batch_path.mkdir(parents=True, exist_ok=True)
        stored_batch = batch.model_copy(deep=True)
        _write_json_atomic(batch_path / "batch.json", stored_batch.model_dump(mode="json"))
        return BatchCreateResult(batch=stored_batch, created=True)

    async def create_run(self, run: TaskRun) -> None:
        metadata_path = self.run_dir(run.batch_id, run.run_id) / "metadata.json"
        if metadata_path.exists():
            existing = TaskRun.model_validate_json(metadata_path.read_text(encoding="utf-8"))
            if _same_run_creation_identity(existing, run):
                return
            raise IdempotencyCollisionError(f"run {run.run_id} already exists with different identity")
        if run.idempotency_key:
            existing = await self.lookup_idempotent(run.idempotency_key)
            if existing is not None:
                raise IdempotencyCollisionError(
                    f"run {existing.run_id} already exists with idempotency_key={run.idempotency_key}"
                )
        run_path = self.run_dir(run.batch_id, run.run_id)
        run_path.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))

    async def update_run(self, run: TaskRun) -> None:
        existing, metadata_path = self._read_run_by_id(run.run_id)
        if existing.status in TERMINAL_STATUSES and existing.status != run.status:
            return
        stored_run = run.model_copy(deep=True)
        _write_json_atomic(metadata_path, stored_run.model_dump(mode="json"))

    async def reopen_run_for_retry(self, run: TaskRun, *, expected_attempt: int) -> None:
        existing, metadata_path = self._read_run_by_id(run.run_id)
        _validate_reopen_payload(existing, run, expected_attempt)
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        (self.run_dir(run.batch_id, run.run_id) / "result.json").unlink(missing_ok=True)

    async def lookup_idempotent(self, idempotency_key: str) -> TaskRun | None:
        for metadata_path in self.root.glob("*/*/metadata.json"):
            run = TaskRun.model_validate_json(metadata_path.read_text(encoding="utf-8"))
            if run.idempotency_key == idempotency_key:
                return run
        return None

    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken:
        run, metadata_path = self._read_run_by_id(run_id)
        if run.status != TaskStatus.QUEUED:
            raise StaleWorkerError(f"run {run.run_id} is {run.status.value} and cannot be claimed")
        current_ms = _now_ms()
        token = FencingToken(run_id=run_id, token=uuid.uuid4().hex, issued_at=current_ms)
        run.worker_id = worker_id
        run.fencing_token = token.token
        transition_run(run, TaskStatus.RUNNING)
        run.started_at = run.started_at or current_ms
        run.heartbeat_at = current_ms
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        return token

    async def heartbeat_batch(self, batch_id: str) -> None:
        current_ms = _now_ms()
        for run in await self.list_batch_runs(batch_id):
            if run.status not in {TaskStatus.QUEUED, TaskStatus.RUNNING}:
                continue
            run.heartbeat_at = current_ms
            await self.update_run(run)

    async def set_progress(self, run_id: str, message: str, *, ts: int | None = None) -> None:
        run, metadata_path = self._read_run_by_id(run_id)
        current_ms = ts if ts is not None else _now_ms()
        if current_ms < run.latest_progress_at:
            return
        run.latest_progress_message = message[:1000]
        run.latest_progress_at = current_ms
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        run, metadata_path = self._read_run_by_id(run_id)
        self._ensure_current_token(run, token)
        transition_run(run, result.status)
        run.ended_at = result.ended_at or _now_ms()
        run.last_error_class = result.error_class
        run.last_error = result.error_message
        run.fencing_token = ""
        _write_json_atomic(
            self.run_dir(run.batch_id, run.run_id) / "result.json",
            _persisted_result_payload(self.root, run, result),
        )
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))

    async def fail_stale_run(self, run_id: str, result: TaskResult, worker_id: str) -> None:
        run, metadata_path = self._read_run_by_id(run_id)
        if run.status != TaskStatus.RUNNING:
            return
        run.worker_id = worker_id
        transition_run(run, result.status)
        run.ended_at = result.ended_at or _now_ms()
        run.last_error_class = result.error_class
        run.last_error = result.error_message
        _write_json_atomic(
            self.run_dir(run.batch_id, run.run_id) / "result.json",
            _persisted_result_payload(self.root, run, result),
        )
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))

    async def cancel_batch(self, batch_id: str, reason: str) -> None:
        batch = await self.get_batch(batch_id)
        if batch.status not in {BatchStatus.QUEUED, BatchStatus.RUNNING}:
            return
        for run in await self.list_batch_runs(batch_id):
            if run.status in {TaskStatus.QUEUED, TaskStatus.RUNNING}:
                await self.cancel_run(run.run_id, reason)
        runs = await self.list_batch_runs(batch_id)
        transition_batch(batch, BatchStatus.CANCELLED)
        batch.cancellation_reason = reason
        batch.counts = _run_status_counts(runs)
        await self.update_batch(batch)

    async def cancel_run(self, run_id: str, reason: str) -> None:
        run, metadata_path = self._read_run_by_id(run_id)
        if run.status not in {TaskStatus.QUEUED, TaskStatus.RUNNING}:
            return
        current_ms = _now_ms()
        transition_run(run, TaskStatus.CANCELLED)
        run.fencing_token = ""
        run.last_error_class = None
        run.last_error = reason
        run.ended_at = run.ended_at or current_ms
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))

    async def get_run(self, run_id: str) -> TaskRun:
        run, _ = self._read_run_by_id(run_id)
        return run

    async def get_task_detail(self, run_id: str, view: TaskDetailView) -> TaskDetail:
        run, _ = self._read_run_by_id(run_id)
        result = None
        if run.status in {
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
            TaskStatus.TIMED_OUT,
            TaskStatus.BLOCKED,
        }:
            result = self._read_result(run)
        content = result.summary if view == "summary" and result is not None else ""
        return TaskDetail(
            run=run,
            result=result,
            view=view,
            content=content,
            artifacts=[] if result is None else result.artifacts,
        )

    async def list_batch_runs(self, batch_id: str) -> list[TaskRun]:
        run_root = self.batch_dir(batch_id)
        if not run_root.exists():
            return []
        runs = [TaskRun.model_validate_json(path.read_text(encoding="utf-8")) for path in run_root.glob("*/metadata.json")]
        return sorted(runs, key=lambda run: run.batch_item_index)

    async def list_batches_by_turn(
        self,
        parent_conversation_id: int,
        parent_turn_id: int,
        *,
        active_only: bool = False,
    ) -> list[BatchRecord]:
        batches: list[BatchRecord] = []
        for metadata_path in self.root.glob("*/batch.json"):
            batch = BatchRecord.model_validate_json(metadata_path.read_text(encoding="utf-8"))
            if batch.parent_conversation_id != parent_conversation_id or batch.parent_turn_id != parent_turn_id:
                continue
            if active_only and batch.status not in {BatchStatus.QUEUED, BatchStatus.RUNNING}:
                continue
            batches.append(batch)
        return sorted(batches, key=lambda batch: batch.created_at)

    async def sweep_stale(self, before_ts: int) -> list[StaleRun]:
        stale_runs: list[StaleRun] = []
        for metadata_path in self.root.glob("*/*/metadata.json"):
            run = TaskRun.model_validate_json(metadata_path.read_text(encoding="utf-8"))
            if run.status != TaskStatus.RUNNING:
                continue
            heartbeat_at = run.heartbeat_at or run.started_at or run.queued_at
            if heartbeat_at >= before_ts:
                continue
            stale_runs.append(
                StaleRun(
                    run_id=run.run_id,
                    batch_id=run.batch_id,
                    status=run.status,
                    worker_id=run.worker_id,
                    heartbeat_at=heartbeat_at,
                )
            )
        return stale_runs

    async def update_batch(self, batch: BatchRecord) -> BatchUpdateResult:
        existing = await self.get_batch(batch.batch_id)
        if existing.status in TERMINAL_BATCH_STATUSES:
            return BatchUpdateResult(batch=existing, applied=False)
        stored_batch = batch.model_copy(deep=True)
        stored_batch.updated_at = _now_ms()
        if stored_batch.status in TERMINAL_BATCH_STATUSES:
            stored_batch.ended_at = stored_batch.ended_at or stored_batch.updated_at
        _write_json_atomic(self.batch_dir(batch.batch_id) / "batch.json", stored_batch.model_dump(mode="json"))
        return BatchUpdateResult(batch=stored_batch, applied=True)

    async def get_batch(self, batch_id: str) -> BatchRecord:
        path = self.batch_dir(batch_id) / "batch.json"
        return BatchRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def _read_result(self, run: TaskRun) -> TaskResult | None:
        path = self.run_dir(run.batch_id, run.run_id) / "result.json"
        if not path.exists():
            return None
        result = TaskResult.model_validate_json(path.read_text(encoding="utf-8"))
        return _hydrate_result_output(self.root, run, result)

    def _read_run_by_id(self, run_id: str) -> tuple[TaskRun, Path]:
        matches = list(self.root.glob(f"*/{run_id}/metadata.json"))
        if not matches:
            raise FileNotFoundError(f"run not found: {run_id}")
        metadata_path = matches[0]
        return TaskRun.model_validate_json(metadata_path.read_text(encoding="utf-8")), metadata_path

    @staticmethod
    def _ensure_current_token(run: TaskRun, token: FencingToken) -> None:
        if run.status != TaskStatus.RUNNING or run.fencing_token != token.token:
            raise StaleWorkerError(f"stale worker token for run {run.run_id}")


def _same_run_creation_identity(existing: TaskRun, incoming: TaskRun) -> bool:
    return (
        existing.run_id == incoming.run_id
        and existing.batch_id == incoming.batch_id
        and bool(existing.idempotency_key.strip())
        and existing.idempotency_key.strip() == incoming.idempotency_key.strip()
    )


def _run_status_counts(runs: list[TaskRun]) -> dict[str, int]:
    return {status.value: sum(run.status == status for run in runs) for status in TERMINAL_STATUSES}
