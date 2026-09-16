"""Run persistence protocol and shared adapter contract guards."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal, Protocol

from ..domain.models import BatchRecord, FencingToken, StaleRun, TaskDetail, TaskOutputRef, TaskResult, TaskRun, TaskStatus

TaskDetailView = Literal["summary", "artifacts"]

RETRYABLE_TERMINAL_STATUSES: frozenset[TaskStatus] = frozenset({TaskStatus.FAILED, TaskStatus.TIMED_OUT, TaskStatus.BLOCKED})
_OUTPUT_FILE_PATTERN = re.compile(r"output-([0-9a-f]{64})\.txt")
_ATTEMPT_DIR_PATTERN = re.compile(r"attempt-(0|[1-9][0-9]*)")


class StaleWorkerError(RuntimeError):
    pass


class IdempotencyCollisionError(RuntimeError):
    """Another run already owns the requested idempotency key."""


@dataclass(frozen=True, slots=True)
class BatchCreateResult:
    batch: BatchRecord
    created: bool


@dataclass(frozen=True, slots=True)
class BatchUpdateResult:
    batch: BatchRecord
    applied: bool


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
    async def create_batch(self, batch: BatchRecord) -> BatchCreateResult: ...
    async def create_run(self, run: TaskRun) -> None: ...
    async def update_batch(self, batch: BatchRecord) -> BatchUpdateResult: ...
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


def _write_bytes_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(file_descriptor, "wb") as output_file:
            output_file.write(payload)
        os.replace(tmp_path, path)
    except BaseException:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise


def _attempt_output_dir(results_root: Path, run: TaskRun, attempt: int) -> Path:
    resolved_root = results_root.resolve()
    output_dir = (resolved_root / run.batch_id / run.run_id / f"attempt-{attempt}").resolve()
    if not output_dir.is_relative_to(resolved_root):
        raise ValueError(f"invalid task output path for run {run.run_id}")
    return output_dir


def _output_location(results_root: Path, run: TaskRun, payload: bytes) -> tuple[Path, str]:
    # A rejected/stale writer with different content must not replace the
    # committed sidecar; concurrent writes of identical content are equivalent.
    content_digest = hashlib.sha256(payload).hexdigest()
    output_dir = _attempt_output_dir(results_root, run, run.attempt)
    filename = f"output-{content_digest}.txt"
    output_path = output_dir / filename
    relative_path = Path(run.batch_id) / run.run_id / f"attempt-{run.attempt}" / filename
    return output_path, (Path("results") / relative_path).as_posix()


def _output_path_from_ref(results_root: Path, run: TaskRun, output_ref: TaskOutputRef) -> tuple[Path, str]:
    reference_path = PurePosixPath(output_ref.path)
    expected_run_parent = PurePosixPath("results") / run.batch_id / run.run_id
    attempt_match = _ATTEMPT_DIR_PATTERN.fullmatch(reference_path.parent.name)
    filename_match = _OUTPUT_FILE_PATTERN.fullmatch(reference_path.name)
    if reference_path.parent.parent != expected_run_parent or attempt_match is None or filename_match is None:
        raise ValueError(f"invalid output_ref path for run {run.run_id}: {output_ref.path}")

    resolved_root = results_root.resolve()
    output_path = (resolved_root / Path(*reference_path.parts[1:])).resolve()
    if not output_path.is_relative_to(resolved_root):
        raise ValueError(f"invalid output_ref path for run {run.run_id}: {output_ref.path}")
    return output_path, filename_match.group(1)


def _persisted_result_payload(results_root: Path, run: TaskRun, result: TaskResult) -> dict:
    output_ref = result.output_ref
    if result.output:
        output_bytes = result.output.encode("utf-8")
        output_path, reference_path = _output_location(results_root, run, output_bytes)
        _write_bytes_atomic(output_path, output_bytes)
        output_ref = TaskOutputRef(path=reference_path, size=len(output_bytes))
    persisted_result = result.model_copy(update={"output_ref": output_ref})
    return persisted_result.model_dump(mode="json", exclude={"output"})


def _hydrate_result_output(results_root: Path, run: TaskRun, result: TaskResult) -> TaskResult:
    if result.output or result.output_ref is None:
        return result
    output_path, expected_digest = _output_path_from_ref(results_root, run, result.output_ref)
    output_bytes = output_path.read_bytes()
    if len(output_bytes) != result.output_ref.size:
        raise ValueError(f"output_ref size mismatch for run {run.run_id}")
    if hashlib.sha256(output_bytes).hexdigest() != expected_digest:
        raise ValueError(f"output_ref checksum mismatch for run {run.run_id}")
    return result.model_copy(update={"output": output_bytes.decode("utf-8")})
