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

"""Sub-agent executor: a bounded LLM loop over a capability allow-list.

A ``sub_agent`` task is the runtime's escape hatch for work that needs several
tool/skill calls woven together by reasoning (e.g. "rewrite TC-001 to the latest
schema, execute it, report the verdict"). It is deliberately the *only* dispatch
kind allowed to make more than one capability call.

The executor owns just the control loop and budget. The two things it cannot do
deterministically — *decide the next action* (the LLM) and *actually invoke a
capability* (the tool/skill layer) — are injected as small protocols, which also
makes the whole executor trivially stubbable in tests and the local e2e example.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

from ..models import ErrorClass, SkillDispatch, TaskResult, TaskRun, TaskSpec, TaskStatus, ToolDispatch
from ..store import RunStore
from ..time_utils import now_ms as _now_ms

if TYPE_CHECKING:
    from .base import Executor

DEFAULT_MAX_STEPS = 12


@dataclass(frozen=True, slots=True)
class CapabilityCall:
    """The LLM asks to invoke one allow-listed capability."""

    capability: str
    args: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class FinalAnswer:
    """The LLM declares the task done."""

    summary: str
    output: str = ""


SubAgentAction = CapabilityCall | FinalAnswer


@dataclass(frozen=True, slots=True)
class Observation:
    """The outcome of a capability call, fed back into the loop."""

    capability: str
    ok: bool
    content: str


@dataclass
class SubAgentState:
    """Everything the policy/LLM needs to choose the next action."""

    run: TaskRun
    capabilities: tuple[str, ...]
    step: int
    max_steps: int
    history: list[Observation] = field(default_factory=list)


class SubAgentLLM(Protocol):
    """Chooses the next action given the current loop state.

    Real implementations wrap the chat/LLM layer; tests supply a deterministic
    stub. Implementations MUST only ever return :class:`CapabilityCall` for a
    capability present in ``state.capabilities`` — the executor enforces this
    and fails the run on violation rather than trusting the model.
    """

    async def next_action(self, state: SubAgentState) -> SubAgentAction: ...


class CapabilityInvoker(Protocol):
    """Executes a single allow-listed capability call.

    A capability name is either a builtin tool (``"echo"``) or a
    ``skill.action`` pair (``"run_testcase.execute"``). The invoker is what
    bridges the sub-agent loop back to the local/container execution layer.
    """

    async def invoke(self, run: TaskRun, call: CapabilityCall) -> Observation: ...


class ExecutorCapabilityInvoker:
    """Concrete :class:`CapabilityInvoker` bridging a call to the real executors.

    A capability whose name contains a ``.`` is a ``skill.action`` pair routed
    to the skill executor; a bare name (``"echo"``, ``"run_command"``) is a
    builtin tool routed to the local executor. Each call runs as a derived
    child :class:`TaskRun` so the standard executor contract (claim → run →
    write_result) is reused unchanged, and the resulting :class:`TaskResult` is
    folded back into an :class:`Observation` for the loop. The child inherits
    the parent run's identity/workspace; only ``run_id`` and ``spec`` differ so
    sibling capability calls never collide in the store.
    """

    def __init__(
        self,
        tool_executor: "Executor",
        skill_executor: "Executor",
        store: RunStore,
    ) -> None:
        self._tool_executor = tool_executor
        self._skill_executor = skill_executor
        self._store = store

    async def invoke(self, run: TaskRun, call: CapabilityCall) -> Observation:
        is_skill = "." in call.capability
        child = run.model_copy(update={"run_id": _child_run_id(run, call), "spec": _capability_spec(run, call)})
        executor = self._skill_executor if is_skill else self._tool_executor
        try:
            result = await executor.run(child, self._store)
        except Exception as exc:  # noqa: BLE001 - report any capability fault as a failed observation.
            return Observation(capability=call.capability, ok=False, content=f"Capability {call.capability!r} crashed: {exc}")
        return _observation_from_result(call.capability, result)


def _capability_spec(parent: TaskRun, call: CapabilityCall) -> TaskSpec:
    if "." in call.capability:
        skill_name, _, action_name = call.capability.partition(".")
        dispatch: SkillDispatch | ToolDispatch = SkillDispatch(skill_name=skill_name, action_name=action_name)
    else:
        dispatch = ToolDispatch(tool_name=call.capability)
    return TaskSpec(
        task_id=f"{parent.spec.task_id}:{call.capability}",
        title=f"{parent.spec.title} · {call.capability}",
        dispatch=dispatch,
        args=dict(call.args),
        required_sandbox=parent.spec.required_sandbox,
    )


def _child_run_id(parent: TaskRun, call: CapabilityCall) -> str:
    return f"{parent.run_id}:{call.capability}:{uuid.uuid4().hex[:8]}"


def _observation_from_result(capability: str, result: TaskResult) -> Observation:
    ok = result.status == TaskStatus.COMPLETED
    content = result.output or result.summary or result.error_message or ""
    return Observation(capability=capability, ok=ok, content=content)


class SubAgentExecutor:
    """Runs a ``sub_agent`` task as a bounded, allow-listed reasoning loop."""

    def __init__(
        self,
        llm: SubAgentLLM,
        invoker: CapabilityInvoker,
        *,
        default_max_steps: int = DEFAULT_MAX_STEPS,
        worker_id: str = "sub-agent-executor",
    ) -> None:
        self._llm = llm
        self._invoker = invoker
        self._default_max_steps = default_max_steps
        self._worker_id = worker_id

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        token = await store.claim_run(run.run_id, self._worker_id)
        started_at = _now_ms()
        dispatch = run.spec.dispatch
        # The allow-list is the contract handed down in the TaskSpec dispatch; the
        # executor never widens it. An empty grant means the loop can only reach a
        # final answer — the caller (chat planner/adapter) owns capability scope.
        capabilities = tuple(getattr(dispatch, "capabilities", ()) or ())
        max_steps = getattr(dispatch, "max_steps", None) or self._default_max_steps

        state = SubAgentState(run=run, capabilities=capabilities, step=0, max_steps=max_steps)
        try:
            result = await self._loop(run, store, token, state, started_at)
        except Exception as exc:  # noqa: BLE001 - surface any loop fault as a failed run.
            result = _failed(run, started_at, ErrorClass.INTERNAL, f"Sub-agent loop crashed: {exc}")
        await store.write_result(run.run_id, result, token)
        return result

    async def _loop(
        self,
        run: TaskRun,
        store: RunStore,
        token: object,
        state: SubAgentState,
        started_at: int,
    ) -> TaskResult:
        for step in range(1, state.max_steps + 1):
            state.step = step
            action = await self._llm.next_action(state)

            if isinstance(action, FinalAnswer):
                return _completed(run, started_at, action.summary, action.output)

            if action.capability not in state.capabilities:
                return _failed(
                    run,
                    started_at,
                    ErrorClass.POLICY_DENY,
                    f"Sub-agent requested disallowed capability {action.capability!r}; allow-list is {list(state.capabilities)}.",
                )

            await store.set_progress(run.run_id, f"step {step}: {action.capability}", ts=_now_ms())
            observation = await self._invoker.invoke(run, action)
            state.history.append(observation)

        return _failed(
            run,
            started_at,
            ErrorClass.TRANSIENT,
            f"Sub-agent reached its step budget ({state.max_steps}) without a final answer.",
        )


def _completed(run: TaskRun, started_at: int, summary: str, output: str) -> TaskResult:
    ended_at = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary=summary or "Sub-agent completed.",
        output=output or summary,
        sandbox=run.sandbox,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=max(0, ended_at - started_at),
    )


def _failed(run: TaskRun, started_at: int, error_class: ErrorClass, message: str) -> TaskResult:
    ended_at = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary=message,
        error_class=error_class,
        error_message=message,
        sandbox=run.sandbox,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=max(0, ended_at - started_at),
    )
