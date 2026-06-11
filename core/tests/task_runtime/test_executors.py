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

"""Unit tests for the task-runtime execution layer.

Covers :class:`DispatchRouter` routing and the :class:`SubAgentExecutor`
control loop in isolation, using an in-memory fake :class:`RunStore` so the
tests stay focused on execution semantics rather than persistence."""

from __future__ import annotations

import time

import pytest

from app.biz.task_runtime.executors import (
    CapabilityCall,
    DispatchRouter,
    FinalAnswer,
    Observation,
    SubAgentAction,
    SubAgentExecutor,
    SubAgentState,
)
from app.biz.task_runtime.models import (
    ErrorClass,
    FencingToken,
    SkillDispatch,
    SubAgentDispatch,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    ToolDispatch,
)


class _FakeStore:
    """Minimal in-memory RunStore subset the executors actually touch."""

    def __init__(self) -> None:
        self.results: dict[str, TaskResult] = {}
        self.progress: list[tuple[str, str]] = []

    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken:
        return FencingToken(run_id=run_id, token=f"{worker_id}-tok", issued_at=0)

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        self.results[run_id] = result

    async def set_progress(self, run_id: str, message: str, *, ts: int | None = None) -> None:
        self.progress.append((run_id, message))


def _sub_agent_run(*, capabilities: tuple[str, ...], max_steps: int | None = None) -> TaskRun:
    return _run(
        TaskSpec(
            task_id="t-sub",
            title="Sub-agent task",
            dispatch=SubAgentDispatch(capabilities=capabilities, max_steps=max_steps),
        )
    )


def _skill_run() -> TaskRun:
    return _run(
        TaskSpec(
            task_id="t-skill",
            title="Skill task",
            dispatch=SkillDispatch(skill_name="android-test"),
        )
    )


def _run(spec: TaskSpec) -> TaskRun:
    return TaskRun(
        run_id=f"run-{spec.task_id}",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key=spec.task_id,
        executor="in_process",
        queued_at=int(time.time() * 1000),
    )


class _ScriptedLLM:
    """Emits a pre-baked sequence of actions, one per ``next_action`` call."""

    def __init__(self, *actions: SubAgentAction) -> None:
        self._actions = list(actions)
        self.seen_steps: list[int] = []

    async def next_action(self, state: SubAgentState) -> SubAgentAction:
        self.seen_steps.append(state.step)
        if not self._actions:
            return FinalAnswer(summary="fallback final")
        return self._actions.pop(0)


class _RecordingInvoker:
    def __init__(self) -> None:
        self.calls: list[CapabilityCall] = []

    async def invoke(self, run: TaskRun, call: CapabilityCall) -> Observation:
        self.calls.append(call)
        return Observation(capability=call.capability, ok=True, content=f"ran {call.capability}")


@pytest.mark.asyncio
async def test_sub_agent_executes_capability_then_finishes() -> None:
    store = _FakeStore()
    llm = _ScriptedLLM(
        CapabilityCall(capability="run_testcase.execute", args={"id": "TC-001"}),
        FinalAnswer(summary="verdict: pass", output="TC-001 passed"),
    )
    invoker = _RecordingInvoker()
    executor = SubAgentExecutor(llm, invoker)

    result = await executor.run(
        _sub_agent_run(capabilities=("run_testcase.execute", "testcase_rewrite.rewrite"), max_steps=8),
        store,
    )

    assert result.status == TaskStatus.COMPLETED
    assert result.summary == "verdict: pass"
    assert [call.capability for call in invoker.calls] == ["run_testcase.execute"]
    assert any("run_testcase.execute" in message for _, message in store.progress)


@pytest.mark.asyncio
async def test_sub_agent_rejects_capability_outside_allow_list() -> None:
    store = _FakeStore()
    llm = _ScriptedLLM(CapabilityCall(capability="rm_rf.everything"))
    executor = SubAgentExecutor(llm, _RecordingInvoker())

    result = await executor.run(_sub_agent_run(capabilities=("echo",)), store)

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.POLICY_DENY


@pytest.mark.asyncio
async def test_sub_agent_truncates_at_step_budget() -> None:
    store = _FakeStore()
    # LLM never returns a FinalAnswer; always asks for another capability call.
    llm = _ScriptedLLM(*[CapabilityCall(capability="echo") for _ in range(10)])
    executor = SubAgentExecutor(llm, _RecordingInvoker())

    result = await executor.run(_sub_agent_run(capabilities=("echo",), max_steps=3), store)

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.TRANSIENT
    assert llm.seen_steps == [1, 2, 3]


class _MarkerExecutor:
    def __init__(self, marker: str) -> None:
        self.marker = marker

    async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
        now = int(time.time() * 1000)
        return TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.COMPLETED,
            title=run.spec.title,
            summary=self.marker,
            started_at=now,
            ended_at=now,
            duration_ms=0,
        )


@pytest.mark.asyncio
async def test_router_sends_sub_agent_to_sub_agent_executor() -> None:
    router = DispatchRouter(
        tool=_MarkerExecutor("tool"),
        sub_agent=_MarkerExecutor("sub_agent"),
    )

    result = await router.run(_sub_agent_run(capabilities=("echo",)), _FakeStore())

    assert result.summary == "sub_agent"


