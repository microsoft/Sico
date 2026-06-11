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

import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Literal, Protocol

from .models import BatchRecord, BatchStatus, FencingToken, StaleRun, TaskDetail, TaskResult, TaskRun, TaskStatus
from .state_machine import transition_batch, transition_run
from .time_utils import now_ms as _now_ms


TaskDetailView = Literal["summary", "artifacts"]


# Terminal run statuses a run may be reopened from for another attempt. COMPLETED
# and CANCELLED are absorbing and never reopened (mirrors the backend's
# ``retryableTerminalRunStatuses``).
RETRYABLE_TERMINAL_STATUSES: frozenset[TaskStatus] = frozenset(
    {TaskStatus.FAILED, TaskStatus.TIMED_OUT, TaskStatus.BLOCKED}
)


class StaleWorkerError(RuntimeError):
    pass


class IdempotencyCollisionError(RuntimeError):
    """A concurrent caller already created a run with the same idempotency key.

    Raised by ``RunStore.create_run`` when the underlying store enforces a
    unique constraint on ``idempotency_key`` (the production DB store does;
    the file store only enforces uniqueness through best-effort lookup).
    Callers should re-issue ``lookup_idempotent`` to fetch the prior run.
    """


def _validate_reopen_payload(existing: TaskRun, incoming: TaskRun, expected_attempt: int) -> None:
    """Compare-and-set + payload contract guard shared by the reopen stores.

    Mirrors the backend's ``ensureReopenable`` + ``ensureReopenPayload``: the
    stored row must still be a retryable terminal at ``expected_attempt`` (so a
    duplicate or stale reopen cannot resurrect a run twice), and the incoming
    next-attempt payload must be a clean queued row (status queued, attempt
    advanced by one, fencing/worker/timestamps cleared) without changing run
    identity. Violations raise ``StaleWorkerError`` so the caller degrades to
    "not reopened" rather than persisting a corrupt queued row.
    """
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
        raise StaleWorkerError(
            f"reopen payload for run {existing.run_id} must clear worker/fencing/timestamps"
        )
    if (
        incoming.run_id != existing.run_id
        or incoming.batch_id != existing.batch_id
        or incoming.idempotency_key != existing.idempotency_key
        or incoming.batch_item_index != existing.batch_item_index
        or incoming.spec.task_id != existing.spec.task_id
        or incoming.parent_conversation_id != existing.parent_conversation_id
        or incoming.parent_turn_id != existing.parent_turn_id
    ):
        raise StaleWorkerError(
            f"reopen payload for run {existing.run_id} must not change identity fields"
        )


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


class FileRunStore:
    """Filesystem-backed :class:`RunStore` — **test / single-writer use only**.

    This store keeps each run as a JSON file and implements the ``RunStore``
    fencing contract with unlocked read-modify-write (``claim_run`` /
    ``write_result`` / ``set_progress``) plus a full-tree ``glob`` for
    ``lookup_idempotent``. None of that is concurrency-safe: two workers racing
    on the same run (or idempotency key) can lose updates or both ``claim`` it.

    It exists so tests and single-concurrency local runs can exercise the same
    code paths without a database. **Production deployments must use the
    backend-backed store** (``DBRunStore``, selected by default — set
    ``TASK_RUNTIME_RUN_STORE=file`` only for tests / single-worker scratch runs).
    """

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def batch_dir(self, batch_id: str) -> Path:
        return self.root / batch_id

    def run_dir(self, batch_id: str, run_id: str) -> Path:
        return self.batch_dir(batch_id) / run_id

    async def create_batch(self, batch: BatchRecord) -> None:
        batch_path = self.batch_dir(batch.batch_id)
        batch_path.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(batch_path / "batch.json", batch.model_dump(mode="json"))

    async def create_run(self, run: TaskRun) -> None:
        # Best-effort uniqueness enforcement so the file store matches the DB store's
        # contract (UNIQUE on idempotency_key). This is racy without a real lock, but
        # tests rely on the same exception type as production.
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
        # Compare-and-set + payload contract guard mirroring the backend, so a
        # duplicate or stale reopen cannot resurrect a run twice and a malformed
        # payload cannot persist a corrupt queued row.
        existing, metadata_path = self._read_run_by_id(run.run_id)
        _validate_reopen_payload(existing, run, expected_attempt)
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        # Drop the prior attempt's terminal result so task detail / finalization
        # never read it back for the requeued run (mirrors the DB store clearing
        # result_json on reopen).
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
        now_ms = _now_ms()
        token = FencingToken(run_id=run_id, token=uuid.uuid4().hex, issued_at=now_ms)
        run.worker_id = worker_id
        run.fencing_token = token.token
        transition_run(run, TaskStatus.RUNNING)
        run.started_at = run.started_at or now_ms
        run.heartbeat_at = now_ms
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        return token

    async def heartbeat_batch(self, batch_id: str) -> None:
        # Batch-level owner liveness: while this process is alive it refreshes
        # heartbeat_at on every still-active run — QUEUED and RUNNING alike — so a
        # long-running run is never reclaimed mid-flight and queued siblings waiting
        # behind a scarce sandbox stay alive too. This mirrors the DB store's single
        # liveness_at signal (per-run heartbeats no longer exist); once the process
        # dies the bumps stop and sweep_stale reclaims the batch's runs after the
        # stale threshold.
        now_ms = _now_ms()
        for run in await self.list_batch_runs(batch_id):
            if run.status not in {TaskStatus.QUEUED, TaskStatus.RUNNING}:
                continue
            run.heartbeat_at = now_ms
            await self.update_run(run)

    async def set_progress(self, run_id: str, message: str, *, ts: int | None = None) -> None:
        # Out-of-order writes are dropped (mirrors the DB store's WHERE ts <= ? guard)
        # so retries with stale timestamps cannot regress visible progress.
        run, metadata_path = self._read_run_by_id(run_id)
        now_ms = ts if ts is not None else _now_ms()
        if now_ms < run.latest_progress_at:
            return
        run.latest_progress_message = message[:1000]
        run.latest_progress_at = now_ms
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        run, metadata_path = self._read_run_by_id(run_id)
        self._ensure_current_token(run, token)
        now_ms = _now_ms()
        transition_run(run, result.status)
        run.ended_at = result.ended_at or now_ms
        run.last_error_class = result.error_class
        run.last_error = result.error_message
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        run_path = self.run_dir(run.batch_id, run.run_id)
        _write_json_atomic(run_path / "result.json", result.model_dump(mode="json"))

    async def fail_stale_run(self, run_id: str, result: TaskResult, worker_id: str) -> None:
        run, metadata_path = self._read_run_by_id(run_id)
        if run.status != TaskStatus.RUNNING:
            return
        now_ms = _now_ms()
        run.worker_id = worker_id
        transition_run(run, result.status)
        run.ended_at = result.ended_at or now_ms
        run.last_error_class = result.error_class
        run.last_error = result.error_message
        _write_json_atomic(metadata_path, run.model_dump(mode="json"))
        run_path = self.run_dir(run.batch_id, run.run_id)
        _write_json_atomic(run_path / "result.json", result.model_dump(mode="json"))

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
        now_ms = _now_ms()
        transition_run(run, TaskStatus.CANCELLED)
        run.fencing_token = ""
        run.last_error_class = None
        run.last_error = reason
        run.ended_at = run.ended_at or now_ms
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
        content = ""
        artifacts = [] if result is None else result.artifacts
        if view == "summary" and result is not None:
            content = result.summary
        return TaskDetail(run=run, result=result, view=view, content=content, artifacts=artifacts)

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
