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

"""Batch-level helpers for the task_runtime rendering layer.

Per-run progress is carried by the structured ``TaskRuntimeExecutionInfo``
fields on each sub-call, so the parent batch tool call needs no aggregated
running list. This module holds the remaining batch helpers: plan-step
terminalisation and the snapshot utilities used by the submitter / progress sink.
"""

from __future__ import annotations

from app.schemas.conversation.plan import (
    Plan,
    PlanStep,
    PlanStepStatus,
    ToolCallStatus,
)

from ...models import BatchStatus, TaskResult, TaskRun


_ACTIVE_TOOL_CALL_STATUSES = {
    ToolCallStatus.UNKNOWN,
    ToolCallStatus.PENDING,
    ToolCallStatus.RUNNING,
    ToolCallStatus.RETRY_RUNNING,
    ToolCallStatus.FAILED_ANALYZING,
}


RECOVERY_TAIL_PLACEHOLDER_TITLES = frozenset(
    {
        "summarize result",
        "summarize results",
        "summarise result",
        "summarise results",
        "summarize execution result",
        "summarize execution results",
        "summarize delegated task result",
        "summarize delegated task results",
        "report result",
        "report results",
        "final response",
    }
)


_TERMINAL_PLAN_STEP_STATUSES = {
    PlanStepStatus.COMPLETED,
    PlanStepStatus.FAILED,
    PlanStepStatus.CANCELLED,
    PlanStepStatus.REQUIRE_HUMAN_INPUT,
}


# ---------------------------------------------------------------------------
# Parent plan-step terminalisation helpers
# ---------------------------------------------------------------------------


def tool_call_status_for_batch(status: BatchStatus) -> ToolCallStatus:
    """Map a batch's terminal status to a structured parent tool-call status."""
    return ToolCallStatus.SUCCESSFUL if status == BatchStatus.COMPLETED else ToolCallStatus.FAILED


def _mark_parent_step_terminal_if_settled(
    plan: Plan,
    parent_tool_call_id: int,
    batch_status,
    *,
    finish_unstarted_tail: bool = False,
    recovering: bool = False,
) -> bool:
    if not parent_tool_call_id:
        return False
    fallback_step: PlanStep | None = None
    fallback_step_index = -1
    fallback_allowed = len(plan.steps) == 1
    for index, step in enumerate(plan.steps):
        if not any(_tool_call_tree_contains_id(tool_call, parent_tool_call_id) for tool_call in step.tool_calls):
            if fallback_allowed and not step.tool_calls and _step_can_terminalize(step):
                fallback_step = step
                fallback_step_index = index
            continue
        changed = False
        if recovering:
            # Crash recovery: the process that owned this turn is dead, so any
            # sibling tool call still in an active status (e.g. a Read that
            # finished but never had its status flipped) is an orphan that will
            # never advance on its own and would otherwise pin the step in
            # IN_PROGRESS forever. Settle them so the step can terminalise.
            changed = _force_settle_active_tool_calls(step, keep_tool_call_id=parent_tool_call_id)
        if not _step_tool_calls_settled(step):
            return changed
        if _step_can_terminalize(step):
            step.status = _terminal_plan_step_status(batch_status)
            changed = True
        elif step.status not in _TERMINAL_PLAN_STEP_STATUSES:
            return changed
        if finish_unstarted_tail:
            changed = _finish_unstarted_tail_steps_after(plan, index) or changed
        return changed
    if fallback_step is None:
        return False
    fallback_step.status = _terminal_plan_step_status(batch_status)
    if finish_unstarted_tail:
        _finish_unstarted_tail_steps_after(plan, fallback_step_index)
    return True


def _finish_unstarted_tail_steps_after(plan: Plan, step_index: int) -> bool:
    if step_index < 0 or step_index >= len(plan.steps) - 1:
        return False
    changed = False
    kept_steps: list[PlanStep] = []
    for index, step in enumerate(plan.steps):
        if index <= step_index or step.tool_calls or not _step_can_terminalize(step):
            kept_steps.append(step)
            continue
        changed = True
        if not _is_recovery_tail_placeholder(step):
            step.status = PlanStepStatus.CANCELLED
            kept_steps.append(step)
    if changed:
        plan.steps = kept_steps
    return changed


def _is_recovery_tail_placeholder(step: PlanStep) -> bool:
    title = " ".join(step.title.casefold().strip().split()).strip(" .:")
    return title in RECOVERY_TAIL_PLACEHOLDER_TITLES


def _step_can_terminalize(step: PlanStep) -> bool:
    return step.status in {PlanStepStatus.IN_PROGRESS, PlanStepStatus.PENDING, PlanStepStatus.UNKNOWN}


def _tool_call_tree_contains_id(tool_call, tool_call_id: int) -> bool:
    if tool_call.tool_call_id == tool_call_id:
        return True
    return any(_tool_call_tree_contains_id(child, tool_call_id) for child in tool_call.sub_calls)


def _step_tool_calls_settled(step: PlanStep) -> bool:
    return bool(step.tool_calls) and all(_tool_call_settled(tool_call) for tool_call in step.tool_calls)


def _tool_call_settled(tool_call) -> bool:
    """A tool call has settled once its status is terminal and so are all sub-calls."""
    if tool_call.tool_call_status in _ACTIVE_TOOL_CALL_STATUSES:
        return False
    return all(_tool_call_settled(child) for child in tool_call.sub_calls)


def _force_settle_active_tool_calls(step: PlanStep, *, keep_tool_call_id: int) -> bool:
    """Drive orphaned active tool calls in a recovered step to a terminal status.

    Used only on crash recovery: with the owning process gone, any tool call
    left in an active status will never progress, so it is settled to ``FAILED``
    — mirroring stranded-run recovery, which records an honest failure rather
    than assuming a success it cannot verify. The authoritative parent batch
    tool call (``keep_tool_call_id``) is left untouched: the caller has already
    set it from the batch result.
    """
    changed = False
    for tool_call in step.tool_calls:
        changed = _force_settle_tool_call_tree(tool_call, keep_tool_call_id) or changed
    return changed


def _force_settle_tool_call_tree(tool_call, keep_tool_call_id: int) -> bool:
    changed = False
    if tool_call.tool_call_id != keep_tool_call_id and tool_call.tool_call_status in _ACTIVE_TOOL_CALL_STATUSES:
        tool_call.tool_call_status = ToolCallStatus.FAILED
        changed = True
    for child in tool_call.sub_calls:
        changed = _force_settle_tool_call_tree(child, keep_tool_call_id) or changed
    return changed


def _terminal_plan_step_status(batch_status):
    from ...models import BatchStatus as _BatchStatus

    if batch_status == _BatchStatus.CANCELLED:
        return PlanStepStatus.CANCELLED
    if batch_status in {_BatchStatus.FAILED, _BatchStatus.TIMED_OUT, _BatchStatus.BLOCKED}:
        return PlanStepStatus.FAILED
    return PlanStepStatus.COMPLETED


# ---------------------------------------------------------------------------
# Run / batch snapshot helpers (used by submitter + progress sink).
# ---------------------------------------------------------------------------


def _planned_batch_sizes(total_count: int, concurrency: int) -> tuple[int, ...]:
    if total_count <= 0:
        return ()
    step = max(1, concurrency)
    return tuple(min(step, total_count - index) for index in range(0, total_count, step))


def _with_result_snapshots(runs: list[TaskRun], results: list[TaskResult]) -> list[TaskRun]:
    results_by_run_id = {result.run_id: result for result in results}
    if not results_by_run_id:
        return runs
    next_runs: list[TaskRun] = []
    for run in runs:
        result = results_by_run_id.get(run.run_id)
        if result is None:
            next_runs.append(run)
            continue
        updates: dict[str, object] = {
            "status": result.status,
            "last_error_class": result.error_class,
            "last_error": result.error_message,
        }
        if result.started_at is not None and run.started_at is None:
            updates["started_at"] = result.started_at
        if result.ended_at is not None:
            updates["ended_at"] = result.ended_at
        if result.sandbox is not None:
            updates["sandbox"] = result.sandbox
        next_runs.append(run.model_copy(update=updates))
    return next_runs


# Silence unused-import warnings for symbols re-exported for type clarity.
__all__ = [
    "RECOVERY_TAIL_PLACEHOLDER_TITLES",
    "tool_call_status_for_batch",
    "_mark_parent_step_terminal_if_settled",
    "_planned_batch_sizes",
    "_with_result_snapshots",
]