@pytest.mark.asyncio
async def test_router_sends_tool_to_tool_by_default() -> None:
    router = DispatchRouter(tool=_MarkerExecutor("tool"), sub_agent=_MarkerExecutor("sub_agent"))
    tool_run = _run(TaskSpec(task_id="t-tool", title="Echo", dispatch=ToolDispatch(tool_name="echo")))

    result = await router.run(tool_run, _FakeStore())

    assert result.summary == "tool"


@pytest.mark.asyncio
async def test_router_ignores_execution_policy_executor_and_uses_tool() -> None:
    # The execution backend (local/docker/k8s) is resolved inside the executor via
    # command_backend.select_backend, not by routing here. The execution policy's
    # executor marker must therefore not influence routing — the tool run still
    # lands on the tool executor.
    router = DispatchRouter(tool=_MarkerExecutor("tool"), sub_agent=_MarkerExecutor("sub_agent"))
    tool_run = _run(TaskSpec(task_id="t-tool", title="Skill", dispatch=ToolDispatch(tool_name="echo")))
    tool_run.execution_policy = TaskExecutionPolicy(executor="command_backend")

    result = await router.run(tool_run, _FakeStore())

    assert result.summary == "tool"


@pytest.mark.asyncio
async def test_router_rejects_sub_agent_when_unconfigured() -> None:
    router = DispatchRouter(tool=_MarkerExecutor("tool"))

    result = await router.run(_sub_agent_run(capabilities=("echo",)), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.USER_INPUT


@pytest.mark.asyncio
async def test_router_rejects_skill_when_unconfigured() -> None:
    router = DispatchRouter(tool=_MarkerExecutor("tool"))

    result = await router.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.USER_INPUT


@pytest.mark.asyncio
async def test_router_sends_skill_to_skill_executor() -> None:
    router = DispatchRouter(tool=_MarkerExecutor("tool"), skill=_MarkerExecutor("skill"))

    result = await router.run(_skill_run(), _FakeStore())

    assert result.summary == "skill"


class _CapturingExecutor:
    """Records the run it received and returns a canned result."""

    def __init__(self, marker: str, *, ok: bool = True) -> None:
        self.marker = marker
        self.ok = ok
        self.seen: list[TaskRun] = []

    async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
        self.seen.append(run)
        now = int(time.time() * 1000)
        return TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.COMPLETED if self.ok else TaskStatus.FAILED,
            title=run.spec.title,
            summary=self.marker if self.ok else "",
            output=f"{self.marker}:{run.spec.kind}" if self.ok else "",
            error_message="" if self.ok else "boom",
            started_at=now,
            ended_at=now,
            duration_ms=0,
        )


@pytest.mark.asyncio
async def test_executor_invoker_routes_tool_to_tool_executor() -> None:
    from app.biz.task_runtime.executors import ExecutorCapabilityInvoker

    tool_exec = _CapturingExecutor("tool")
    skill_exec = _CapturingExecutor("skill")
    invoker = ExecutorCapabilityInvoker(tool_exec, skill_exec, _FakeStore())
    parent = _sub_agent_run(capabilities=("echo",))

    observation = await invoker.invoke(parent, CapabilityCall(capability="echo", args={"text": "hi"}))

    assert observation.ok is True
    assert observation.capability == "echo"
    assert len(tool_exec.seen) == 1 and not skill_exec.seen
    child = tool_exec.seen[0]
    assert child.spec.kind == "tool"
    assert child.spec.tool_name == "echo"
    assert child.spec.args == {"text": "hi"}
    assert child.run_id != parent.run_id and child.run_id.startswith(parent.run_id)


@pytest.mark.asyncio
async def test_executor_invoker_routes_skill_action_to_skill() -> None:
    from app.biz.task_runtime.executors import ExecutorCapabilityInvoker

    tool_exec = _CapturingExecutor("tool")
    skill_exec = _CapturingExecutor("skill")
    invoker = ExecutorCapabilityInvoker(tool_exec, skill_exec, _FakeStore())
    parent = _sub_agent_run(capabilities=("run_testcase.execute",))

    observation = await invoker.invoke(parent, CapabilityCall(capability="run_testcase.execute", args={"id": "TC-1"}))

    assert observation.ok is True
    assert len(skill_exec.seen) == 1 and not tool_exec.seen
    child = skill_exec.seen[0]
    assert child.spec.kind == "skill"
    assert child.spec.skill_name == "run_testcase"
    assert child.spec.action_name == "execute"


@pytest.mark.asyncio
async def test_executor_invoker_maps_failure_to_observation() -> None:
    from app.biz.task_runtime.executors import ExecutorCapabilityInvoker

    tool_exec = _CapturingExecutor("tool", ok=False)
    invoker = ExecutorCapabilityInvoker(tool_exec, _CapturingExecutor("skill"), _FakeStore())

    observation = await invoker.invoke(_sub_agent_run(capabilities=("echo",)), CapabilityCall(capability="echo"))

    assert observation.ok is False
    assert observation.content == "boom"


@pytest.mark.asyncio
async def test_executor_invoker_reports_crash_as_failed_observation() -> None:
    from app.biz.task_runtime.executors import ExecutorCapabilityInvoker

    class _Boom:
        async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
            raise RuntimeError("kaboom")

    invoker = ExecutorCapabilityInvoker(_Boom(), _Boom(), _FakeStore())

    observation = await invoker.invoke(_sub_agent_run(capabilities=("echo",)), CapabilityCall(capability="echo"))

    assert observation.ok is False
    assert "kaboom" in observation.content
