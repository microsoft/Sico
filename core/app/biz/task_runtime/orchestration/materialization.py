"""Batch/run materialization, duplicate-submission identity, and idempotent rebinding."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ..config import _duplicate_submission_materialization_timeout_seconds
from ..context import TurnContext
from ..domain.models import (
    TERMINAL_BATCH_STATUSES,
    BatchRecord,
    BatchStatus,
    PreparedTaskBatch,
    RUNTIME_METADATA_KEY,
    TaskRun,
    TaskSpec,
    compute_idempotency_key,
)
from ..domain.policy import _resolve_policy
from .playbook_retrieval import attach_playbook_hints
from ..presentation.port import RuntimeProgressPort
from ..storage.run_store import IdempotencyCollisionError, RunStore, _write_json_atomic
from ..domain.time import now_ms as _now_ms
from ..workspace.rerun_sources import RERUN_SOURCES_DIR, RERUN_SOURCE_MAX_BYTES, build_rerun_source_payload
from ..workspace.layout import workspace_layout
from .execution_plan import BatchExecutionPlan

_LOGGER = logging.getLogger(__name__)


class SubmissionMaterializer:
    """Construct and persist batches/runs without owning their execution."""

    def __init__(
        self,
        store: RunStore,
        progress: RuntimeProgressPort,
        batch_dir: Callable[[str], Path],
    ) -> None:
        self._store = store
        self._progress = progress
        self._batch_dir = batch_dir
        self._background_tasks: set[asyncio.Task[None]] = set()

    def converge_failed_materialization(
        self,
        candidate: BatchRecord | None,
        *,
        remove_foreign_owner_projection: Callable[[], Awaitable[bool]],
    ) -> None:
        if candidate is None:
            return
        task = asyncio.create_task(
            self._cancel_owned_batch_when_visible(candidate, remove_foreign_owner_projection)
        )
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _cancel_owned_batch_when_visible(
        self,
        candidate: BatchRecord,
        remove_foreign_owner_projection: Callable[[], Awaitable[bool]],
    ) -> None:
        timeout_seconds = _duplicate_submission_materialization_timeout_seconds()
        last_error: Exception | None = None
        try:
            async with asyncio.timeout(timeout_seconds):
                while True:
                    try:
                        persisted = await self._store.get_batch(candidate.batch_id)
                    except Exception as exc:
                        last_error = exc
                    else:
                        if persisted.materialization_token != candidate.materialization_token:
                            if persisted.parent_tool_call_id != candidate.parent_tool_call_id:
                                try:
                                    await remove_foreign_owner_projection()
                                except Exception:
                                    _LOGGER.warning(
                                        "failed to remove abandoned materialization projection batch_id=%s",
                                        candidate.batch_id,
                                        exc_info=True,
                                    )
                            return
                        try:
                            await self._store.cancel_batch(
                                candidate.batch_id,
                                "Task runtime interrupted during batch materialization.",
                            )
                            return
                        except Exception as exc:
                            last_error = exc
                    await asyncio.sleep(0.1)
        except TimeoutError:
            pass
        _LOGGER.warning(
            "failed to converge batch after materialization interruption batch_id=%s timeout_seconds=%d "
            "last_error=%r",
            candidate.batch_id,
            timeout_seconds,
            last_error,
        )

    async def materialize_batch(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        batch: BatchRecord,
    ) -> tuple[BatchRecord, bool]:
        """Return the authoritative batch and whether this caller owns its execution."""
        create_result = await self._store.create_batch(batch)
        persisted_batch = create_result.batch
        if not create_result.created:
            _validate_submission_fingerprint_value(persisted_batch, _batch_submission_fingerprint(batch))
            _LOGGER.info(
                "duplicate task submission detected submission_id=%s batch_id=%s",
                ctx.submission_id,
                batch.batch_id,
            )
            self._save_rerun_source(ctx, prepared, persisted_batch)
            return persisted_batch, False
        self._save_prepared_input(persisted_batch.batch_id, prepared)
        self._save_rerun_source(ctx, prepared, persisted_batch)
        return persisted_batch, True

    def build_batch(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        parent_tool_call_id: int,
        execution_plan: BatchExecutionPlan,
        *,
        submission_fingerprint: str,
        metadata: dict[str, Any] | None = None,
    ) -> BatchRecord:
        current_ms = _now_ms()
        batch_metadata = dict(metadata or {})
        runtime_meta = dict(batch_metadata.get(RUNTIME_METADATA_KEY, {}))
        runtime_meta["submission_id"] = ctx.submission_id
        runtime_meta["submission_source"] = ctx.submission_source
        runtime_meta["submission_fingerprint"] = submission_fingerprint
        runtime_meta["materialization_token"] = uuid.uuid4().hex
        if execution_plan.sandbox_plans:
            runtime_meta["sandbox_plans"] = [
                {
                    "sandbox_type": plan.sandbox_type,
                    "task_count": plan.task_count,
                    "concurrency": plan.concurrency,
                    "available_count": plan.available_count,
                }
                for plan in execution_plan.sandbox_plans
            ]
        batch_metadata[RUNTIME_METADATA_KEY] = runtime_meta
        return BatchRecord(
            batch_id=_batch_id_for_submission(ctx.submission_id),
            parent_conversation_id=ctx.conversation_id,
            parent_turn_id=ctx.turn_id,
            parent_tool_call_id=parent_tool_call_id,
            status=BatchStatus.RUNNING,
            reason=prepared.batch.description,
            join_strategy=prepared.batch.join_strategy,
            max_concurrency=execution_plan.concurrency,
            sandbox_type=execution_plan.sandbox_type,
            sandbox_task_count=execution_plan.sandbox_task_count,
            sandbox_concurrency=execution_plan.sandbox_concurrency,
            available_sandbox_count=execution_plan.available_sandbox_count,
            planned_batch_sizes=list(execution_plan.planned_batch_sizes),
            total_count=len(prepared.batch.tasks),
            created_at=current_ms,
            updated_at=current_ms,
            metadata=batch_metadata,
        )

    async def create_runs(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        batch: BatchRecord,
        parent_tool_call_id: int,
    ) -> list[TaskRun]:
        runs: list[TaskRun] = []
        for batch_item_index, task in enumerate(prepared.batch.tasks):
            task = attach_playbook_hints(ctx, task)
            child_tool_call_id = await self._progress.add_task_sub_call(
                ctx,
                parent_tool_call_id=parent_tool_call_id,
                task=task,
                sub_call_index=batch_item_index,
            )
            run = _build_run(ctx, batch, task, parent_tool_call_id, child_tool_call_id, batch_item_index)
            await self._progress.mark_run_queued(ctx, run)
            try:
                await self._store.create_run(run)
            except IdempotencyCollisionError:
                _LOGGER.info("idempotency collision on create_run; reusing existing run key=%s", run.idempotency_key)
                winner = await self._store.lookup_idempotent(run.idempotency_key)
                if winner is None:
                    raise
                winner = _bind_reused_run_to_current_plan(winner, run)
                winner._runtime_reuse = True
                runs.append(winner)
                continue
            runs.append(run)
        return runs

    async def get_existing_batch(self, batch_id: str) -> BatchRecord | None:
        try:
            return await self._store.get_batch(batch_id)
        except FileNotFoundError:
            return None

    async def load_existing_batch_runs(self, batch: BatchRecord) -> list[TaskRun]:
        timeout_seconds = _duplicate_submission_materialization_timeout_seconds()
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        stored_runs: list[TaskRun] = []
        while True:
            stored_runs = await self._store.list_batch_runs(batch.batch_id)
            if len(stored_runs) >= batch.total_count or batch.status in TERMINAL_BATCH_STATUSES:
                break
            if asyncio.get_running_loop().time() >= deadline:
                break
            await asyncio.sleep(0.1)
            batch = await self._store.get_batch(batch.batch_id)

        expected_indices = set(range(batch.total_count))
        actual_indices = {run.batch_item_index for run in stored_runs}
        if len(stored_runs) != batch.total_count or actual_indices != expected_indices:
            missing_indices = sorted(expected_indices - actual_indices)
            _LOGGER.warning(
                "duplicate task submission has incomplete runs batch_id=%s expected=%d found=%d "
                "missing_indices=%s timeout_seconds=%d",
                batch.batch_id,
                batch.total_count,
                len(stored_runs),
                missing_indices,
                timeout_seconds,
            )
            raise RuntimeError(
                f"duplicate task submission {batch.batch_id} expected {batch.total_count} materialized runs, "
                f"found {len(stored_runs)}"
            )

        return sorted(stored_runs, key=lambda item: item.batch_item_index)

    def _save_prepared_input(self, batch_id: str, prepared: PreparedTaskBatch) -> None:
        try:
            payload = {
                "batch": {
                    "tasks": [task.model_dump(mode="json") for task in prepared.batch.tasks],
                    "join_strategy": prepared.batch.join_strategy,
                    "max_concurrency": prepared.batch.max_concurrency,
                    "description": prepared.batch.description,
                },
                "batch_metadata": prepared.batch_metadata,
                "adapter_state": prepared.adapter_state,
            }
            _write_json_atomic(self._batch_dir(batch_id) / "prepared_input.json", payload)
        except Exception:
            _LOGGER.debug("failed to save prepared_input.json for %s", batch_id, exc_info=True)

    @staticmethod
    def _save_rerun_source(ctx: TurnContext, prepared: PreparedTaskBatch, batch: BatchRecord) -> None:
        try:
            payload = build_rerun_source_payload(
                {
                    "turn_id": ctx.turn_id,
                    "conversation_id": ctx.conversation_id,
                    "batch_id": batch.batch_id,
                    "submission_id": ctx.submission_id,
                    "reason": batch.reason,
                    "join_strategy": batch.join_strategy,
                    "max_concurrency": prepared.batch.max_concurrency,
                    "created_at": batch.created_at,
                },
                (task.model_dump(mode="json") for task in prepared.batch.tasks),
            )
            payload_bytes = len(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))
            if payload_bytes > RERUN_SOURCE_MAX_BYTES:
                _LOGGER.warning(
                    "skipping oversized rerun source batch_id=%s size_bytes=%d max_bytes=%d",
                    batch.batch_id,
                    payload_bytes,
                    RERUN_SOURCE_MAX_BYTES,
                )
                return
            turn_path = workspace_layout().turn_path(
                ctx.agent_instance_id,
                ctx.username,
                ctx.turn_id,
                conversation_id=ctx.conversation_id,
            )
            _write_json_atomic(turn_path / RERUN_SOURCES_DIR / f"{batch.batch_id}.json", payload)
        except Exception:
            _LOGGER.warning("failed to save rerun source for batch %s", batch.batch_id, exc_info=True)


def _build_run(
    ctx: TurnContext,
    batch: BatchRecord,
    task: TaskSpec,
    parent_tool_call_id: int,
    child_tool_call_id: int,
    batch_item_index: int,
) -> TaskRun:
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    policy = _resolve_policy(task)
    return TaskRun(
        run_id=run_id,
        batch_id=batch.batch_id,
        parent_conversation_id=ctx.conversation_id,
        parent_turn_id=ctx.turn_id,
        parent_tool_call_id=parent_tool_call_id,
        plan_batch_call_id=child_tool_call_id,
        batch_item_index=batch_item_index,
        username=ctx.username,
        agent_id=ctx.agent_id,
        agent_instance_id=ctx.agent_instance_id,
        project_id=ctx.project_id,
        spec=task,
        execution_policy=policy,
        idempotency_key=compute_idempotency_key(ctx.submission_id, batch_item_index, task),
        executor=policy.executor,
        queued_at=_now_ms(),
    )


def _bind_reused_run_to_current_plan(existing: TaskRun, current: TaskRun) -> TaskRun:
    return existing.model_copy(
        update={
            "parent_tool_call_id": current.parent_tool_call_id,
            "plan_batch_call_id": current.plan_batch_call_id,
            "batch_item_index": current.batch_item_index,
        }
    )


def _batch_id_for_submission(submission_id: str) -> str:
    digest = hashlib.sha256(submission_id.encode("utf-8")).hexdigest()[:24]
    return f"batch-{digest}"


def _prepared_submission_fingerprint(prepared: PreparedTaskBatch, submission_source: str = "") -> str:
    payload = {
        "submission_source": submission_source,
        "tasks": [_task_execution_fingerprint_payload(task) for task in prepared.batch.tasks],
        "join_strategy": prepared.batch.join_strategy,
    }
    if prepared.batch.max_concurrency is not None:
        payload["max_concurrency"] = prepared.batch.max_concurrency
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _task_execution_fingerprint_payload(task: TaskSpec) -> dict[str, Any]:
    return task.model_dump(mode="json", exclude={"display", "metadata"}, exclude_none=True)


def _batch_submission_fingerprint(batch: BatchRecord) -> str:
    runtime_metadata = batch.metadata.get(RUNTIME_METADATA_KEY, {})
    return str(runtime_metadata.get("submission_fingerprint", "")) if isinstance(runtime_metadata, dict) else ""


def _validate_submission_fingerprint_value(existing: BatchRecord, incoming_fingerprint: str) -> None:
    existing_fingerprint = _batch_submission_fingerprint(existing)
    if existing_fingerprint and existing_fingerprint == incoming_fingerprint:
        return
    _LOGGER.warning(
        "duplicate task submission diverged batch_id=%s existing_fingerprint=%s incoming_fingerprint=%s",
        existing.batch_id,
        existing_fingerprint[:12],
        incoming_fingerprint[:12],
    )
    raise RuntimeError(
        f"duplicate task submission diverged for batch {existing.batch_id}; "
        "refusing to reuse results for regenerated tasks"
    )
