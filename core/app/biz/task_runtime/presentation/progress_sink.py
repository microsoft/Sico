"""Plan / front-end progress mirroring adapter.

`ProgressSink` is the presentation-layer implementation of `RuntimeProgressPort`.
It translates core runtime progress signals into `PlanEditor` mutations by
populating the structured ``TaskRuntimeExecutionInfo`` fields on each task's
tool call.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable

from app.schemas.conversation.plan import (
    Plan,
    PlanExtra,
    PlanStep,
    PlanStepStatus,
    ToolCall,
    ToolCallStatus,
    ToolDeliverable,
    ToolDeliverableAcquiredSandbox,
    ToolDeliverableType,
    ToolExecutionInfo,
    ToolType,
)

from ..context import TurnContext
from ..domain.models import TERMINAL_STATUSES, PreparedTaskBatch, TaskSpec
from ..domain.models import BatchRecord, BatchStatus, TaskResult, TaskRun, TaskStatus
from .events import DeliverableSpec
from ..domain.results import cancelled_result
from ..storage.run_store import RunStore
from ..domain.time import now_ms as _now_ms
from .port import BatchProjectionOptions, ProjectionIntegrityError
from .rendering.batch_view import (
    _mark_parent_step_terminal_if_settled,
    tool_call_status_for_batch,
)
from .rendering.run_view import current_stage_for_run, tool_call_status_for_result
from .rendering.text_fragments import (
    _common_task_display_map,
    _delegate_plan_step_title,
    _delegate_plan_title,
    _parent_tool_call_name,
    _task_display_map,
)

_LOGGER = logging.getLogger(__name__)
_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY = "_sico_task_runtime_batch_id"


class _ProjectionShapeMismatch(RuntimeError):
    pass


class ProgressSink:
    """Mirror run / batch lifecycle into the plan editor and store."""

    def __init__(self, store: RunStore) -> None:
        self._store = store

    # -- delegate-tasks plan / parent tool call ----------------------------

    async def ensure_delegate_tasks_plan(self, ctx: TurnContext, prepared: PreparedTaskBatch) -> None:
        """Create / patch the umbrella plan that hosts the Delegate Tasks tool call."""
        existing = await ctx.plan_editor.get_plan()
        if existing is not None:
            if existing.title == "Document Preparation" and existing.steps:
                existing.title = _delegate_plan_title(prepared)
                existing.steps[0].title = _delegate_plan_step_title(prepared)
                existing.steps[0].status = PlanStepStatus.IN_PROGRESS
                await ctx.plan_editor.update_plan(existing)
            return
        plan = Plan(
            title=_delegate_plan_title(prepared),
            steps=[PlanStep(title=_delegate_plan_step_title(prepared), status=PlanStepStatus.IN_PROGRESS)],
            extra=PlanExtra(
                username=ctx.username,
                agent_instance_id=ctx.agent_instance_id,
                agent_id=ctx.agent_id,
                turn_id=ctx.turn_id,
                project_id=ctx.project_id,
                conversation_id=ctx.conversation_id,
            ),
        )
        await ctx.plan_editor.update_plan(plan)

    async def create_delegate_tasks_call(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        *,
        batch_id: str,
    ) -> int:
        """Create the parent tool call that groups task sub_calls."""
        return await ctx.plan_editor.create_tool_call(
            _parent_tool_call_name(),
            _parent_initial_message(len(prepared.batch.tasks)),
            ToolExecutionInfo(tool_type=ToolType.BUILTIN, builtin_tool_name="run_tasks"),
            display=_batch_parent_display(list(prepared.batch.tasks), batch_id),
        )

    async def sync_batch_projection(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
        results: list[TaskResult],
        *,
        options: BatchProjectionOptions | None = None,
    ) -> bool:
        """Publish, repair, and settle one batch projection through a single boundary."""
        projection_options = options or BatchProjectionOptions()
        if batch.parent_conversation_id != ctx.conversation_id or batch.parent_turn_id != ctx.turn_id:
            return False
        if projection_options.publish_only:
            return await self._publish_existing_batch_projection(ctx, batch, runs)
        try:
            updated = await self._update_existing_batch_projection(
                ctx,
                batch,
                runs,
                results,
                projection_options,
            )
        except _ProjectionShapeMismatch:
            updated = False
        if updated or not projection_options.repair:
            return updated
        return await self._repair_batch_projection(
            ctx,
            batch,
            runs,
            results,
            projection_options,
        )

    async def _publish_existing_batch_projection(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
    ) -> bool:
        parent_tool_call_id = batch.parent_tool_call_id or 0
        try:
            plan = await ctx.plan_editor.get_plan()
        except Exception:
            _LOGGER.debug("failed to inspect existing batch projection batch_id=%s", batch.batch_id, exc_info=True)
            return False
        if plan is None:
            return False
        parent = _top_level_tool_call(plan, parent_tool_call_id)
        if parent is None:
            return False
        owner_batch_id = _projection_batch_id(parent)
        if owner_batch_id and owner_batch_id != batch.batch_id:
            raise ProjectionIntegrityError(
                f"plan projection tool-call {parent_tool_call_id} belongs to batch {owner_batch_id!r}, "
                f"not {batch.batch_id!r}"
            )
        if not _has_complete_batch_projection(
            plan,
            parent_tool_call_id,
            runs,
            batch_id=batch.batch_id,
            allow_unmarked=not owner_batch_id,
        ):
            return False
        try:
            await ctx.plan_editor.notify_plan_updated(plan)
        except Exception:
            _LOGGER.debug("failed to notify existing batch projection batch_id=%s", batch.batch_id, exc_info=True)
        return True

    async def remove_delegate_tasks_call(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        *,
        batch_id: str,
    ) -> bool:
        """Remove a provisional parent after another submitter wins ownership."""
        def is_owned(plan: Plan, parent: ToolCall) -> bool:
            return _is_owned_batch_parent(plan, parent, parent_tool_call_id, batch_id)

        try:
            return await ctx.plan_editor.remove_tool_call(parent_tool_call_id, predicate=is_owned)
        except Exception:
            _LOGGER.debug(
                "failed to remove provisional duplicate-submission projection tool_call_id=%s",
                parent_tool_call_id,
                exc_info=True,
            )
            return False

    async def _repair_batch_projection(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
        results: list[TaskResult],
        options: BatchProjectionOptions,
    ) -> bool:
        """Atomically restore the canonical fixed-id projection for an existing batch."""
        ordered_runs = sorted(runs, key=lambda run: run.batch_item_index)
        root = ToolCall(
            tool_name=_parent_tool_call_name(),
            message=_parent_initial_message(len(ordered_runs)),
            execution_info=ToolExecutionInfo(tool_type=ToolType.BUILTIN, builtin_tool_name="run_tasks"),
            tool_call_id=batch.parent_tool_call_id or 0,
            display=_batch_parent_display([run.spec for run in ordered_runs], batch.batch_id),
            tool_call_status=ToolCallStatus.RUNNING,
            sub_calls=[
                ToolCall(
                    tool_name=run.spec.title or "TaskRun",
                    message="Queued.",
                    tool_call_id=run.plan_batch_call_id or 0,
                    sub_call_index=run.batch_item_index,
                    display=_task_display_map(run.spec),
                    tool_call_status=ToolCallStatus.PENDING,
                )
                for run in ordered_runs
            ],
        )

        results_by_run_id = {result.run_id: result for result in results}

        def repair_existing(plan: Plan, existing: ToolCall, canonical: ToolCall, now_ms: int) -> None:
            owner_batch_id = _projection_batch_id(existing)
            if (
                existing.execution_info.tool_type != ToolType.BUILTIN
                or existing.execution_info.builtin_tool_name != "run_tasks"
            ):
                raise ProjectionIntegrityError(f"tool-call id {existing.tool_call_id} is not owned by task runtime")
            # Only the exact-shape update path may adopt a legacy unmarked tree;
            # repairing a partial one could claim a foreign numeric tool-call ID.
            if owner_batch_id != batch.batch_id:
                owner_label = repr(owner_batch_id) if owner_batch_id else "an unmarked projection"
                raise ProjectionIntegrityError(
                    f"tool-call id {existing.tool_call_id} belongs to {owner_label}, not batch {batch.batch_id!r}"
                )
            children_by_id = {child.tool_call_id: child for child in existing.sub_calls}
            if len(children_by_id) != len(existing.sub_calls):
                raise ProjectionIntegrityError(f"duplicate child tool-call ids under parent {existing.tool_call_id}")
            repaired_children: list[ToolCall] = []
            for desired in canonical.sub_calls:
                child = children_by_id.get(desired.tool_call_id)
                if child is None:
                    repaired_children.append(desired)
                    continue
                child.tool_name = desired.tool_name
                child.sub_call_index = desired.sub_call_index
                child.display = desired.display
                repaired_children.append(child)
            existing.tool_name = canonical.tool_name
            existing.execution_info.tool_type = canonical.execution_info.tool_type
            existing.execution_info.builtin_tool_name = canonical.execution_info.builtin_tool_name
            existing.display = canonical.display
            existing.sub_calls = repaired_children
            _apply_batch_projection_state(
                plan,
                existing,
                batch,
                runs,
                results_by_run_id,
                options,
                now_ms,
            )

        try:
            return await ctx.plan_editor.repair_tool_call_tree(root, repair_existing)
        except ProjectionIntegrityError:
            raise
        except (RuntimeError, ValueError) as exc:
            raise ProjectionIntegrityError(str(exc)) from exc

    async def _update_existing_batch_projection(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
        results: list[TaskResult],
        options: BatchProjectionOptions,
    ) -> bool:
        parent_tool_call_id = batch.parent_tool_call_id or 0
        results_by_run_id = {result.run_id: result for result in results}

        def updater(plan: Plan, parent: ToolCall, now_ms: int) -> None:
            owner_batch_id = _projection_batch_id(parent)
            if owner_batch_id:
                _require_owned_batch_parent(plan, parent, parent_tool_call_id, batch.batch_id)
            elif not options.allow_unmarked:
                raise ProjectionIntegrityError(
                    f"tool-call id {parent_tool_call_id} is not owned by batch {batch.batch_id!r}"
                )
            if not _has_complete_batch_projection(
                plan,
                parent_tool_call_id,
                runs,
                batch_id=batch.batch_id,
                allow_unmarked=options.allow_unmarked,
            ):
                raise _ProjectionShapeMismatch(f"plan projection changed for batch {batch.batch_id!r}")
            if options.allow_unmarked and not owner_batch_id:
                parent.display = {**parent.display, _TASK_RUNTIME_BATCH_ID_DISPLAY_KEY: batch.batch_id}
            _apply_batch_projection_state(
                plan,
                parent,
                batch,
                runs,
                results_by_run_id,
                options,
                now_ms,
            )

        return await ctx.plan_editor.update_tool_call_tree(parent_tool_call_id, updater)

    async def add_task_sub_call(
        self,
        ctx: TurnContext,
        *,
        parent_tool_call_id: int,
        task: TaskSpec,
        sub_call_index: int,
    ) -> int:
        """Create a child tool call (sub_call) under the delegate-tasks parent."""
        return await ctx.plan_editor.create_tool_call(
            task.title or "TaskRun",
            "Queued.",
            parent_tool_call_id=parent_tool_call_id or None,
            sub_call_index=sub_call_index,
            display=_task_display_map(task),
            tool_call_status=ToolCallStatus.PENDING,
        )

    async def mark_delegate_tasks_failed(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        *,
        batch_id: str,
    ) -> None:
        if not parent_tool_call_id:
            return

        def updater(plan: Plan, parent: ToolCall, now_ms: int) -> None:
            _require_owned_batch_parent(plan, parent, parent_tool_call_id, batch_id)
            _fail_active_tool_call_tree(parent, now_ms)
            parent.tool_call_status = ToolCallStatus.FAILED
            parent.message = "Delegated tasks failed."
            _mark_parent_step_terminal_if_settled(plan, parent_tool_call_id, BatchStatus.FAILED)

        await ctx.plan_editor.update_tool_call_tree(parent_tool_call_id, updater)

    async def mark_delegate_tasks_terminal(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        batch_status: BatchStatus,
        *,
        batch_id: str,
    ) -> None:
        if not parent_tool_call_id:
            return
        status = tool_call_status_for_batch(batch_status)
        message = _parent_terminal_message(batch_status)

        def updater(plan: Plan, parent: ToolCall, _now_ms: int) -> None:
            _require_owned_batch_parent(plan, parent, parent_tool_call_id, batch_id)
            parent.tool_call_status = status
            parent.message = message

        await ctx.plan_editor.update_tool_call_tree(parent_tool_call_id, updater)

    # -- per-run lifecycle -------------------------------------------------

    async def mark_run_queued(self, ctx: TurnContext, run: TaskRun) -> None:
        if not run.plan_batch_call_id:
            return

        def updater(tool_call) -> None:
            tool_call.tool_call_status = ToolCallStatus.PENDING
            tool_call.message = "Queued."
            info = tool_call.execution_info.task_runtime
            info.current_stage = "plan"
            info.attempt = run.attempt
            info.max_attempts = max(1, run.execution_policy.retry.max_attempts)

        await ctx.plan_editor.update_tool_call(run.plan_batch_call_id, updater)

    async def mark_retry_pending(self, ctx: TurnContext, run: TaskRun) -> None:
        if not run.plan_batch_call_id:
            return

        def updater(tool_call) -> None:
            tool_call.tool_call_status = ToolCallStatus.PENDING
            tool_call.message = f"Queued for retry (attempt {run.attempt})."
            info = tool_call.execution_info.task_runtime
            info.current_stage = "plan"
            info.attempt = run.attempt
            info.max_attempts = max(1, run.execution_policy.retry.max_attempts)

        await ctx.plan_editor.update_tool_call(run.plan_batch_call_id, updater)

    async def run_stage(
        self,
        ctx: TurnContext,
        run: TaskRun,
        *,
        stage: str,
    ) -> None:
        await self._update_run_lifecycle(ctx, run, active_stage=stage)

    async def mark_run_terminal(
        self,
        ctx: TurnContext,
        run: TaskRun,
        result: TaskResult,
        *,
        sandbox_released: bool = False,
        lease_outcome: str = "",
    ) -> None:
        await self._update_run_lifecycle(
            ctx,
            run,
            terminal_result=result,
            sandbox_released=sandbox_released,
            lease_outcome=lease_outcome,
        )

    async def publish_deliverable(
        self,
        ctx: TurnContext,
        tool_call_id: int,
        deliverable: DeliverableSpec,
        *,
        replace_key: Callable[[DeliverableSpec], str | None] | None = None,
    ) -> None:
        if not tool_call_id:
            return
        key = replace_key(deliverable) if replace_key is not None else None
        tool_deliverable = _to_tool_deliverable(deliverable)

        def updater(tool_call) -> None:
            if replace_key is None or key is None:
                tool_call.deliverables = [*tool_call.deliverables, tool_deliverable]
                return
            next_deliverables: list[ToolDeliverable] = []
            replaced = False
            for item in tool_call.deliverables:
                existing_spec = _to_deliverable_spec(item)
                if existing_spec is not None and replace_key(existing_spec) == key:
                    if not replaced:
                        next_deliverables.append(tool_deliverable)
                        replaced = True
                    continue
                next_deliverables.append(item)
            if not replaced:
                next_deliverables.append(tool_deliverable)
            tool_call.deliverables = next_deliverables

        await ctx.plan_editor.update_tool_call(tool_call_id, updater)

    async def _update_run_lifecycle(
        self,
        ctx: TurnContext,
        run: TaskRun,
        *,
        active_stage: str | None = None,
        terminal_result: TaskResult | None = None,
        sandbox_released: bool = False,
        lease_outcome: str = "",
    ) -> None:
        if not run.plan_batch_call_id:
            return
        if terminal_result is None and active_stage is not None:
            await self._persist_run_runtime_stage(run, active_stage)

        def updater(tool_call) -> None:
            _apply_run_lifecycle_to_tool_call(
                tool_call,
                run,
                active_stage=active_stage,
                terminal_result=terminal_result,
                sandbox_released=sandbox_released,
                lease_outcome=lease_outcome,
            )

        await ctx.plan_editor.update_tool_call(run.plan_batch_call_id, updater)

    async def _persist_run_runtime_stage(self, run: TaskRun, active_stage: str) -> None:
        if run.runtime_stage == active_stage:
            return
        run.runtime_stage = active_stage
        try:
            current = await self._store.get_run(run.run_id)
            current.runtime_stage = active_stage
            current.heartbeat_at = _now_ms()
            if run.sandbox is not None:
                current.sandbox = run.sandbox
                current.sandbox_released = run.sandbox_released
                current.lease_outcome = run.lease_outcome
            await self._store.update_run(current)
        except Exception:
            _LOGGER.debug("failed to persist task runtime stage run_id=%s stage=%s", run.run_id, active_stage, exc_info=True)

    async def publish_parent_batch_progress(self, ctx: TurnContext, batch: BatchRecord, runs: list[TaskRun]) -> None:
        """Update the Delegate-Tasks parent ToolCall.message with a counts summary."""
        parent_tool_call_id = batch.parent_tool_call_id or 0
        if not parent_tool_call_id:
            return
        message = _parent_progress_message(batch, runs)

        def updater(plan: Plan, parent: ToolCall, _now_ms: int) -> None:
            owner_batch_id = _projection_batch_id(parent)
            if owner_batch_id:
                _require_owned_batch_parent(plan, parent, parent_tool_call_id, batch.batch_id)
            else:
                if not _has_complete_batch_projection(
                    plan,
                    parent_tool_call_id,
                    runs,
                    batch_id=batch.batch_id,
                    allow_unmarked=True,
                ):
                    raise ProjectionIntegrityError(f"unmarked plan projection does not match batch {batch.batch_id!r}")
                parent.display = {**parent.display, _TASK_RUNTIME_BATCH_ID_DISPLAY_KEY: batch.batch_id}
            parent.message = message

        try:
            await ctx.plan_editor.update_tool_call_tree(parent_tool_call_id, updater)
        except Exception:
            _LOGGER.debug(
                "failed to refresh delegate-tasks parent progress message batch_id=%s",
                batch.batch_id,
                exc_info=True,
            )

    async def mark_cancelled_runs(self, ctx: TurnContext, runs: list[TaskRun], reason: str) -> None:
        for run in runs:
            if run.status != TaskStatus.CANCELLED or not run.plan_batch_call_id:
                continue
            result = cancelled_result(run, reason)
            try:
                await self.mark_run_terminal(
                    ctx,
                    run,
                    result,
                    sandbox_released=run.sandbox_released,
                    lease_outcome=run.lease_outcome or ("dirty" if run.sandbox is not None else ""),
                )
            except Exception:
                _LOGGER.debug("failed to mark cancelled run terminal run_id=%s", run.run_id, exc_info=True)

    async def mark_parent_step_terminal_if_settled(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        batch_status: BatchStatus,
        *,
        batch_id: str,
        finish_unstarted_tail: bool = False,
        recovering: bool = False,
    ) -> None:
        if not parent_tool_call_id:
            return

        def updater(plan: Plan, parent: ToolCall, _now_ms: int) -> None:
            _require_owned_batch_parent(plan, parent, parent_tool_call_id, batch_id)
            _mark_parent_step_terminal_if_settled(
                plan,
                parent_tool_call_id,
                batch_status,
                finish_unstarted_tail=finish_unstarted_tail,
                recovering=recovering,
            )

        await ctx.plan_editor.update_tool_call_tree(parent_tool_call_id, updater)

    async def mirror_run_progress(self, ctx: TurnContext, run: TaskRun, stop: asyncio.Event) -> None:
        if not run.plan_batch_call_id:
            return
        poll_seconds = max(0.1, float(os.getenv("TASK_RUNTIME_PROGRESS_POLL_SECONDS", "5") or 5))
        last_message = ""
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
                return
            except TimeoutError:
                pass
            try:
                snapshot = await self._store.get_run(run.run_id)
            except Exception:
                _LOGGER.debug("failed to read task runtime progress snapshot", exc_info=True)
                continue
            message = snapshot.latest_progress_message
            if message and message != last_message:

                def updater(tool_call, value: str = message) -> None:
                    tool_call.execution_info.task_runtime.latest_progress_message = value

                await ctx.plan_editor.update_tool_call(run.plan_batch_call_id, updater)
                last_message = message
            if snapshot.status in TERMINAL_STATUSES:
                return


def _apply_batch_projection_state(
    plan: Plan,
    parent: ToolCall,
    batch: BatchRecord,
    runs: list[TaskRun],
    results_by_run_id: dict[str, TaskResult],
    options: BatchProjectionOptions,
    now_ms: int,
) -> None:
    children = {child.tool_call_id: child for child in parent.sub_calls}
    for run in runs:
        result = results_by_run_id.get(run.run_id)
        if result is None:
            continue
        child = children.get(run.plan_batch_call_id or 0)
        if child is None:
            raise ProjectionIntegrityError(f"plan projection is missing run {run.run_id!r}")
        _apply_run_lifecycle_to_tool_call(
            child,
            run,
            active_stage=None,
            terminal_result=result,
            sandbox_released=run.sandbox_released,
            lease_outcome=run.lease_outcome,
        )
        child.updated_at = now_ms
    if not options.settle_batch:
        return
    parent.tool_call_status = tool_call_status_for_batch(batch.status)
    parent.message = _parent_terminal_message(batch.status)
    _mark_parent_step_terminal_if_settled(
        plan,
        batch.parent_tool_call_id or 0,
        batch.status,
        finish_unstarted_tail=options.finish_unstarted_tail,
        recovering=options.recovering,
    )


def _apply_run_lifecycle_to_tool_call(
    tool_call: ToolCall,
    run: TaskRun,
    *,
    active_stage: str | None,
    terminal_result: TaskResult | None,
    sandbox_released: bool,
    lease_outcome: str,
) -> None:
    stage = current_stage_for_run(
        run,
        active_stage=active_stage,
        terminal_result=terminal_result,
        sandbox_released=sandbox_released,
    )
    max_attempts = max(1, run.execution_policy.retry.max_attempts)
    if terminal_result is not None:
        tool_call.tool_call_status = tool_call_status_for_result(run, terminal_result)
    elif active_stage is not None and tool_call.tool_call_status == ToolCallStatus.PENDING:
        tool_call.tool_call_status = ToolCallStatus.RETRY_RUNNING if run.attempt > 1 else ToolCallStatus.RUNNING
    tool_call.message = _run_lifecycle_message(stage, run, max_attempts, terminal_result)
    info = tool_call.execution_info.task_runtime
    info.current_stage = stage
    info.attempt = run.attempt
    info.max_attempts = max_attempts
    if run.sandbox is not None:
        info.sandbox_id = run.sandbox.sandbox_id
        info.sandbox_type = run.sandbox.type or info.sandbox_type
        info.sandbox_endpoint = run.sandbox.endpoint or info.sandbox_endpoint
    if lease_outcome == "dirty":
        info.latest_progress_message = "Sandbox released with dirty lease."


def _fail_active_tool_call_tree(tool_call: ToolCall, now_ms: int) -> None:
    active_statuses = {
        ToolCallStatus.UNKNOWN,
        ToolCallStatus.RUNNING,
        ToolCallStatus.FAILED_ANALYZING,
        ToolCallStatus.RETRY_RUNNING,
        ToolCallStatus.PENDING,
    }
    if tool_call.tool_call_status in active_statuses:
        tool_call.tool_call_status = ToolCallStatus.FAILED
        tool_call.message = "Delegated task failed before completion."
    tool_call.updated_at = now_ms
    for child in tool_call.sub_calls:
        _fail_active_tool_call_tree(child, now_ms)


def _batch_parent_display(tasks: list[TaskSpec] | tuple[TaskSpec, ...], batch_id: str) -> dict[str, str]:
    return {**_common_task_display_map(tasks), _TASK_RUNTIME_BATCH_ID_DISPLAY_KEY: batch_id}


def _projection_batch_id(parent: ToolCall) -> str:
    return parent.display.get(_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY, "").strip()


def _top_level_tool_call(plan: Plan, tool_call_id: int) -> ToolCall | None:
    return next(
        (tool_call for step in plan.steps for tool_call in step.tool_calls if tool_call.tool_call_id == tool_call_id),
        None,
    )


def _is_owned_batch_parent(plan: Plan, parent: ToolCall, parent_tool_call_id: int, batch_id: str) -> bool:
    return (
        _top_level_tool_call(plan, parent_tool_call_id) is parent
        and sum(
            tool_call.tool_call_id == parent_tool_call_id
            for step in plan.steps
            for root in step.tool_calls
            for tool_call in _iter_tool_call_tree(root)
        )
        == 1
        and parent.execution_info.tool_type == ToolType.BUILTIN
        and parent.execution_info.builtin_tool_name == "run_tasks"
        and _projection_batch_id(parent) == batch_id
    )


def _require_owned_batch_parent(plan: Plan, parent: ToolCall, parent_tool_call_id: int, batch_id: str) -> None:
    if not _is_owned_batch_parent(plan, parent, parent_tool_call_id, batch_id):
        raise ProjectionIntegrityError(f"tool-call id {parent_tool_call_id} is not owned by batch {batch_id!r}")


def _has_complete_batch_projection(
    plan: Plan,
    parent_tool_call_id: int,
    runs: list[TaskRun],
    *,
    batch_id: str,
    allow_unmarked: bool = False,
) -> bool:
    parent = _top_level_tool_call(plan, parent_tool_call_id)
    if (
        parent is None
        or parent.tool_name != _parent_tool_call_name()
        or parent.execution_info.tool_type != ToolType.BUILTIN
        or parent.execution_info.builtin_tool_name != "run_tasks"
    ):
        return False
    ordered_runs = sorted(runs, key=lambda run: run.batch_item_index)
    owner_batch_id = _projection_batch_id(parent)
    if owner_batch_id != batch_id and not (allow_unmarked and not owner_batch_id):
        return False
    expected_parent_display = _batch_parent_display([run.spec for run in ordered_runs], batch_id)
    if allow_unmarked and not owner_batch_id:
        expected_parent_display.pop(_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY)
    if parent.display != expected_parent_display:
        return False
    expected_children = [
        (
            run.plan_batch_call_id or 0,
            run.batch_item_index,
            run.spec.title or "TaskRun",
            _task_display_map(run.spec),
        )
        for run in ordered_runs
    ]
    expected_child_ids = [tool_call_id for tool_call_id, _index, _title, _display in expected_children]
    canonical_ids = {parent_tool_call_id, *expected_child_ids}
    plan_id_counts = {tool_call_id: 0 for tool_call_id in canonical_ids}
    for step in plan.steps:
        for tool_call in step.tool_calls:
            for nested in _iter_tool_call_tree(tool_call):
                if nested.tool_call_id in plan_id_counts:
                    plan_id_counts[nested.tool_call_id] += 1
    if (
        any(not tool_call_id for tool_call_id in expected_child_ids)
        or parent_tool_call_id in expected_child_ids
        or len(set(expected_child_ids)) != len(runs)
        or any(count != 1 for count in plan_id_counts.values())
        or len(parent.sub_calls) != len(runs)
        or any(run.parent_tool_call_id != parent_tool_call_id for run in runs)
    ):
        return False
    actual_children = [
        (child.tool_call_id, child.sub_call_index, child.tool_name, child.display)
        for child in parent.sub_calls
    ]
    return actual_children == expected_children


def _iter_tool_call_tree(tool_call: ToolCall):
    yield tool_call
    for child in tool_call.sub_calls:
        yield from _iter_tool_call_tree(child)


def _to_tool_deliverable(deliverable: DeliverableSpec) -> ToolDeliverable:
    if deliverable.kind == "acquired_sandbox" and deliverable.acquired_sandbox_card is not None:
        payload = deliverable.acquired_sandbox_card
        return ToolDeliverable(
            type=ToolDeliverableType.ACQUIRED_SANDBOX,
            acquired_sandbox=ToolDeliverableAcquiredSandbox(
                sandbox_id=payload.sandbox_id,
                sandbox_type=payload.sandbox_type,
                endpoint=payload.endpoint,
                provider_base_url=payload.provider_base_url,
                device_id=payload.device_id,
                display_name=payload.display_name,
                vnc_url=payload.vnc_url,
            ),
        )
    raise ValueError(f"unsupported deliverable kind: {deliverable.kind}")


def _to_deliverable_spec(deliverable: ToolDeliverable) -> DeliverableSpec | None:
    if deliverable.type != ToolDeliverableType.ACQUIRED_SANDBOX:
        return None
    acquired = deliverable.acquired_sandbox
    return DeliverableSpec.acquired_sandbox(
        sandbox_id=acquired.sandbox_id,
        sandbox_type=acquired.sandbox_type,
        endpoint=acquired.endpoint,
        provider_base_url=acquired.provider_base_url,
        device_id=acquired.device_id,
        display_name=acquired.display_name,
        vnc_url=acquired.vnc_url,
    )


_STAGE_LABELS = {
    "plan": "Preparing task",
    "workspace": "Preparing workspace",
    "sandbox": "Acquiring sandbox",
    "execute": "Executing",
    "upload": "Uploading results",
    "release": "Releasing sandbox",
}


def _run_lifecycle_message(
    stage: str,
    run: TaskRun,
    max_attempts: int,
    terminal_result: TaskResult | None,
) -> str:
    if terminal_result is not None:
        return _run_terminal_message(terminal_result)
    label = _STAGE_LABELS.get(stage, stage.replace("_", " ").capitalize() or "Working")
    if stage == "execute" and max_attempts > 1:
        return f"{label} (attempt {run.attempt}/{max_attempts})\u2026"
    return f"{label}\u2026"


def _run_terminal_message(result: TaskResult) -> str:
    summary = (result.summary or "").strip()
    if summary:
        return summary
    if result.status == TaskStatus.COMPLETED:
        return "Task completed."
    if result.status == TaskStatus.CANCELLED:
        return "Task cancelled."
    error = (result.error_message or "").strip()
    if result.status == TaskStatus.FAILED:
        return f"Task failed: {error}" if error else "Task failed."
    if result.status == TaskStatus.BLOCKED:
        return f"Task blocked: {error}" if error else "Task blocked."
    return f"Task ended with status {result.status.value}."


def _parent_initial_message(total: int) -> str:
    if total <= 0:
        return "No tasks to run."
    if total == 1:
        return "Running 1 task\u2026"
    return f"Running {total} tasks\u2026"


def _parent_progress_message(batch: BatchRecord, runs: list[TaskRun]) -> str:
    total = batch.total_count or len(runs)
    if total <= 0:
        return "No tasks to run."
    completed = sum(1 for r in runs if r.status == TaskStatus.COMPLETED)
    failed = sum(1 for r in runs if r.status == TaskStatus.FAILED)
    cancelled = sum(1 for r in runs if r.status == TaskStatus.CANCELLED)
    blocked = sum(1 for r in runs if r.status == TaskStatus.BLOCKED)
    running = sum(1 for r in runs if r.status == TaskStatus.RUNNING)
    queued = sum(1 for r in runs if r.status == TaskStatus.QUEUED)
    parts = [f"{completed}/{total} completed"]
    if running:
        parts.append(f"{running} running")
    if queued:
        parts.append(f"{queued} queued")
    if failed:
        parts.append(f"{failed} failed")
    if cancelled:
        parts.append(f"{cancelled} cancelled")
    if blocked:
        parts.append(f"{blocked} blocked")
    return ", ".join(parts) + "."


def _parent_terminal_message(batch_status: BatchStatus) -> str:
    if batch_status == BatchStatus.COMPLETED:
        return "All tasks completed."
    if batch_status == BatchStatus.PARTIAL:
        return "Tasks completed with failures."
    if batch_status == BatchStatus.FAILED:
        return "Delegated tasks failed."
    if batch_status == BatchStatus.CANCELLED:
        return "Delegated tasks cancelled."
    return f"Tasks ended with status {batch_status.value}."
