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
    ToolCallStatus,
    ToolDeliverable,
    ToolDeliverableAcquiredSandbox,
    ToolDeliverableType,
    ToolExecutionInfo,
    ToolType,
)

from ..context import TurnContext
from ..models import TERMINAL_STATUSES, PreparedTaskBatch, TaskSpec
from ..models import BatchRecord, BatchStatus, TaskResult, TaskRun, TaskStatus
from ..progress_events import DeliverableSpec
from ..results import cancelled_result
from ..store import RunStore
from ..time_utils import now_ms as _now_ms
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

    async def create_delegate_tasks_call(self, ctx: TurnContext, prepared: PreparedTaskBatch) -> int:
        """Create the parent tool call that groups task sub_calls."""
        return await ctx.plan_editor.create_tool_call(
            _parent_tool_call_name(prepared),
            _parent_initial_message(len(prepared.batch.tasks)),
            ToolExecutionInfo(tool_type=ToolType.BUILTIN, builtin_tool_name="run_tasks"),
            display=_common_task_display_map(list(prepared.batch.tasks)),
        )

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

    async def mark_delegate_tasks_failed(self, ctx: TurnContext, parent_tool_call_id: int) -> None:
        if not parent_tool_call_id:
            return

        def updater(tool_call) -> None:
            tool_call.tool_call_status = ToolCallStatus.FAILED
            tool_call.message = "Delegated tasks failed."

        await ctx.plan_editor.update_tool_call(parent_tool_call_id, updater)

    async def mark_delegate_tasks_terminal(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        batch_status: BatchStatus,
    ) -> None:
        if not parent_tool_call_id:
            return
        status = tool_call_status_for_batch(batch_status)
        message = _parent_terminal_message(batch_status)

        def updater(tool_call) -> None:
            tool_call.tool_call_status = status
            tool_call.message = message

        await ctx.plan_editor.update_tool_call(parent_tool_call_id, updater)

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
        if run.plan_batch_call_id:
            await ctx.plan_editor.update_tool_call_status(
                run.plan_batch_call_id,
                tool_call_status_for_result(run, result),
            )
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
        stage = current_stage_for_run(
            run,
            active_stage=active_stage,
            terminal_result=terminal_result,
            sandbox_released=sandbox_released,
        )
        max_attempts = max(1, run.execution_policy.retry.max_attempts)
        run_message = _run_lifecycle_message(stage, run, max_attempts, terminal_result)

        def updater(tool_call) -> None:
            # PENDING → RUNNING (or RETRY_RUNNING on retry attempts) once execution starts.
            if terminal_result is None and active_stage is not None and tool_call.tool_call_status == ToolCallStatus.PENDING:
                tool_call.tool_call_status = ToolCallStatus.RETRY_RUNNING if run.attempt > 1 else ToolCallStatus.RUNNING
            tool_call.message = run_message
            info = tool_call.execution_info.task_runtime
            info.current_stage = stage
            info.attempt = run.attempt
            info.max_attempts = max_attempts
            if run.sandbox is not None:
                info.sandbox_id = run.sandbox.sandbox_id
                info.sandbox_type = run.sandbox.type or info.sandbox_type
                info.sandbox_endpoint = run.sandbox.endpoint or info.sandbox_endpoint
            if lease_outcome:
                # Surface dirty-release as a single short note for the renderer.
                if lease_outcome == "dirty":
                    info.latest_progress_message = "Sandbox released with dirty lease."

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

    async def refresh_parent_batch_progress(
        self,
        ctx: TurnContext,
        run: TaskRun,
        *,
        terminal_result: TaskResult | None = None,
        current_status: TaskStatus | None = None,
    ) -> None:
        # No-op: the parent ``Delegate Tasks`` tool call surfaces progress through
        # its sub-calls' structured ``tool_call_status`` and ``task_runtime`` fields.
        _ = (ctx, run, terminal_result, current_status)

    async def publish_parent_batch_progress(self, ctx: TurnContext, batch: BatchRecord, runs: list[TaskRun]) -> None:
        """Update the Delegate-Tasks parent ToolCall.message with a counts summary."""
        parent_tool_call_id = batch.parent_tool_call_id or 0
        if not parent_tool_call_id:
            return
        message = _parent_progress_message(batch, runs)

        def updater(tool_call) -> None:
            tool_call.message = message

        try:
            await ctx.plan_editor.update_tool_call(parent_tool_call_id, updater)
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
        finish_unstarted_tail: bool = False,
        recovering: bool = False,
    ) -> None:
        plan = await ctx.plan_editor.get_plan()
        if plan is None:
            return
        if _mark_parent_step_terminal_if_settled(
            plan,
            parent_tool_call_id,
            batch_status,
            finish_unstarted_tail=finish_unstarted_tail,
            recovering=recovering,
        ):
            await ctx.plan_editor.update_plan(plan)

    async def refresh_batch_run_cards(self, ctx: TurnContext, runs: list[TaskRun]) -> None:
        for run in runs:
            if not run.plan_batch_call_id:
                continue
            try:
                detail = await self._store.get_task_detail(run.run_id, "summary")
            except Exception:
                _LOGGER.debug("failed to load task detail for batch run card run_id=%s", run.run_id, exc_info=True)
                continue
            if detail.result is None:
                continue
            await self.mark_run_terminal(
                ctx,
                detail.run,
                detail.result,
                sandbox_released=detail.run.sandbox_released,
                lease_outcome=detail.run.lease_outcome,
            )

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
