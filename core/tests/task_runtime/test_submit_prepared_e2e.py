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

"""End-to-end smoke test for the refactored task runtime.

Drives the *exact* heterogeneous ``PreparedTaskBatch`` from the design example
through ``TaskManager.submit_prepared`` using only local stand-ins:

* ``echo`` Ã¢â‚¬â€ a real built-in tool run by :class:`ToolExecutor`.
* ``file_convert`` skill Ã¢â‚¬â€ routed through a fake :class:`SkillExecutor` stand-in
  so the flow does not shell out to a real skill subprocess.
* sub-agent Ã¢â‚¬â€ a :class:`SubAgentExecutor` driven by a scripted LLM + recording
  capability invoker, wired through a :class:`DispatchRouter`; its ``aio``
  sandbox lease is served by the :class:`InMemorySandboxLeaseManager`.

This proves the manager composes its collaborators (submitter, scheduler, run
coordinator, sandbox coordinator, progress sink) into a working
pipeline that mixes tool / skill / sub-agent dispatch, isolated-copy and
run-workspace modes, and a real sandbox acquire/release round-trip."""

from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.artifact_store import FileArtifactStore
from app.biz.task_runtime.context import TurnContext
from app.biz.task_runtime.executors.command_backend import LocalBackend
from app.biz.task_runtime.executors import (
    CapabilityCall,
    DispatchRouter,
    FinalAnswer,
    Observation,
    SubAgentAction,
    SubAgentExecutor,
    SubAgentState,
)
from app.biz.task_runtime.models import PreparedTaskBatch, TaskBatchInput
from app.biz.task_runtime.executors.tool_executor import ToolExecutor
from app.biz.task_runtime.manager import TaskManager
from app.biz.task_runtime.models import (
    SkillDispatch,
    SubAgentDispatch,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    ToolDispatch,
)
from app.biz.task_runtime.sandbox import InMemorySandboxLeaseManager
from app.biz.task_runtime.store import FileRunStore
from app.schemas.conversation.plan import Plan
from app.tools.plan import PlanEditor


class _FakePlanEditor(PlanEditor):
    """In-memory plan editor: records streaming UI mutations without a backend."""

    def __init__(self) -> None:
        self.plan: Plan | None = None
        self.next_tool_call_id = 0
        self.messages: dict[int, str] = {}
        self.deliverables: dict[int, list] = {}
        self.cancelled = False

    async def get_plan(self) -> Plan | None:
        return self.plan

    async def update_plan(self, plan: Plan) -> None:
        self.plan = plan

    async def create_tool_call(
        self,
        name,
        initial_message,
        execution_info=None,
        parent_tool_call_id=None,
        sub_call_index=0,
        display=None,
        tool_call_status=None,
    ):
        self.next_tool_call_id += 1
        self.messages[self.next_tool_call_id] = initial_message
        return self.next_tool_call_id

    async def update_tool_call_message(self, tool_call_id: int, message: str):
        self.messages[tool_call_id] = message
        return None

    async def update_tool_call(self, tool_call_id: int, updater):
        tool_call = SimpleNamespace(
            deliverables=self.deliverables.get(tool_call_id, []),
            tool_call_status=None,
            execution_info=SimpleNamespace(
                task_runtime=SimpleNamespace(
                    current_stage="",
                    sandbox_id="",
                    sandbox_type="",
                    sandbox_endpoint="",
                    attempt=0,
                    max_attempts=0,
                    latest_progress_message="",
                )
            ),
        )
        updater(tool_call)
        self.deliverables[tool_call_id] = tool_call.deliverables
        return tool_call

    async def is_plan_cancelled(self) -> bool:
        return self.cancelled


class _ScriptedSubAgentLLM:
    """Emits a fixed action sequence, one per ``next_action`` invocation."""

    def __init__(self, *actions: SubAgentAction) -> None:
        self._actions = list(actions)
        self.seen_steps: list[int] = []

    async def next_action(self, state: SubAgentState) -> SubAgentAction:
        self.seen_steps.append(state.step)
        if not self._actions:
            return FinalAnswer(summary="done")
        return self._actions.pop(0)


