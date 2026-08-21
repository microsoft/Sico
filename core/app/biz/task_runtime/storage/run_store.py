"""Run persistence protocol and shared adapter contract guards."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Literal, Protocol

from ..domain.models import BatchRecord, FencingToken, StaleRun, TaskDetail, TaskResult, TaskRun, TaskStatus

TaskDetailView = Literal["summary", "artifacts"]

RETRYABLE_TERMINAL_STATUSES: frozenset[TaskStatus] = frozenset({TaskStatus.FAILED, TaskStatus.TIMED_OUT, TaskStatus.BLOCKED})


class StaleWorkerError(RuntimeError):
    pass


class IdempotencyCollisionError(RuntimeError):
    """Another run already owns the requested idempotency key."""


def _validate_reopen_payload(existing: TaskRun, incoming: TaskRun, expected_attempt: int) -> None:
    """Enforce compare-and-set and immutable-identity rules for retry reopen."""
    if existing.status not in RETRYABLE_TERMINAL_STATUSES or existing.attempt != expected_attempt:
        raise StaleWorkerError(
            f"run {existing.run_id} cannot be reopened for retry "
            f"(status={existing.status.value}, attempt={existing.attempt}, expected={expected_attempt})"
        )
    if incoming.status != TaskStatus.QUEUED or incoming.attempt != expected_attempt + 1:
        raise StaleWorkerError(
            f"reopen payload for run {existing.run_id} must be queued at attempt {expected_attempt + 1} "
            f"(got status={incoming.status.value}, attempt={incoming.attempt})"
        )
    if incoming.worker_id or incoming.fencing_token or incoming.started_at is not None or incoming.ended_at is not None:
        raise StaleWorkerError(f"reopen payload for run {existing.run_id} must clear worker/fencing/timestamps")
    if (
        incoming.run_id != existing.run_id
        or incoming.batch_id != existing.batch_id
        or incoming.idempotency_key != existing.idempotency_key
        or incoming.batch_item_index != existing.batch_item_index
        or incoming.spec.task_id != existing.spec.task_id
        or incoming.parent_conversation_id != existing.parent_conversation_id
        or incoming.parent_turn_id != existing.parent_turn_id
    ):
        raise StaleWorkerError(f"reopen payload for run {existing.run_id} must not change identity fields")


class RunStore(Protocol):
    async def create_batch(self, batch: BatchRecord) -> None: ...
    async def create_run(self, run: TaskRun) -> None: ...
    async def update_batch(self, batch: BatchRecord) -> None: ...
    async def get_batch(self, batch_id: str) -> BatchRecord: ...
    async def update_run(self, run: TaskRun) -> None: ...
    async def reopen_run_for_retry(self, run: TaskRun, *, expected_attempt: int) -> None: ...
    async def lookup_idempotent(self, idempotency_key: str) -> TaskRun | None: ...
    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken: ...
    async def heartbeat_batch(self, batch_id: str) -> None: ...
    async def set_progress(self, run_id: str, message: str, *, ts: int | None = None) -> None: ...
    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None: ...
    async def cancel_batch(self, batch_id: str, reason: str) -> None: ...
    async def cancel_run(self, run_id: str, reason: str) -> None: ...
    async def get_run(self, run_id: str) -> TaskRun: ...
    async def get_task_detail(self, run_id: str, view: TaskDetailView) -> TaskDetail: ...
    async def list_batch_runs(self, batch_id: str) -> list[TaskRun]: ...
    async def list_batches_by_turn(
        self,
        parent_conversation_id: int,
        parent_turn_id: int,
        *,
        active_only: bool = False,
    ) -> list[BatchRecord]: ...
    async def sweep_stale(self, before_ts: int) -> list[StaleRun]: ...


def _write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as json_file:
            json.dump(payload, json_file, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except BaseException:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise
