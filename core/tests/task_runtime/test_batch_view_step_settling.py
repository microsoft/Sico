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

"""Regression tests for plan-step settling during crash recovery.

Models the production turn-9 incident: a delegated-execution step whose batch
tool call (``Run Tasks``) had already reconciled to a terminal status, but whose
sibling ``Read`` tool call was orphaned in ``RUNNING`` because the owning process
crashed before its status flip was persisted. The orphan pinned the step in
``IN_PROGRESS`` forever, so the UI spun even though the turn was over.

During recovery the settling helper must force orphaned active siblings to a
terminal status so the step can terminalise; during live execution it must stay
conservative and leave still-active siblings alone.
"""

from __future__ import annotations

from app.biz.task_runtime.models import BatchStatus
from app.biz.task_runtime.presentation.rendering.batch_view import _mark_parent_step_terminal_if_settled
from app.schemas.conversation.plan import Plan, PlanStep, PlanStepStatus, ToolCall, ToolCallStatus

PARENT_TOOL_CALL_ID = 2


def _build_turn9_plan() -> Plan:
    """A single in-progress step owning a terminal batch + an orphaned Read."""
    return Plan(
        steps=[
            PlanStep(
                title="委派执行工作簿中的测试用例",
                status=PlanStepStatus.IN_PROGRESS,
                tool_calls=[
                    ToolCall(
                        tool_name="Read",
                        tool_call_id=1,
                        tool_call_status=ToolCallStatus.RUNNING,
                    ),
                    ToolCall(
                        tool_name="Run Tasks",
                        tool_call_id=PARENT_TOOL_CALL_ID,
                        tool_call_status=ToolCallStatus.FAILED,
                    ),
                ],
            ),
        ],
    )


def test_recovery_force_settles_orphan_sibling_and_terminalizes_step() -> None:
    plan = _build_turn9_plan()

    changed = _mark_parent_step_terminal_if_settled(
        plan,
        PARENT_TOOL_CALL_ID,
        BatchStatus.FAILED,
        recovering=True,
    )

    step = plan.steps[0]
    read, run_tasks = step.tool_calls
    assert changed is True
    # The orphaned Read is settled to FAILED (honest failure, never assumed success).
    assert read.tool_call_status == ToolCallStatus.FAILED
    # The authoritative parent batch tool call is left untouched.
    assert run_tasks.tool_call_status == ToolCallStatus.FAILED
    # With every tool call settled, the step terminalises from the batch status.
    assert step.status == PlanStepStatus.FAILED


def test_live_execution_leaves_active_sibling_alone() -> None:
    plan = _build_turn9_plan()

    changed = _mark_parent_step_terminal_if_settled(
        plan,
        PARENT_TOOL_CALL_ID,
        BatchStatus.FAILED,
        recovering=False,
    )

    step = plan.steps[0]
    read, run_tasks = step.tool_calls
    # Live path is conservative: the still-running Read is preserved, so the step
    # stays IN_PROGRESS and the agent loop can flip the sibling itself.
    assert changed is False
    assert read.tool_call_status == ToolCallStatus.RUNNING
    assert run_tasks.tool_call_status == ToolCallStatus.FAILED
    assert step.status == PlanStepStatus.IN_PROGRESS


def test_recovery_settles_orphaned_sub_calls() -> None:
    plan = Plan(
        steps=[
            PlanStep(
                title="delegated execution",
                status=PlanStepStatus.IN_PROGRESS,
                tool_calls=[
                    ToolCall(
                        tool_name="Run Tasks",
                        tool_call_id=PARENT_TOOL_CALL_ID,
                        tool_call_status=ToolCallStatus.FAILED,
                        sub_calls=[
                            ToolCall(
                                tool_name="run",
                                tool_call_id=10,
                                tool_call_status=ToolCallStatus.RUNNING,
                            ),
                        ],
                    ),
                ],
            ),
        ],
    )

    changed = _mark_parent_step_terminal_if_settled(
        plan,
        PARENT_TOOL_CALL_ID,
        BatchStatus.FAILED,
        recovering=True,
    )

    step = plan.steps[0]
    assert changed is True
    # The parent stays as set by the caller; its orphaned child is settled.
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.FAILED
    assert step.tool_calls[0].sub_calls[0].tool_call_status == ToolCallStatus.FAILED
    assert step.status == PlanStepStatus.FAILED


def test_recovery_preserves_already_settled_tool_calls() -> None:
    plan = Plan(
        steps=[
            PlanStep(
                title="all settled",
                status=PlanStepStatus.IN_PROGRESS,
                tool_calls=[
                    ToolCall(
                        tool_name="Read",
                        tool_call_id=1,
                        tool_call_status=ToolCallStatus.SUCCESSFUL,
                    ),
                    ToolCall(
                        tool_name="Run Tasks",
                        tool_call_id=PARENT_TOOL_CALL_ID,
                        tool_call_status=ToolCallStatus.SUCCESSFUL,
                    ),
                ],
            ),
        ],
    )

    changed = _mark_parent_step_terminal_if_settled(
        plan,
        PARENT_TOOL_CALL_ID,
        BatchStatus.COMPLETED,
        recovering=True,
    )

    step = plan.steps[0]
    assert changed is True
    # Successful Read is not clobbered to FAILED — only active orphans are settled.
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.COMPLETED
