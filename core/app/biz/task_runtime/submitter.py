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

"""Batch submission pipeline.

:class:`Submitter` owns the submission half of the runtime: it turns a trusted
:class:`PreparedTaskBatch` into a :class:`BatchRecord`, materializes the
:class:`TaskRun` rows, drives the scheduler (delegating per-run execution to a
:class:`RunCoordinator`), and aggregates the per-run results back into a
:class:`BatchResult`. It holds its collaborators (store, scheduler, progress,
sandbox, run coordinator) as instance state.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any


from .results import aggregate, finalize_nonterminal_runs, safe_list_batch_runs
from .context import TurnContext
from .models import PreparedTaskBatch
from .models import (
    BatchRecord,
    BatchResult,
    BatchResultDigest,
    BatchStatus,
    JoinStrategy,
    SkillDispatch,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    compute_idempotency_key,
)
from .progress_port import RuntimeProgressPort
from .run_coordinator import RunCoordinator
from .sandbox_coordinator import SandboxCoordinator
from .config import (
    _resolve_docker_concurrency, _resolve_k8s_pod_concurrency,
    _stale_run_after_ms, _task_runtime_heartbeat_interval_seconds
)
from .executors.command_backend import RESOURCE_KEY_DOCKER, RESOURCE_KEY_K8S_POD, backend_resource_key
from .tool_catalog import RUN_COMMAND_TOOL_NAME
from .presentation.rendering.batch_view import _planned_batch_sizes, _with_result_snapshots
from .execution_plan import BatchExecutionPlan, SandboxTypePlan
from .sandbox_types import SANDBOX_OSES
from .scheduler import BatchScheduler
from .state_machine import transition_batch
from .store import IdempotencyCollisionError, RunStore, _write_json_atomic
from .time_utils import now_ms as _now_ms
from .policy import _resolve_policy

if TYPE_CHECKING:
    from .skill_loader import SkillLoader

_LOGGER = logging.getLogger(__name__)

# Reserved namespace inside ``BatchRecord.metadata`` for runtime-owned
# observability. Caller-supplied metadata is opaque and passed through verbatim;
# the runtime never writes bare top-level keys into it, only under this key.
RUNTIME_METADATA_KEY = "_task_runtime"

# Consecutive batch-heartbeat failures before escalating from debug to a single
# warning. One miss is self-healing (the next beat recovers); a sustained run
# means queued siblings will eventually be swept, so surface the cause once.
_HEARTBEAT_FAILURE_WARN_THRESHOLD = 3


class _HeartbeatDeathError(Exception):
    """Raised when the heartbeat beater aborts the batch due to sustained failure.

    This is an internal signal — the submitter catches it to mark the batch
    cancelled with a distinct reason, then re-raises so the caller sees a failure.
    """


class Submitter:
    """Drive a prepared batch through planning, scheduling, and aggregation."""

    def __init__(  # noqa: PLR0913 - collaborators are injected explicitly for testability
        self,
        *,
        store: RunStore,
        scheduler: BatchScheduler,
        progress: RuntimeProgressPort,
        sandbox: SandboxCoordinator,
        runs: RunCoordinator,
        batch_dir: Callable[[str], Path],
        run_dir: Callable[[str, str], Path],
        merge_run_snapshots: Callable[..., list[TaskRun]],
        skill_loader: "SkillLoader | None" = None,
    ) -> None:
        self._store = store
        self._scheduler = scheduler
        self._progress = progress
        self._sandbox = sandbox
        self._runs = runs
        self._batch_dir = batch_dir
        self._run_dir = run_dir
        self._merge_run_snapshots = merge_run_snapshots
        self._skill_loader = skill_loader

    # -- public entrypoint --------------------------------------------------

    async def submit(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        *,
        batch_metadata: dict[str, Any],
    ) -> BatchResult:
        self._normalize_skill_required_sandbox(prepared)
        execution_plan = await self._plan_batch_execution(ctx, prepared)
        # chat and runtime are peers: chat prepares the batch, the runtime owns its
        # own execution subtree in the plan (parent umbrella node + child run nodes).
        await self._progress.ensure_delegate_tasks_plan(ctx, prepared)
        parent_tool_call_id = await self._progress.create_delegate_tasks_call(ctx, prepared)
        batch = self._build_batch(ctx, prepared, parent_tool_call_id, execution_plan, metadata=batch_metadata)
        await self._store.create_batch(batch)
        self._save_prepared_input(batch.batch_id, prepared)
        _record_context_batch_id(ctx, batch.batch_id)
        runs: list[TaskRun] = []
        try:
            runs = await self._create_runs(ctx, prepared, batch, parent_tool_call_id)
            await self._progress.publish_parent_batch_progress(ctx, batch, runs)
            async with self._heartbeat_batch_liveness(batch.batch_id):
                results = await self._run_in_stages(
                    ctx,
                    runs,
                    batch=batch,
                    join_strategy=prepared.batch.join_strategy,
                    execution_plan=execution_plan,
                )
            await self._sandbox.cleanup_batch(ctx, batch)
            results = await finalize_nonterminal_runs(self._store, self._progress, ctx, batch, results)
            batch_result = aggregate(
                batch,
                results,
                artifacts_root=str(self._batch_dir(batch.batch_id)),
            )
            transition_batch(batch, batch_result.status)
            batch.counts = BatchResultDigest.from_result(batch_result).counts
            if batch.ended_at is None:
                batch.ended_at = _now_ms()
            final_runs = _with_result_snapshots(
                self._merge_run_snapshots(runs, await self._store.list_batch_runs(batch.batch_id)),
                results,
            )
            await self._store.update_batch(batch)
            await self._progress.publish_parent_batch_progress(ctx, batch, final_runs)
            await self._progress.mark_parent_step_terminal_if_settled(ctx, batch.parent_tool_call_id or 0, batch.status)
            self._save_batch_result(batch.batch_id, batch_result)
            return batch_result
        except _HeartbeatDeathError:
            await self._mark_batch_cancelled(
                ctx, batch, parent_tool_call_id,
                "Batch aborted: heartbeat to backend lost, batch considered stale.",
            )
            raise
        except asyncio.CancelledError:
            await self._mark_batch_cancelled(ctx, batch, parent_tool_call_id, "Task runtime interrupted before completion.")
            raise
        except Exception:
            await self._mark_batch_failed(ctx, batch, parent_tool_call_id)
            raise

    # -- batch-level liveness ----------------------------------------------

    @contextlib.asynccontextmanager
    async def _heartbeat_batch_liveness(self, batch_id: str) -> AsyncIterator[None]:
        """Keep the batch's still-active runs alive while this process runs.

        Queued runs sit in the scheduler's pending list and are never claimed until
        a sandbox frees up; running runs no longer carry a per-run heartbeat either.
        With a scarce pool a large batch can queue for many minutes; without a
        liveness signal the backend sweeper would reclaim those still-legitimate
        runs and fail the batch. One batch-level heartbeat refreshes a single
        owner-liveness signal for the whole batch (``liveness_at`` on the store
        side); the sweeper gates every run in the batch — queued or running — on
        it, so the cost is O(1) per interval regardless of batch size. When this
        process dies the heartbeat stops and the runs are correctly reclaimed after
        the stale threshold.

        If the heartbeat fails for long enough that the backend would consider the
        batch stale (``TASK_RUNTIME_STALE_RUN_AFTER_MS``), the beater aborts the
        owning task by raising :class:`_HeartbeatDeathError` into it, so the
        submitter cleans up before a stale-reconciler on another pod (or at next
        restart) emits a duplicate recovery message.
        """
        stop = asyncio.Event()
        owner_task = asyncio.current_task()

        async def _beat() -> None:
            interval = _task_runtime_heartbeat_interval_seconds()
            stale_after_ms = _stale_run_after_ms()
            # Derive the abort threshold from the stale window. A value <= 0
            # disables stale sweeping entirely, so disable self-abort too.
            abort_after_failures = max(stale_after_ms // (interval * 1000), 1) if stale_after_ms > 0 else 0
            consecutive_failures = 0
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=interval)
                    return
                except TimeoutError:
                    pass
                try:
                    await self._store.heartbeat_batch(batch_id)
                    consecutive_failures = 0
                except Exception:
                    consecutive_failures += 1
                    # Warn exactly once when failures stop looking transient, so a
                    # persistent outage (e.g. reverse gRPC down) is visible without
                    # spamming a line every interval.
                    if consecutive_failures == _HEARTBEAT_FAILURE_WARN_THRESHOLD:
                        _LOGGER.warning(
                            "batch heartbeat failing repeatedly batch_id=%s consecutive=%d",
                            batch_id,
                            consecutive_failures,
                            exc_info=True,
                        )
                    else:
                        _LOGGER.debug("batch heartbeat failed batch_id=%s", batch_id, exc_info=True)

                    if abort_after_failures and consecutive_failures >= abort_after_failures:
                        _LOGGER.error(
                            "batch heartbeat lost — aborting batch batch_id=%s "
                            "consecutive_failures=%d abort_threshold=%d",
                            batch_id,
                            consecutive_failures,
                            abort_after_failures,
                        )
                        if owner_task is not None and not owner_task.done():
                            owner_task.cancel(
                                msg=f"heartbeat lost after {consecutive_failures} consecutive failures"
                            )
                        return

        task = asyncio.create_task(_beat())
        # Consume the detached beater's outcome so a post-stop cancel/error never
        # surfaces as an "exception was never retrieved" warning.
        task.add_done_callback(lambda done: done.cancelled() or done.exception())
        try:
            yield
        except asyncio.CancelledError:
            # Distinguish beater-initiated cancellation from external cancellation
            # (e.g. plan cancel, gRPC stream abort). If the beater already stopped
            # (it returns after issuing cancel), this was a heartbeat-death abort.
            if task.done() and not stop.is_set():
                raise _HeartbeatDeathError(
                    f"Batch {batch_id} aborted: heartbeat to backend lost"
                ) from None
            raise
        finally:
            # Signal and cancel, but never *await* the beater: a heartbeat parked
            # in a hung ``heartbeat_batch`` RPC is a blocking ``to_thread`` call
            # that cancellation cannot interrupt, and awaiting it would stall batch
            # finalization. A late heartbeat on an already-settled batch is harmless.
            stop.set()
            task.cancel()

    # -- staged scheduling --------------------------------------------------

    async def _run_in_stages(
        self,
        ctx: TurnContext,
        runs: list[TaskRun],
        *,
        batch: BatchRecord,
        join_strategy: JoinStrategy,
        execution_plan: BatchExecutionPlan,
    ) -> list[TaskResult]:
        """Drive ``runs`` wave-by-wave honouring ``TaskSpec.stage``.

        Tasks sharing a stage run in parallel through the scheduler exactly as
        before; stages run in ascending order. When an upstream stage fails to
        meet a hard join strategy (``all_success`` / ``fail_fast``) the remaining
        stages are not started; their runs are cancelled so the batch settles
        promptly. The single-stage path (the common case) is a thin pass-through.
        """
        stages = _group_runs_by_stage(runs)
        resource_limits = _execution_resource_limits(execution_plan)
        if len(stages) == 1:
            return await self._schedule_runs(
                ctx,
                stages[0][1],
                join_strategy=join_strategy,
                concurrency=execution_plan.concurrency,
                resource_limits=resource_limits,
            )

        results: list[TaskResult] = []
        blocked_by: int | None = None
        last_stage = stages[-1][0]
        for stage_no, stage_runs in stages:
            if blocked_by is not None:
                results.extend(await self._cancel_stage(ctx, stage_runs, blocked_by))
                continue
            stage_results = await self._schedule_runs(
                ctx,
                stage_runs,
                join_strategy=join_strategy,
                concurrency=execution_plan.concurrency,
                resource_limits=resource_limits,
            )
            results.extend(stage_results)
            if _stage_gate_blocks(stage_results, join_strategy):
                blocked_by = stage_no
            # Refresh the parent view between stages so queued downstream waves
            # visibly transition; best-effort, a progress hiccup must not abort
            # the batch. The final view is published by ``submit`` afterwards.
            if stage_no != last_stage:
                await self._publish_stage_progress(ctx, batch, runs, results)

        # Restore global batch-item ordering for display; execution honoured stages.
        order = {run.run_id: run.batch_item_index for run in runs}
        return sorted(results, key=lambda result: order.get(result.run_id, 0))

    async def _publish_stage_progress(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
        results: list[TaskResult],
    ) -> None:
        with contextlib.suppress(Exception):
            snapshots = _with_result_snapshots(
                self._merge_run_snapshots(runs, await self._store.list_batch_runs(batch.batch_id)),
                results,
            )
            await self._progress.publish_parent_batch_progress(ctx, batch, snapshots)

    async def _schedule_runs(
        self,
        ctx: TurnContext,
        runs: list[TaskRun],
        *,
        join_strategy: JoinStrategy,
        concurrency: int,
        resource_limits: dict[str, int],
    ) -> list[TaskResult]:
        return await self._scheduler.run(
            runs,
            lambda run: self._runs.execute(ctx, run),
            join_strategy=join_strategy,
            cancel_queued=lambda run, reason: self._runs.cancel_queued(ctx, run, reason),
            max_concurrency=concurrency,
            resource_key=_run_resource_key,
            resource_limits=resource_limits,
            should_retry=_should_retry,
            prepare_retry=lambda run, result: self._runs.prepare_retry(ctx, run, result),
        )

    async def _cancel_stage(
        self,
        ctx: TurnContext,
        runs: list[TaskRun],
        upstream_stage: int,
    ) -> list[TaskResult]:
        reason = f"Skipped: upstream stage {upstream_stage} did not satisfy the batch join strategy."
        return [await self._runs.cancel_queued(ctx, run, reason) for run in runs]

    # -- normalization ------------------------------------------------------

    def _normalize_skill_required_sandbox(self, prepared: PreparedTaskBatch) -> None:
        """Force each skill task's sandbox to the skill's declared infra requirement.

        ``required_sandbox`` on a skill task is otherwise LLM-supplied (the general
        adapter planner / capability descriptor) and can drift to an OS the skill
        cannot run on, e.g. ``linux`` for an ``android-tester`` skill. The skill
        registry is the authoritative, non-LLM source of a skill's requirement
        (``infra_requirements`` -> OS capability), so we overwrite the planner's
        choice here before the batch sandbox type is computed and any lease is
        acquired.
        """
        skill_loader = self._skill_loader
        if skill_loader is None:
            return
        for task in prepared.batch.tasks:
            dispatch = task.dispatch
            if not isinstance(dispatch, SkillDispatch) or not dispatch.skill_name or not dispatch.action_name:
                continue
            card = skill_loader.resolve(f"{dispatch.skill_name}.{dispatch.action_name}")
            if card is None:
                continue
            authoritative = card.requires_sandbox  # an OS selector, e.g. "android" | "windows" | None
            if task.required_sandbox != authoritative:
                _LOGGER.info(
                    "normalizing skill sandbox skill=%s action=%s from=%s to=%s",
                    dispatch.skill_name,
                    dispatch.action_name,
                    task.required_sandbox,
                    authoritative,
                )
                task.required_sandbox = authoritative

    # -- execution planning -------------------------------------------------

    async def _plan_batch_execution(self, ctx: TurnContext, prepared: PreparedTaskBatch) -> BatchExecutionPlan:
        total_count = len(prepared.batch.tasks)
        sandbox_plans = await self._plan_sandbox_buckets(ctx, prepared)
        sandbox_task_count = sum(plan.task_count for plan in sandbox_plans)
        sandbox_lane_total = sum(plan.concurrency for plan in sandbox_plans)
        concurrency = _effective_batch_concurrency(
            total_count=total_count,
            configured=self._scheduler.max_concurrency,
            sandbox_lane_total=sandbox_lane_total,
            non_sandbox_count=total_count - sandbox_task_count,
        )
        primary = sandbox_plans[0] if sandbox_plans else None
        return BatchExecutionPlan(
            total_count=total_count,
            concurrency=concurrency,
            planned_batch_sizes=_planned_batch_sizes(total_count, concurrency),
            sandbox_type=primary.sandbox_type if primary else None,
            sandbox_task_count=sandbox_task_count,
            sandbox_concurrency=sandbox_lane_total or None,
            available_sandbox_count=_aggregate_available_sandboxes(sandbox_plans),
            sandbox_plans=sandbox_plans,
        )

    async def _plan_sandbox_buckets(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
    ) -> tuple[SandboxTypePlan, ...]:
        """Gate concurrency independently for each sandbox OS in the batch.

        Tasks are grouped by their (already normalized) ``required_sandbox`` (an
        OS capability) and each OS's lane count is clamped to *its own* idle
        fleet, so an ``android`` shortage can never serialize idle ``windows``
        machines and vice versa. Buckets are ordered by canonical OS priority for
        a stable, capability-agnostic representative.
        """
        counts: dict[str, int] = {}
        for task in prepared.batch.tasks:
            if task.required_sandbox:
                counts[task.required_sandbox] = counts.get(task.required_sandbox, 0) + 1
        plans: list[SandboxTypePlan] = []
        for sandbox_type in _ordered_sandbox_types(counts):
            task_count = counts[sandbox_type]
            available = await self._sandbox.available_count(ctx, sandbox_type)
            concurrency = _sandbox_concurrency_limit(
                sandbox_task_count=task_count,
                available_sandbox_count=available,
            )
            plans.append(
                SandboxTypePlan(
                    sandbox_type=sandbox_type,
                    task_count=task_count,
                    concurrency=concurrency or 1,
                    available_count=available,
                )
            )
        return tuple(plans)

    def _save_prepared_input(self, batch_id: str, prepared: PreparedTaskBatch) -> None:
        """Persist the PreparedTaskBatch input as JSON for tracing."""
        try:
            batch_input = prepared.batch
            payload = {
                "batch": {
                    "tasks": [t.model_dump(mode="json") for t in batch_input.tasks],
                    "join_strategy": batch_input.join_strategy,
                    "description": batch_input.description,
                },
                "batch_metadata": prepared.batch_metadata,
                "adapter_state": prepared.adapter_state,
            }
            _write_json_atomic(self._batch_dir(batch_id) / "prepared_input.json", payload)
        except Exception:
            _LOGGER.debug("failed to save prepared_input.json for %s", batch_id, exc_info=True)

    def _save_batch_result(self, batch_id: str, result: BatchResult) -> None:
        """Persist the BatchResult as JSON for tracing."""
        try:
            _write_json_atomic(self._batch_dir(batch_id) / "batch_result.json", result.model_dump(mode="json"))
        except Exception:
            _LOGGER.debug("failed to save batch_result.json for %s", batch_id, exc_info=True)

    # -- batch / run materialization ---------------------------------------

    def _build_batch(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        parent_tool_call_id: int,
        execution_plan: BatchExecutionPlan,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> BatchRecord:
        now_ms = _now_ms()
        batch_metadata = dict(metadata or {})
        # Caller ``metadata`` is opaque and passed through verbatim; runtime-owned
        # observability is namespaced under a single reserved key so it can never
        # collide with a future caller-provided field. The scalar ``sandbox_*``
        # columns only carry the representative bucket, so the per-type breakdown
        # (which fleet got how many lanes in a mixed android/windows batch) lives
        # here for diagnostics.
        if execution_plan.sandbox_plans:
            runtime_meta = dict(batch_metadata.get(RUNTIME_METADATA_KEY, {}))
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
            batch_id=f"batch-{uuid.uuid4().hex[:12]}",
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
            created_at=now_ms,
            updated_at=now_ms,
            metadata=batch_metadata,
        )

    def _build_run(
        self,
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
            idempotency_key=compute_idempotency_key(ctx.conversation_id, ctx.turn_id, batch_item_index, task),
            executor=policy.executor,
            queued_at=_now_ms(),
        )

    async def _create_runs(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        batch: BatchRecord,
        parent_tool_call_id: int,
    ) -> list[TaskRun]:
        runs: list[TaskRun] = []
        for batch_item_index, task in enumerate(prepared.batch.tasks):
            child_tool_call_id = await self._progress.add_task_sub_call(
                ctx,
                parent_tool_call_id=parent_tool_call_id,
                task=task,
                sub_call_index=batch_item_index,
            )
            run = self._build_run(ctx, batch, task, parent_tool_call_id, child_tool_call_id, batch_item_index)
            await self._progress.mark_run_queued(ctx, run)
            existing = await self._reuse_existing_run(ctx, run)
            if existing is not None:
                runs.append(existing)
                continue
            try:
                await self._store.create_run(run)
            except IdempotencyCollisionError:
                _LOGGER.info(
                    "idempotency collision on create_run; reusing existing run key=%s",
                    run.idempotency_key,
                )
                winner = await self._store.lookup_idempotent(run.idempotency_key)
                if winner is None:
                    raise
                if not _should_reuse_idempotent_run(winner, run):
                    run.idempotency_key = _rerun_idempotency_key(run.idempotency_key, run.run_id)
                    await self._store.create_run(run)
                    runs.append(run)
                    continue
                winner = _bind_reused_run_to_current_plan(winner, run)
                winner._runtime_reuse = True
                runs.append(winner)
                continue
            runs.append(run)
        return runs

    async def _reuse_existing_run(self, ctx: TurnContext, run: TaskRun) -> TaskRun | None:
        if not run.idempotency_key:
            return None
        try:
            existing = await self._store.lookup_idempotent(run.idempotency_key)
        except Exception:
            _LOGGER.warning("idempotent lookup failed for key=%s", run.idempotency_key, exc_info=True)
            return None
        if existing is None:
            return None
        if not _should_reuse_idempotent_run(existing, run):
            run.idempotency_key = _rerun_idempotency_key(run.idempotency_key, run.run_id)
            return None
        existing = _bind_reused_run_to_current_plan(existing, run)
        existing._runtime_reuse = True
        return existing

    # -- abort / termination writers ---------------------------------------

    async def _mark_batch_failed(self, ctx: TurnContext, batch: BatchRecord, parent_tool_call_id: int) -> None:
        transition_batch(batch, BatchStatus.FAILED)
        batch.ended_at = batch.ended_at or _now_ms()
        with contextlib.suppress(Exception):
            await self._store.update_batch(batch)
        with contextlib.suppress(Exception):
            await self._progress.mark_delegate_tasks_failed(ctx, parent_tool_call_id or 0)

    async def _mark_batch_cancelled(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        parent_tool_call_id: int,
        reason: str,
    ) -> None:
        transition_batch(batch, BatchStatus.CANCELLED)
        batch.cancellation_reason = reason
        batch.ended_at = batch.ended_at or _now_ms()
        with contextlib.suppress(Exception):
            await self._store.cancel_batch(batch.batch_id, reason)
        with contextlib.suppress(Exception):
            await self._store.update_batch(batch)
        with contextlib.suppress(Exception):
            await self._sandbox.cleanup_batch(ctx, batch)
        with contextlib.suppress(Exception):
            cancelled_runs = await safe_list_batch_runs(self._store, batch.batch_id)
            await self._progress.mark_cancelled_runs(ctx, cancelled_runs, reason)
        with contextlib.suppress(Exception):
            await self._progress.mark_delegate_tasks_terminal(ctx, parent_tool_call_id or 0, batch.status)
        with contextlib.suppress(Exception):
            await self._progress.mark_parent_step_terminal_if_settled(ctx, parent_tool_call_id or 0, batch.status)


# ---------------------------------------------------------------------------
# Module-level helpers (pure / IO-light)
# ---------------------------------------------------------------------------


def _group_runs_by_stage(runs: list[TaskRun]) -> list[tuple[int, list[TaskRun]]]:
    """Bucket runs by ``spec.stage`` and return waves in ascending stage order.

    Gaps are tolerated: only the distinct stage values that actually occur form
    waves, so ``stage`` is an ordering hint, not a dense index."""
    grouped: dict[int, list[TaskRun]] = {}
    for run in runs:
        grouped.setdefault(run.spec.stage, []).append(run)
    return [(stage, grouped[stage]) for stage in sorted(grouped)]


def _stage_gate_blocks(results: list[TaskResult], join_strategy: JoinStrategy) -> bool:
    """Decide whether a failed wave should stop the remaining stages.

    Only hard-gating strategies block downstream stages when a task does not
    complete; ``partial_ok`` / ``first_success`` let later stages proceed."""
    if join_strategy not in ("all_success", "fail_fast"):
        return False
    return any(result.status != TaskStatus.COMPLETED for result in results)


def _record_context_batch_id(ctx: TurnContext, batch_id: str) -> None:
    if not batch_id:
        return
    batch_ids = getattr(ctx, "task_runtime_batch_ids", None)
    if not isinstance(batch_ids, list):
        return
    if batch_id not in batch_ids:
        batch_ids.append(batch_id)


def _should_retry(run: TaskRun, result: TaskResult) -> bool:
    policy = run.execution_policy.retry
    if result.status == TaskStatus.COMPLETED or result.error_class is None:
        return False
    return run.attempt < max(1, policy.max_attempts) and result.error_class in policy.retry_on


def _ordered_sandbox_types(types: dict[str, int]) -> list[str]:
    """Order present sandbox buckets by canonical OS priority, unknowns last.

    Buckets are keyed by ``required_sandbox`` (an OS capability), so order them
    by ``SANDBOX_OSES``. Keeps a deterministic, capability-agnostic bucket order
    as new OS capabilities are added without re-touching this scheduler code."""
    known = [sandbox_os for sandbox_os in SANDBOX_OSES if sandbox_os in types]
    extra = sorted(bucket for bucket in types if bucket not in SANDBOX_OSES)
    return known + extra


def _aggregate_available_sandboxes(plans: tuple[SandboxTypePlan, ...]) -> int | None:
    """Sum the known idle capacities across buckets; ``None`` when all unknown."""
    knowns = [plan.available_count for plan in plans if plan.available_count is not None]
    return sum(knowns) if knowns else None


def _sandbox_concurrency_limit(
    *,
    sandbox_task_count: int,
    available_sandbox_count: int | None,
) -> int | None:
    if sandbox_task_count <= 0:
        return None
    # Fail-closed: a sandbox-bound bucket must never fan out past its idle
    # capacity. When capacity is unknown (snapshot unavailable) or momentarily
    # zero (every machine busy), clamp to a single lane so runs serialize over
    # the machine that will free up — rather than silently falling back to the
    # global scheduler max and stampeding a one-machine fleet.
    if available_sandbox_count is None or available_sandbox_count <= 0:
        return 1
    return max(1, min(sandbox_task_count, available_sandbox_count))


def _run_resource_key(run: TaskRun) -> str | None:
    """The resource bucket a run draws from for scheduler concurrency limits.

    A sandbox lease (``required_sandbox``, an OS capability) dominates, since it
    is the scarcest resource. Otherwise, runs that execute commands through a
    pod/container backend (skills, sub-agents, ``run_command``) draw from the
    active backend's bucket (``"docker"`` / ``"k8s_pod"``) so they stay capped
    while pure in-process tools (``echo``) remain unbounded.
    """
    if run.spec.required_sandbox:
        return run.spec.required_sandbox
    if _run_uses_command_backend(run):
        return backend_resource_key()
    return None


def _run_uses_command_backend(run: TaskRun) -> bool:
    kind = run.spec.kind
    if kind in ("skill", "sub_agent"):
        return True
    return kind == "tool" and run.spec.tool_name == RUN_COMMAND_TOOL_NAME


def _execution_resource_limits(plan: BatchExecutionPlan) -> dict[str, int]:
    limits: dict[str, int] = {}
    # One gate per sandbox OS so each fleet is bounded by its own idle
    # capacity; a run is bucketed by ``_run_resource_key`` -> its sandbox OS.
    for sandbox_plan in plan.sandbox_plans:
        if sandbox_plan.concurrency > 0:
            limits[sandbox_plan.sandbox_type] = sandbox_plan.concurrency
    backend_key = backend_resource_key()
    if backend_key == RESOURCE_KEY_K8S_POD:
        limits[backend_key] = _resolve_k8s_pod_concurrency()
    elif backend_key == RESOURCE_KEY_DOCKER:
        limits[backend_key] = _resolve_docker_concurrency()
    return limits


def _effective_batch_concurrency(
    *,
    total_count: int,
    configured: int,
    sandbox_lane_total: int,
    non_sandbox_count: int,
) -> int:
    """Global lane count = the parallelism the batch can usefully exploit.

    Sandbox-bound work is summed across buckets (each already clamped to its own
    fleet) and added to the sandbox-free task count, then capped at the configured
    scheduler max and the batch size. Per-type gates in ``resource_limits`` keep
    each fleet within its capacity; this global cap only prevents over-scheduling
    beyond what the batch and the configured max allow."""
    if total_count <= 0:
        return 1
    useful = sandbox_lane_total + non_sandbox_count
    if useful <= 0:
        useful = total_count
    return max(1, min(max(1, configured), total_count, useful))


def _bind_reused_run_to_current_plan(existing: TaskRun, current: TaskRun) -> TaskRun:
    return existing.model_copy(
        update={
            "parent_tool_call_id": current.parent_tool_call_id,
            "plan_batch_call_id": current.plan_batch_call_id,
            "batch_item_index": current.batch_item_index,
        }
    )


def _should_reuse_idempotent_run(existing: TaskRun, current: TaskRun) -> bool:
    if existing.parent_conversation_id != current.parent_conversation_id:
        return False
    if existing.status == TaskStatus.COMPLETED:
        return True
    return existing.parent_turn_id == current.parent_turn_id


def _rerun_idempotency_key(key: str, run_id: str) -> str:
    if not key:
        return key
    return f"{key}:rerun:{run_id}"
