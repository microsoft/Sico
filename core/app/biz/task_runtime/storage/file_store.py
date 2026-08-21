"""Filesystem-backed ``RunStore`` for tests and single-writer local runs."""

from __future__ import annotations

import uuid
from pathlib import Path

from ..domain.models import BatchRecord, BatchStatus, FencingToken, StaleRun, TaskDetail, TaskResult, TaskRun, TaskStatus
from ..domain.state_machine import transition_batch, transition_run
from ..domain.time import now_ms as _now_ms
from .run_store import (
    IdempotencyCollisionError,
    StaleWorkerError,
    TaskDetailView,
    _validate_reopen_payload,
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

    async def create_batch(self, batch: BatchRecord) -> None:
        batch_path = self.batch_dir(batch.batch_id)
        if (batch_path / "batch.json").exists():
            return
        batch_path.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(batch_path / "batch.json", batch.model_dump(mode="json"))

    async def create_run(self, run: TaskRun) -> None:
        if run.idempotency_key:
            existing = await self.lookup_idempotent(run.idempotency_key)
            if existing is not None and existing.run_id != run.run_id:
                raise IdempotencyCollisionError(
                    f"run {existing.run_id} already exists with idempotency_key={run.idempotency_key}"
                )
        run_path = self.run_dir(run.batch_id, run.run_id)
        run_path.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(run_path / "metadata.json", run.model_dump(mode="json"))

    async def update_run(self, run: TaskRun) -> None:
        _write_json_atomic(self.run_dir(run.batch_id, run.run_id) / "metadata.json", run.model_dump(mode="json"))

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
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        _write_json_atomic(self.run_dir(run.batch_id, run.run_id) / "result.json", result.model_dump(mode="json"))

    async def fail_stale_run(self, run_id: str, result: TaskResult, worker_id: str) -> None:
        run, metadata_path = self._read_run_by_id(run_id)
        if run.status != TaskStatus.RUNNING:
            return
        run.worker_id = worker_id
        transition_run(run, result.status)
        run.ended_at = result.ended_at or _now_ms()
        run.last_error_class = result.error_class
        run.last_error = result.error_message
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        _write_json_atomic(self.run_dir(run.batch_id, run.run_id) / "result.json", result.model_dump(mode="json"))

    async def cancel_batch(self, batch_id: str, reason: str) -> None:
        batch = await self.get_batch(batch_id)
        if batch.status not in {BatchStatus.QUEUED, BatchStatus.RUNNING}:
            return
        transition_batch(batch, BatchStatus.CANCELLED)
        batch.cancellation_reason = reason
        await self.update_batch(batch)
        for run in await self.list_batch_runs(batch_id):
            if run.status in {TaskStatus.QUEUED, TaskStatus.RUNNING}:
                await self.cancel_run(run.run_id, reason)

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
        result = self._read_result(run)
        if run.status not in {
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
            TaskStatus.TIMED_OUT,
            TaskStatus.BLOCKED,
        }:
            result = None
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

    async def update_batch(self, batch: BatchRecord) -> None:
        batch.updated_at = _now_ms()
        if batch.status.value in {"completed", "partial", "failed", "cancelled", "timed_out", "blocked"}:
            batch.ended_at = batch.ended_at or batch.updated_at
        _write_json_atomic(self.batch_dir(batch.batch_id) / "batch.json", batch.model_dump(mode="json"))

    async def get_batch(self, batch_id: str) -> BatchRecord:
        path = self.batch_dir(batch_id) / "batch.json"
        return BatchRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def _read_result(self, run: TaskRun) -> TaskResult | None:
        path = self.run_dir(run.batch_id, run.run_id) / "result.json"
        if not path.exists():
            return None
        return TaskResult.model_validate_json(path.read_text(encoding="utf-8"))

    def _read_run_by_id(self, run_id: str) -> tuple[TaskRun, Path]:
        matches = list(self.root.glob(f"*/{run_id}/metadata.json"))
        if not matches:
            raise FileNotFoundError(f"run not found: {run_id}")
        metadata_path = matches[0]
        return TaskRun.model_validate_json(metadata_path.read_text(encoding="utf-8")), metadata_path

    @staticmethod
    def _ensure_current_token(run: TaskRun, token: FencingToken) -> None:
        if run.fencing_token != token.token:
            raise StaleWorkerError(f"stale worker token for run {run.run_id}")
