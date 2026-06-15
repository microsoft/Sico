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

import pytest

from app.biz.chat.chat import _finish_plan
from app.schemas.conversation.plan import Plan, PlanStep, PlanStepStatus, ToolCall
from app.tools.plan import PlanEditor


def test_plan_editor_allocates_after_existing_parent_and_batch_ids() -> None:
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    plan = Plan(
        steps=[
            PlanStep(
                title="Step",
                tool_calls=[
                    ToolCall(
                        tool_name="run_tasks",
                        tool_call_id=4,
                        sub_calls=[ToolCall(tool_name="TaskRun", tool_call_id=9)],
                    )
                ],
            )
        ]
    )

    assert editor._alloc_tool_call_id(plan) == 10


def test_plan_editor_resyncs_allocation_from_updated_plan() -> None:
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    first_plan = Plan(steps=[PlanStep(title="Step", tool_calls=[ToolCall(tool_name="one", tool_call_id=4)])])
    second_plan = Plan(steps=[PlanStep(title="Step", tool_calls=[ToolCall(tool_name="two", tool_call_id=10)])])

    assert editor._alloc_tool_call_id(first_plan) == 5
    assert editor._alloc_tool_call_id(second_plan) == 11


@pytest.mark.asyncio
async def test_finish_plan_ignores_untouched_existing_plan() -> None:
    class _Editor(PlanEditor):
        def __init__(self) -> None:
            super().__init__(agent_instance_id=1, username="alice@example.com", turn_id=1, conversation_id=10)
            self.plan = Plan(steps=[PlanStep(title="Old", status=PlanStepStatus.IN_PROGRESS)])
            self.updated = False

        async def get_plan(self):
            return self.plan

        async def update_plan(self, plan: Plan) -> None:
            self.updated = True
            self.plan = plan

    editor = _Editor()

    await _finish_plan(editor)

    assert not editor.updated
    assert editor.plan.steps[0].status == PlanStepStatus.IN_PROGRESS