class _RecordingInvoker:
    """Captures capability calls and returns a successful observation each time."""

    def __init__(self) -> None:
        self.calls: list[CapabilityCall] = []

    async def invoke(self, run: TaskRun, call: CapabilityCall) -> Observation:
        self.calls.append(call)
        return Observation(capability=call.capability, ok=True, content=f"ran {call.capability}")


def _turn_context() -> TurnContext:
    return TurnContext(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        conversation_id=1,
        turn_id=1,
        plan_editor=_FakePlanEditor(),
    )


class _FakeSkillExecutor:
    """Local stand-in for the real skill subprocess invocation."""

    async def run(self, run: TaskRun, store) -> TaskResult:
        now = int(time.time() * 1000)
        return TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.COMPLETED,
            title=run.spec.title,
            summary=f"converted {run.spec.args.get('path', '')} to markdown",
            output="# converted",
            started_at=now,
            ended_at=now,
            duration_ms=0,
        )


@pytest.mark.asyncio
async def test_submit_prepared_runs_heterogeneous_batch_e2e(tmp_path: Path) -> None:
    # Scripted sub-agent: call one allow-listed capability, then finish.
    llm = _ScriptedSubAgentLLM(
        CapabilityCall(capability="run_testcase.execute", args={"testcase_id": "TC-001"}),
        FinalAnswer(summary="TC-001 rewritten and executed", output="verdict: pass"),
    )
    invoker = _RecordingInvoker()
    router = DispatchRouter(
        tool=ToolExecutor(
            artifact_store=FileArtifactStore(tmp_path / "artifacts"),
            sandbox_backend=LocalBackend(),
        ),
        sub_agent=SubAgentExecutor(llm, invoker),
        skill=_FakeSkillExecutor(),
    )

    manager = TaskManager(
        FileRunStore(tmp_path / "turn" / "results"),
        router,
        max_concurrency=3,
        sandbox_lease_manager=InMemorySandboxLeaseManager(capacities={"android": 1}),
    )

    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(
                TaskSpec(
                    task_id="t1",
                    title="Echo greeting",
                    dispatch=ToolDispatch(tool_name="echo"),
                    args={"message": "hello"},
                ),
                TaskSpec(
                    task_id="t2",
                    title="Convert PDF to markdown",
                    dispatch=SkillDispatch(skill_name="file_convert", action_name="to_markdown"),
                    args={"path": "input.pdf"},
                ),
                TaskSpec(
                    task_id="t3",
                    title="Auto-rewrite and execute TC-001",
                    instructions="Rewrite the failing testcase, then execute it and report the verdict.",
                    dispatch=SubAgentDispatch(
                        capabilities=("testcase_rewrite.rewrite", "run_testcase.execute"),
                        max_steps=8,
                    ),
                    args={"testcase_id": "TC-001"},
                    required_sandbox="android",
                ),
            ),
            join_strategy="all_success",
            description="Process the user-uploaded testcase report",
        ),
        batch_metadata={
            "source": "chat_turn",
            "planner_mode": "lead",
            "upstream_request_id": "req-9f3c2a",
        },
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    # All three heterogeneous dispatch kinds completed.
    assert result.completed_count == 3
    assert result.failed_count == 0
    assert result.status == TaskStatus.COMPLETED

    # The sub-agent only invoked an allow-listed capability.
    assert [call.capability for call in invoker.calls] == ["run_testcase.execute"]

    # Caller-supplied batch metadata is preserved verbatim; runtime-owned
    # observability is namespaced under the reserved ``_task_runtime`` key so it
    # can never collide with a caller-provided field.
    batch = await manager.store.get_batch(result.batch_id)
    assert batch is not None
    assert (
        batch.metadata.items()
        >= {
            "source": "chat_turn",
            "planner_mode": "lead",
            "upstream_request_id": "req-9f3c2a",
        }.items()
    )
    sandbox_plans = batch.metadata["_task_runtime"]["sandbox_plans"]
    assert [plan["sandbox_type"] for plan in sandbox_plans] == ["android"]
    assert sandbox_plans[0]["task_count"] == 1

    # Per-task verdicts are exposed in the aggregated result.
    by_task = {item.task_id: item for item in result.results}
    assert by_task["t1"].status == TaskStatus.COMPLETED
    assert by_task["t2"].status == TaskStatus.COMPLETED
    assert by_task["t3"].status == TaskStatus.COMPLETED
    assert by_task["t3"].summary == "TC-001 rewritten and executed"
