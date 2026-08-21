"""Unit tests for the task-runtime execution layer.

Covers :class:`DispatchRouter` routing and the :class:`SubAgentExecutor`
control loop in isolation, using an in-memory fake :class:`RunStore` so the
tests stay focused on execution semantics rather than persistence."""

from __future__ import annotations

import asyncio
import contextlib
import time
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from app.biz.task_runtime.capabilities.descriptors import (
    CapabilityBinding,
    CapabilityDescriptor,
    ResolveContext,
)
from app.biz.task_runtime.capabilities.ids import normalize_capability_id
from app.biz.task_runtime.sub_agent.profile import (
    ALL_CAPABILITIES,
    AgentProfile,
    CompletionPolicyDecision,
    InvocationPolicyContext,
    InvocationPolicyDecision,
    ProfileDescriptor,
    ProfileQuery,
    StaticAgentProfileResolver,
)
from app.biz.task_runtime.sub_agent.profile_loader import AgentProfileConfigLoader
from app.biz.task_runtime.execution.router import DispatchRouter
from app.biz.task_runtime.capabilities.executor import CapabilityExecutor
from app.biz.task_runtime.sub_agent.executor import (
    AgentExecutorOptions,
    SubAgentExecutor,
)
from app.biz.task_runtime.sub_agent.executor import DEFAULT_STALL_LIMIT
from app.biz.task_runtime.sub_agent.invoker import AgentInvocationContext
from app.biz.task_runtime.sub_agent.loop import (
    AgentAction,
    AgentModelState,
    AgentModelTurn,
    AgentToolDescriptor,
    CapabilityCall,
    FinalAnswer,
    InvalidAction,
    NativeAgentLoopEngine,
    Observation,
)
from app.biz.task_runtime.domain.models import (
    CapabilityDispatch,
    ErrorClass,
    FencingToken,
    SubAgentDispatch,
    TaskDetail,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.storage.run_store import IdempotencyCollisionError
from app.biz.task_runtime.workspace.layout import reset_workspace_layout, set_workspace_layout


class _FakeWorkspaceLayout:
    def __init__(self, root) -> None:
        self._root = root

    def workspace_path(self, agent_instance_id: int, username: str, *, conversation_id: int = 0):
        return self._root


@pytest.fixture(autouse=True)
def _workspace_layout(tmp_path, request: pytest.FixtureRequest) -> None:
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "workspace"))
    request.addfinalizer(lambda: reset_workspace_layout(token))


class _FakeStore:
    """Minimal in-memory RunStore subset the executors actually touch."""

    def __init__(self) -> None:
        self.results: dict[str, TaskResult] = {}
        self.progress: list[tuple[str, str]] = []
        self.runs: dict[str, TaskRun] = {}
        self.cancelled: list[tuple[str, str]] = []

    async def create_run(self, run: TaskRun) -> None:
        if run.run_id in self.runs:
            raise IdempotencyCollisionError(f"run {run.run_id} already exists")
        self.runs[run.run_id] = run

    async def get_task_detail(self, run_id: str, view: str) -> TaskDetail:
        if run_id not in self.runs:
            # Both real stores signal a missing run this way.
            raise FileNotFoundError(f"run not found: {run_id}")
        return TaskDetail(run=self.runs[run_id], result=self.results.get(run_id), view="summary")

    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken:
        return FencingToken(run_id=run_id, token=f"{worker_id}-tok", issued_at=0)

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        self.results[run_id] = result

    async def cancel_run(self, run_id: str, reason: str) -> None:
        self.cancelled.append((run_id, reason))

    async def set_progress(self, run_id: str, message: str, *, ts: int | None = None) -> None:
        self.progress.append((run_id, message))


def _sub_agent_run(*, capabilities: tuple[str, ...], max_model_turns: int | None = None) -> TaskRun:
    return _run(
        TaskSpec(
            task_id="t-sub",
            title="Sub-agent task",
            dispatch=SubAgentDispatch(capability_grants=list(capabilities), max_model_turns=max_model_turns),
        )
    )


def _capability_run(capability_id: str = "skill:android-test.run") -> TaskRun:
    return _run(
        TaskSpec(
            task_id="t-capability",
            title="Capability task",
            dispatch=CapabilityDispatch(capability_id=capability_id),
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

    def __init__(self, *actions: AgentAction) -> None:
        self._actions = list(actions)
        self.seen_steps: list[int] = []

    async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
        self.seen_steps.append(state.step)
        if not self._actions:
            return AgentModelTurn(FinalAnswer(summary="fallback final"))
        action = self._actions.pop(0)
        if isinstance(action, CapabilityCall):
            action = replace(action, capability=normalize_capability_id(action.capability))
        return AgentModelTurn(action)


class _RecordingInvoker:
    def __init__(self, *, unknown: tuple[str, ...] = ()) -> None:
        self.calls: list[CapabilityCall] = []
        self._unknown = frozenset(unknown)

    async def available_descriptors(self, run: TaskRun, capability_ids: tuple[str, ...]) -> tuple[CapabilityDescriptor, ...]:
        return tuple(
            CapabilityDescriptor(
                capability_id=capability_id,
                description=f"Use {capability_id}",
                parameter_schema={"type": "object"},
                required_sandbox=(),
                workspace_access="none",
                effect="mutate",
            )
            for capability_id in capability_ids
            if capability_id not in self._unknown
        )

    async def invoke(self, run: TaskRun, call: CapabilityCall, context) -> Observation:
        descriptor = CapabilityDescriptor(
            capability_id=call.capability,
            parameter_schema={},
            required_sandbox=(),
            workspace_access="none",
            effect="mutate",
        )
        for policy in context.policies:
            decision = await policy.evaluate(
                InvocationPolicyContext(
                    run=run,
                    profile_id=context.profile_id,
                    step=context.step,
                    descriptor=descriptor,
                    history=context.history,
                ),
                call,
            )
            if not decision.allowed:
                reason = decision.reason or "denied"
                return Observation(
                    capability=call.capability,
                    ok=False,
                    content=reason,
                    error_class=ErrorClass.POLICY_DENY.value,
                )
        self.calls.append(call)
        return Observation(capability=call.capability, ok=True, content=f"ran {call.capability}")


# The default profile does not narrow requested grants; caller-scoped live
# resolution still determines whether each requested capability is available.
_DEFAULT_PROFILE = AgentProfile(profile_id="default", system_prompt="", capability_ceiling=ALL_CAPABILITIES)


def _profile_resolver(profile: AgentProfile, *, when_to_use: str = "Test profile") -> StaticAgentProfileResolver:
    descriptor = ProfileDescriptor(
        profile_id=profile.profile_id,
        when_to_use=when_to_use,
        capability_ceiling=profile.capability_ceiling,
    )
    return StaticAgentProfileResolver(
        {profile.profile_id: profile},
        descriptors={profile.profile_id: descriptor},
    )


_DEFAULT_PROFILE_RESOLVER = _profile_resolver(_DEFAULT_PROFILE)


def test_profile_resolver_exposes_planning_metadata_and_filters_by_caller() -> None:
    profile = AgentProfile(profile_id="research", system_prompt="Research carefully.", capability_ceiling=frozenset())
    descriptor = ProfileDescriptor(
        profile_id="research",
        when_to_use="Tasks requiring source comparison.",
        capability_ceiling=frozenset(),
    )

    class _AliceOnly:
        def is_visible(self, descriptor, caller):
            return caller.username == "alice@example.com"

    resolver = StaticAgentProfileResolver(
        {"research": profile},
        descriptors={"research": descriptor},
        visibility_policy=_AliceOnly(),
    )

    assert resolver.list_profiles(ProfileQuery(caller=ResolveContext(username="alice@example.com"))) == (descriptor,)
    assert resolver.list_profiles(ProfileQuery(caller=ResolveContext(username="bob@example.com"))) == ()


def test_profile_resolver_rejects_inconsistent_registration() -> None:
    profile = AgentProfile(profile_id="research", system_prompt="", capability_ceiling=frozenset())
    descriptor = ProfileDescriptor(profile_id="research", when_to_use="Research", capability_ceiling=frozenset())

    with pytest.raises(ValueError, match="registration key"):
        StaticAgentProfileResolver({"alias": profile}, descriptors={"alias": descriptor})


def test_agent_profile_rejects_callable_policy_parameters() -> None:
    @dataclass(frozen=True)
    class _ConfiguredPolicy:
        predicate: object

        async def evaluate(self, context, call):
            return InvocationPolicyDecision(allowed=True)

    with pytest.raises(ValueError, match="JSON-compatible"):
        AgentProfile(
            profile_id="invalid",
            system_prompt="",
            capability_ceiling=frozenset(),
            invocation_policies=(_ConfiguredPolicy(lambda: True),),
        )


def _make_sub_agent_executor(llm, invoker, *, stall_limit=DEFAULT_STALL_LIMIT, profile_resolver=None):
    return SubAgentExecutor(
        NativeAgentLoopEngine(llm),
        invoker,
        profile_resolver=profile_resolver or _DEFAULT_PROFILE_RESOLVER,
        options=AgentExecutorOptions(stall_limit=stall_limit),
    )


@pytest.mark.asyncio
async def test_sub_agent_uses_system_prompt_loaded_from_markdown(tmp_path: Path) -> None:
    profile_dir = tmp_path / "profiles"
    profile_dir.mkdir()
    (profile_dir / "default.md").write_text(
        """---
schema_version: 1
profile_id: default
when_to_use: Test the configured system prompt.
capability_ceiling: "*"
invocation_policies: []
completion_policy:
  type: accept_model
---
Follow primary sources.
""",
        encoding="utf-8",
    )
    seen_prompts: list[str] = []

    class _CapturingLLM:
        async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
            seen_prompts.append(state.system_prompt)
            return AgentModelTurn(FinalAnswer(summary="done"))

    profile_resolver = AgentProfileConfigLoader(profile_dir).load().build_resolver()
    executor = _make_sub_agent_executor(
        _CapturingLLM(),
        _RecordingInvoker(),
        profile_resolver=profile_resolver,
    )

    result = await executor.run(_sub_agent_run(capabilities=()), _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert seen_prompts == ["Follow primary sources."]


@pytest.mark.asyncio
async def test_sub_agent_executes_capability_then_finishes() -> None:
    store = _FakeStore()
    llm = _ScriptedLLM(
        CapabilityCall(capability="run_testcase.execute", args={"id": "TC-001"}),
        FinalAnswer(summary="verdict: pass", output="TC-001 passed"),
    )
    invoker = _RecordingInvoker()
    executor = _make_sub_agent_executor(llm, invoker)

    result = await executor.run(
        _sub_agent_run(capabilities=("run_testcase.execute", "testcase_rewrite.rewrite"), max_model_turns=8),
        store,
    )

    assert result.status == TaskStatus.COMPLETED
    assert result.summary == "verdict: pass"
    assert [call.capability for call in invoker.calls] == ["skill:run_testcase.execute"]
    assert any("run_testcase.execute" in message for _, message in store.progress)


@pytest.mark.asyncio
async def test_sub_agent_effective_grants_preserve_order_and_filter_unavailable_capabilities() -> None:
    seen_capabilities: list[tuple[str, ...]] = []
    seen_descriptors: list[tuple[AgentToolDescriptor, ...]] = []

    class _CapturingLLM:
        async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
            seen_capabilities.append(state.capabilities)
            seen_descriptors.append(state.tools)
            return AgentModelTurn(FinalAnswer(summary="done"))

    profile = AgentProfile(
        profile_id="default",
        system_prompt="",
        capability_ceiling=frozenset({"builtin:echo", "skill:run_testcase.execute", "skill:missing.run"}),
    )
    executor = _make_sub_agent_executor(
        _CapturingLLM(),
        _RecordingInvoker(unknown=("skill:missing.run",)),
        profile_resolver=_profile_resolver(profile),
    )

    result = await executor.run(
        _sub_agent_run(capabilities=("run_testcase.execute", "echo", "run_testcase.execute", "missing.run", "outside.run")),
        _FakeStore(),
    )

    assert result.status == TaskStatus.COMPLETED
    assert seen_capabilities == [("skill:run_testcase.execute", "builtin:echo")]
    assert seen_descriptors[0][0].description == "Use skill:run_testcase.execute"
    assert seen_descriptors[0][0].parameter_schema == {"type": "object"}


@pytest.mark.asyncio
async def test_sub_agent_empty_profile_ceiling_denies_all_requested_capabilities() -> None:
    seen_capabilities: list[tuple[str, ...]] = []

    class _CapturingLLM:
        async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
            seen_capabilities.append(state.capabilities)
            return AgentModelTurn(FinalAnswer(summary="done"))

    profile = AgentProfile(profile_id="default", system_prompt="", capability_ceiling=frozenset())
    executor = _make_sub_agent_executor(
        _CapturingLLM(),
        _RecordingInvoker(),
        profile_resolver=_profile_resolver(profile),
    )

    result = await executor.run(_sub_agent_run(capabilities=("echo",)), _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert seen_capabilities == [()]


@pytest.mark.asyncio
async def test_sub_agent_rejects_capability_outside_allow_list() -> None:
    store = _FakeStore()
    llm = _ScriptedLLM(CapabilityCall(capability="rm_rf.everything"))
    executor = _make_sub_agent_executor(llm, _RecordingInvoker())

    result = await executor.run(_sub_agent_run(capabilities=("echo",)), store)

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.POLICY_DENY


@pytest.mark.asyncio
async def test_sub_agent_truncates_at_step_budget() -> None:
    store = _FakeStore()
    # LLM never returns a FinalAnswer; always asks for another capability call.
    llm = _ScriptedLLM(*[CapabilityCall(capability="echo") for _ in range(10)])
    executor = _make_sub_agent_executor(llm, _RecordingInvoker())

    result = await executor.run(_sub_agent_run(capabilities=("echo",), max_model_turns=3), store)

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.TRANSIENT
    assert llm.seen_steps == [1, 2, 3]


@pytest.mark.asyncio
async def test_sub_agent_feeds_an_undecodable_reply_back_as_a_failed_observation() -> None:
    store = _FakeStore()
    seen_history: list[list[Observation]] = []

    class _ObservingLLM:
        def __init__(self) -> None:
            self._actions: list[AgentAction] = [
                InvalidAction(reason="arguments_json is not valid JSON", capability="echo"),
                FinalAnswer(summary="recovered"),
            ]

        async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
            seen_history.append(list(state.history))
            return AgentModelTurn(self._actions.pop(0))

    invoker = _RecordingInvoker()
    result = await _make_sub_agent_executor(_ObservingLLM(), invoker).run(_sub_agent_run(capabilities=("echo",)), store)

    assert result.status == TaskStatus.COMPLETED
    assert not invoker.calls  # an undecodable reply never reaches a capability
    assert seen_history[1] and seen_history[1][0].ok is False
    assert "arguments_json is not valid JSON" in seen_history[1][0].content


@pytest.mark.asyncio
async def test_sub_agent_stops_when_the_same_failing_call_repeats() -> None:
    store = _FakeStore()
    llm = _ScriptedLLM(*[CapabilityCall(capability="echo", args={"n": 1}) for _ in range(10)])

    class _AlwaysFailingInvoker:
        def __init__(self) -> None:
            self.calls: list[CapabilityCall] = []

        async def available_descriptors(self, run: TaskRun, capability_ids: tuple[str, ...]) -> tuple[CapabilityDescriptor, ...]:
            return await _RecordingInvoker().available_descriptors(run, capability_ids)

        async def invoke(self, run: TaskRun, call: CapabilityCall, context) -> Observation:
            self.calls.append(call)
            return Observation(capability=call.capability, ok=False, content="nope")

    invoker = _AlwaysFailingInvoker()
    executor = _make_sub_agent_executor(llm, invoker, stall_limit=3)
    result = await executor.run(
        _sub_agent_run(capabilities=("echo",), max_model_turns=9),
        store,
    )

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.TRANSIENT
    assert "without progress" in result.summary
    assert len(invoker.calls) == 3  # stopped well before the step budget


@pytest.mark.asyncio
async def test_sub_agent_stall_counter_resets_after_a_successful_call() -> None:
    store = _FakeStore()
    llm = _ScriptedLLM(
        CapabilityCall(capability="echo", args={"n": 1}),
        CapabilityCall(capability="echo", args={"n": 1}),
        CapabilityCall(capability="echo", args={"n": 2}),
        CapabilityCall(capability="echo", args={"n": 1}),
        CapabilityCall(capability="echo", args={"n": 1}),
        FinalAnswer(summary="done"),
    )

    class _FailsRepeats:
        async def available_descriptors(self, run: TaskRun, capability_ids: tuple[str, ...]) -> tuple[CapabilityDescriptor, ...]:
            return await _RecordingInvoker().available_descriptors(run, capability_ids)

        async def invoke(self, run: TaskRun, call: CapabilityCall, context) -> Observation:
            ok = call.args.get("n") == 2
            return Observation(capability=call.capability, ok=ok, content="x")

    executor = _make_sub_agent_executor(llm, _FailsRepeats(), stall_limit=3)
    result = await executor.run(
        _sub_agent_run(capabilities=("echo",), max_model_turns=9),
        store,
    )

    assert result.status == TaskStatus.COMPLETED


@pytest.mark.asyncio
async def test_sub_agent_invocation_policy_denial_is_returned_as_observation() -> None:
    seen_history: list[list[Observation]] = []

    @dataclass(frozen=True)
    class _DenyMutations:
        async def evaluate(self, context, call):
            assert context.descriptor.effect == "mutate"
            assert context.step == 1
            assert call.capability == "builtin:echo"
            return InvocationPolicyDecision(allowed=False, reason="observe before mutation")

    class _ObservingLLM:
        async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
            seen_history.append(list(state.history))
            if not state.history:
                return AgentModelTurn(CapabilityCall(capability="builtin:echo"))
            return AgentModelTurn(FinalAnswer(summary="stopped"))

    profile = AgentProfile(
        profile_id="default",
        system_prompt="",
        capability_ceiling=ALL_CAPABILITIES,
        invocation_policies=(_DenyMutations(),),
    )
    invoker = _RecordingInvoker()
    executor = _make_sub_agent_executor(
        _ObservingLLM(),
        invoker,
        profile_resolver=_profile_resolver(profile),
    )

    result = await executor.run(_sub_agent_run(capabilities=("echo",)), _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert not invoker.calls
    assert seen_history[1][0].error_class == ErrorClass.POLICY_DENY.value
    assert seen_history[1][0].content == "observe before mutation"


@pytest.mark.asyncio
async def test_sub_agent_completion_policy_can_request_another_turn() -> None:
    @dataclass(frozen=True)
    class _RequireOneRetry:
        async def evaluate(self, context, proposal):
            if not context.history:
                return CompletionPolicyDecision(outcome="continue", reason="provide evidence")
            return CompletionPolicyDecision(outcome="accept")

    profile = AgentProfile(
        profile_id="default",
        system_prompt="",
        capability_ceiling=frozenset(),
        completion_policy=_RequireOneRetry(),
    )
    llm = _ScriptedLLM(FinalAnswer(summary="first"), FinalAnswer(summary="verified"))
    executor = _make_sub_agent_executor(
        llm,
        _RecordingInvoker(),
        profile_resolver=_profile_resolver(profile),
    )

    result = await executor.run(_sub_agent_run(capabilities=()), _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert result.summary == "verified"
    assert llm.seen_steps == [1, 2]


@pytest.mark.asyncio
async def test_sub_agent_completion_policy_can_reject_terminally() -> None:
    @dataclass(frozen=True)
    class _RejectCompletion:
        async def evaluate(self, context, proposal):
            return CompletionPolicyDecision(outcome="reject", reason="required evidence is missing")

    profile = AgentProfile(
        profile_id="default",
        system_prompt="",
        capability_ceiling=frozenset(),
        completion_policy=_RejectCompletion(),
    )
    executor = _make_sub_agent_executor(
        _ScriptedLLM(FinalAnswer(summary="done")),
        _RecordingInvoker(),
        profile_resolver=_profile_resolver(profile),
    )

    result = await executor.run(_sub_agent_run(capabilities=()), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.POLICY_DENY
    assert result.error_message == "required evidence is missing"


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
        capability=_MarkerExecutor("capability"),
        sub_agent=_MarkerExecutor("sub_agent"),
    )

    result = await router.run(_sub_agent_run(capabilities=("echo",)), _FakeStore())

    assert result.summary == "sub_agent"


@pytest.mark.asyncio
async def test_router_sends_every_capability_to_one_executor() -> None:
    # Builtin and skill capabilities share a dispatch, so where a capability came
    # from is not a routing dimension: both land on the same executor.
    router = DispatchRouter(capability=_MarkerExecutor("capability"), sub_agent=_MarkerExecutor("sub_agent"))

    for capability_id in ("builtin:echo", "skill:android-test.run"):
        result = await router.run(_capability_run(capability_id), _FakeStore())
        assert result.summary == "capability"


@pytest.mark.asyncio
async def test_router_ignores_execution_policy_executor() -> None:
    # The execution backend (local/docker/k8s) is resolved inside the handler via
    # command_backend.select_backend, not by routing here. The execution policy's
    # executor marker must therefore not influence routing.
    router = DispatchRouter(capability=_MarkerExecutor("capability"), sub_agent=_MarkerExecutor("sub_agent"))
    run = _capability_run("builtin:echo")
    run.execution_policy = TaskExecutionPolicy(executor="command_backend")

    result = await router.run(run, _FakeStore())

    assert result.summary == "capability"


@pytest.mark.asyncio
async def test_router_rejects_sub_agent_when_unconfigured() -> None:
    router = DispatchRouter(capability=_MarkerExecutor("capability"))

    result = await router.run(_sub_agent_run(capabilities=("echo",)), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.USER_INPUT


class _CapturingExecutor:
    """Records the run it received and returns a canned result."""

    def __init__(self, marker: str, *, ok: bool = True) -> None:
        self.marker = marker
        self.ok = ok
        self.seen: list[TaskRun] = []

    async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
        self.seen.append(run)
        now = int(time.time() * 1000)
        result = TaskResult(
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
        # Executors persist their own terminal result; the invoker relies on that
        # to serve a replayed call from the store instead of re-running it.
        token = await store.claim_run(run.run_id, "capturing")
        await store.write_result(run.run_id, result, token)
        return result


class _StubResolver:
    """Serves a descriptor for every capability id, with optional per-id schemas.

    Ids listed in ``unknown`` resolve to ``None``, standing in for a capability
    the runtime cannot serve.
    """

    def __init__(self, schemas: dict[str, dict] | None = None, *, unknown: tuple[str, ...] = ()) -> None:
        self._schemas = schemas or {}
        self._unknown = frozenset(unknown)

    async def resolve(self, capability_id: str, context) -> CapabilityBinding | None:
        if capability_id in self._unknown:
            return None
        return CapabilityBinding(
            descriptor=CapabilityDescriptor(
                capability_id=capability_id,
                parameter_schema=self._schemas.get(capability_id, {}),
                required_sandbox=(),
                workspace_access="none",
                effect="mutate",
            ),
            handler=None,  # type: ignore[arg-type]
        )


def _invoker(executor, store: _FakeStore, **kwargs):
    from app.biz.task_runtime.sub_agent.invoker import RunCapabilityInvoker

    class _ResolvedExecutorAdapter:
        async def run_resolved(self, run, store, binding, policy=None):
            return await executor.run(run, store)

    resolver = kwargs.pop("resolver", None) or _StubResolver()
    resolved_executor = executor if hasattr(executor, "run_resolved") else _ResolvedExecutorAdapter()
    return RunCapabilityInvoker(resolved_executor, resolver, store, **kwargs)


@pytest.mark.asyncio
async def test_invoker_live_availability_is_scoped_to_the_run_caller() -> None:
    class _CallerScopedResolver(_StubResolver):
        async def resolve(self, capability_id: str, context) -> CapabilityBinding | None:
            if context.username != "alice@example.com":
                return None
            return await super().resolve(capability_id, context)

    invoker = _invoker(_CapturingExecutor("capability"), _FakeStore(), resolver=_CallerScopedResolver())
    allowed_run = _sub_agent_run(capabilities=("echo",))
    denied_run = allowed_run.model_copy(update={"username": "mallory@example.com"})

    allowed = await invoker.available_descriptors(allowed_run, ("builtin:echo",))
    denied = await invoker.available_descriptors(denied_run, ("builtin:echo",))

    assert [descriptor.capability_id for descriptor in allowed] == ["builtin:echo"]
    assert denied == ()


async def _unreachable_create(run: TaskRun) -> None:
    raise AssertionError(f"create_run called for an existing row: {run.run_id}")


@pytest.mark.asyncio
async def test_invoker_executes_the_same_resolved_binding_used_by_policy() -> None:
    handler_calls = 0

    class _Handler:
        async def execute(self, context):
            nonlocal handler_calls
            handler_calls += 1
            return TaskResult(
                run_id=context.run.run_id,
                task_id=context.run.spec.task_id,
                status=TaskStatus.COMPLETED,
                title=context.run.spec.title,
                summary="executed",
            )

    descriptor = CapabilityDescriptor(
        capability_id="builtin:echo",
        parameter_schema={},
        required_sandbox=(),
        workspace_access="none",
        effect="mutate",
    )
    binding = CapabilityBinding(descriptor=descriptor, handler=_Handler())

    class _CountingResolver:
        def __init__(self) -> None:
            self.resolve_calls = 0

        async def resolve(self, capability_id, context):
            self.resolve_calls += 1
            return binding

    @dataclass(frozen=True)
    class _DenyMutation:
        async def evaluate(self, context, call):
            assert context.descriptor is descriptor
            return InvocationPolicyDecision(allowed=False, reason="mutation denied")

    resolver = _CountingResolver()
    store = _FakeStore()
    parent = _sub_agent_run(capabilities=("echo",))
    observation = await _invoker(CapabilityExecutor(resolver), store, resolver=resolver).invoke(
        parent,
        CapabilityCall(capability="echo", call_id="step-1"),
        AgentInvocationContext(
            profile_id="guarded",
            step=1,
            policies=(_DenyMutation(),),
            history=(),
        ),
    )

    assert resolver.resolve_calls == 1
    assert handler_calls == 0
    assert observation.error_class == ErrorClass.POLICY_DENY.value
    assert store.results[observation.run_id].error_message == "mutation denied"


@pytest.mark.asyncio
async def test_invoker_namespaces_a_bare_builtin_capability() -> None:
    capability_exec = _CapturingExecutor("capability")
    parent = _sub_agent_run(capabilities=("echo",))

    observation = await _invoker(capability_exec, _FakeStore()).invoke(
        parent, CapabilityCall(capability="echo", args={"text": "hi"})
    )

    assert observation.ok is True
    assert observation.capability == "echo"
    child = capability_exec.seen[0]
    assert child.spec.capability_id == "builtin:echo"
    assert child.spec.args == {"text": "hi"}
    assert child.run_id != parent.run_id and child.run_id.startswith(parent.run_id)


@pytest.mark.asyncio
async def test_invoker_namespaces_a_dotted_skill_capability() -> None:
    capability_exec = _CapturingExecutor("capability")
    parent = _sub_agent_run(capabilities=("run_testcase.execute",))

    await _invoker(capability_exec, _FakeStore()).invoke(
        parent, CapabilityCall(capability="run_testcase.execute", args={"id": "TC-1"})
    )

    child = capability_exec.seen[0]
    assert child.spec.capability_id == "skill:run_testcase.execute"
    assert child.spec.skill_name == "run_testcase"


@pytest.mark.asyncio
async def test_invoker_keeps_sensitive_arguments_out_of_the_persisted_spec() -> None:
    # ``spec.args`` is persisted verbatim, so a value the descriptor marked
    # sensitive must reach the handler by another route entirely.
    capability_exec = _CapturingExecutor("capability")
    store = _FakeStore()
    resolver = _StubResolver(
        {
            "builtin:sign_in": {
                "type": "object",
                "properties": {"user": {"type": "string"}, "password": {"type": "string", "sensitive": True}},
            }
        }
    )

    await _invoker(capability_exec, store, resolver=resolver).invoke(
        _sub_agent_run(capabilities=("sign_in",)),
        CapabilityCall(capability="sign_in", args={"user": "alice", "password": "hunter2"}, call_id="step-1"),
    )

    child = capability_exec.seen[0]
    assert child.spec.args == {"user": "alice", "password": "<redacted>"}
    assert "hunter2" not in child.model_dump_json()
    assert child.secret_arguments == {"password": "hunter2"}


@pytest.mark.asyncio
async def test_invoker_maps_failure_to_observation() -> None:
    observation = await _invoker(_CapturingExecutor("capability", ok=False), _FakeStore()).invoke(
        _sub_agent_run(capabilities=("echo",)), CapabilityCall(capability="echo")
    )

    assert observation.ok is False
    assert observation.content == "boom"
    assert observation.status == TaskStatus.FAILED.value


@pytest.mark.asyncio
async def test_invoker_reports_crash_as_failed_observation() -> None:
    class _Boom:
        async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
            raise RuntimeError("kaboom")

    observation = await _invoker(_Boom(), _FakeStore()).invoke(
        _sub_agent_run(capabilities=("echo",)), CapabilityCall(capability="echo")
    )

    assert observation.ok is False
    assert "kaboom" in observation.content


@pytest.mark.asyncio
async def test_invoker_persists_the_child_run_before_executing() -> None:
    # The executor starts with ``store.claim_run``; a child that was never
    # created cannot be claimed, so the row must exist first.
    store = _FakeStore()
    capability_exec = _CapturingExecutor("capability")

    await _invoker(capability_exec, store).invoke(
        _sub_agent_run(capabilities=("echo",)), CapabilityCall(capability="echo", call_id="step-1")
    )

    child = capability_exec.seen[0]
    assert child.run_id in store.runs
    assert store.runs[child.run_id].status == TaskStatus.QUEUED
    assert store.runs[child.run_id].idempotency_key == child.run_id


@pytest.mark.asyncio
async def test_invoker_keeps_the_child_out_of_the_parent_batch() -> None:
    # A nested call is not a batch item. If it were listed under the parent's
    # batch it would be counted in the batch result, and the batch sandbox
    # cleanup would release the parent's (inherited) lease a second time.
    store = _FakeStore()
    capability_exec = _CapturingExecutor("capability")
    parent = _sub_agent_run(capabilities=("echo",))

    await _invoker(capability_exec, store).invoke(parent, CapabilityCall(capability="echo", call_id="step-1"))

    child = capability_exec.seen[0]
    assert child.batch_id != parent.batch_id
    assert child.batch_id.startswith(parent.run_id)


def test_invoker_derives_a_stable_child_run_id() -> None:
    from app.biz.task_runtime.sub_agent.invoker import _child_run_id

    parent = _sub_agent_run(capabilities=("echo",))

    first = _child_run_id(parent, CapabilityCall(capability="echo", call_id="step-1"))
    second = _child_run_id(parent, CapabilityCall(capability="echo", call_id="step-1"))

    # Stable, and safe to use as a directory component / pod name.
    assert first == second == f"{parent.run_id}-step-1"


def test_child_run_preserves_selected_sandbox_from_multiple_options() -> None:
    from app.biz.task_runtime.sub_agent.invoker import _child_run

    parent = _sub_agent_run(capabilities=("echo",))
    parent.spec.required_sandbox = ["android", "windows"]
    parent.spec.set_selected_sandbox("windows")

    child = _child_run(parent, CapabilityCall(capability="echo", call_id="step-1"), "builtin:echo", {}, {})

    assert child.spec.sandbox_options == ("android", "windows")
    assert child.spec.selected_sandbox == "windows"


@pytest.mark.asyncio
async def test_invoker_reuses_the_prior_result_on_idempotent_replay() -> None:
    # Replaying the same loop step must land on the same child row and return the
    # recorded result rather than executing the capability a second time.
    store = _FakeStore()
    capability_exec = _CapturingExecutor("capability")
    invoker = _invoker(capability_exec, store)
    parent = _sub_agent_run(capabilities=("echo",))
    call = CapabilityCall(capability="echo", call_id="step-1")

    first = await invoker.invoke(parent, call)
    second = await invoker.invoke(parent, call)

    assert len(capability_exec.seen) == 1
    assert first.content == second.content
    assert second.ok is True


@pytest.mark.asyncio
async def test_invoker_reuses_a_recorded_result_without_a_collision_error() -> None:
    # The stores do not reject a duplicate create: the backend answers a
    # byte-identical re-create with success and the file store overwrites. The
    # prior row therefore has to be *read*, or a replay would silently re-run a
    # side-effecting capability.
    store = _FakeStore()
    capability_exec = _CapturingExecutor("capability")
    invoker = _invoker(capability_exec, store)
    parent = _sub_agent_run(capabilities=("echo",))
    call = CapabilityCall(capability="echo", call_id="step-1")
    await invoker.invoke(parent, call)
    store.create_run = _unreachable_create  # type: ignore[method-assign]

    observation = await invoker.invoke(parent, call)

    assert observation.ok is True
    assert len(capability_exec.seen) == 1


@pytest.mark.asyncio
async def test_invoker_refuses_to_reuse_a_row_recorded_for_a_different_call() -> None:
    # The child id binds the parent run and the loop step, not the call itself.
    # A retried step that now asks for different work must not inherit the old
    # answer, so the mismatch fails closed instead of executing or replaying.
    store = _FakeStore()
    capability_exec = _CapturingExecutor("capability")
    invoker = _invoker(capability_exec, store)
    parent = _sub_agent_run(capabilities=("echo", "run_command"))
    await invoker.invoke(parent, CapabilityCall(capability="echo", call_id="step-1"))

    observation = await invoker.invoke(parent, CapabilityCall(capability="run_command", call_id="step-1"))

    assert observation.ok is False
    assert "different call" in observation.content
    assert len(capability_exec.seen) == 1


@pytest.mark.asyncio
async def test_invoker_does_not_persist_arguments_it_cannot_classify() -> None:
    # Without a descriptor there is no way to tell which arguments are
    # sensitive, and ``spec.args`` is persisted verbatim. Failing the call is
    # the only safe answer - the executor could not have resolved it either.
    store = _FakeStore()
    capability_exec = _CapturingExecutor("capability")
    resolver = _StubResolver(unknown=("builtin:sign_in",))

    observation = await _invoker(capability_exec, store, resolver=resolver).invoke(
        _sub_agent_run(capabilities=("sign_in",)),
        CapabilityCall(capability="sign_in", args={"password": "hunter2"}, call_id="step-1"),
    )

    assert observation.ok is False
    assert "could not be resolved" in observation.content
    assert store.runs == {}
    assert capability_exec.seen == []


@pytest.mark.asyncio
async def test_invoker_refuses_to_reuse_a_row_whose_call_carried_a_secret() -> None:
    # Sensitive values are redacted before they reach the persisted args, so two
    # calls that differ only by secret are indistinguishable in the store.
    # Reusing a result computed from a *different* secret is worse than
    # re-asking, so such a row is never served.
    store = _FakeStore()
    capability_exec = _CapturingExecutor("capability")
    resolver = _StubResolver(
        {"builtin:sign_in": {"type": "object", "properties": {"password": {"type": "string", "sensitive": True}}}}
    )
    invoker = _invoker(capability_exec, store, resolver=resolver)
    parent = _sub_agent_run(capabilities=("sign_in",))
    await invoker.invoke(parent, CapabilityCall(capability="sign_in", args={"password": "first"}, call_id="step-1"))

    observation = await invoker.invoke(
        parent, CapabilityCall(capability="sign_in", args={"password": "second"}, call_id="step-1")
    )

    assert observation.ok is False
    assert "sensitive arguments" in observation.content
    assert len(capability_exec.seen) == 1


@pytest.mark.asyncio
async def test_invoker_cancels_the_child_when_the_parent_loop_is_cancelled() -> None:
    # A cancelled child is claimed but never settled by anything above it: it is
    # not a batch item, so no batch finalizer sweeps it back to a terminal state.
    class _Cancelling:
        async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
            raise asyncio.CancelledError()

    store = _FakeStore()
    parent = _sub_agent_run(capabilities=("echo",))
    call = CapabilityCall(capability="echo", call_id="step-1")

    with pytest.raises(asyncio.CancelledError):
        await _invoker(_Cancelling(), store).invoke(parent, call)

    assert store.cancelled == [(f"{parent.run_id}-step-1", "Parent sub-agent run was cancelled.")]


@pytest.mark.asyncio
async def test_capability_executor_settles_a_run_whose_handler_crashes() -> None:
    # A nested call has no RunCoordinator above it to convert a crash into a
    # terminal row, so the executor that claimed the run must write one itself.
    class _CrashingResolver(_StubResolver):
        async def resolve(self, capability_id: str, context):
            binding = await super().resolve(capability_id, context)
            return replace(binding, handler=_CrashingHandler())

    class _CrashingHandler:
        async def execute(self, context) -> TaskResult:
            raise RuntimeError("kaboom")

    store = _FakeStore()
    run = _capability_run("builtin:echo")

    result = await CapabilityExecutor(_CrashingResolver()).run(run, store)

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.INTERNAL
    assert "kaboom" in result.error_message
    assert store.results[run.run_id].status == TaskStatus.FAILED


def _binding(handler, **descriptor_fields):
    defaults = {
        "capability_id": "skill:android-test.run",
        "parameter_schema": {},
        "required_sandbox": (),
        "workspace_access": "none",
        "effect": "mutate",
    }
    return CapabilityBinding(descriptor=CapabilityDescriptor(**{**defaults, **descriptor_fields}), handler=handler)


class _RecordingHandler:
    def __init__(self, result: TaskResult | None = None) -> None:
        self.calls = 0
        self._result = result

    async def execute(self, context) -> TaskResult:
        self.calls += 1
        if self._result is None:
            raise AssertionError("handler must not run")
        return self._result


class _FixedResolver:
    def __init__(self, binding: CapabilityBinding) -> None:
        self._binding = binding

    async def resolve(self, capability_id: str, context) -> CapabilityBinding:
        return self._binding


@pytest.mark.asyncio
async def test_capability_executor_denies_a_capability_prepared_for_a_weaker_environment() -> None:
    # The descriptor bounds which environments are allowed and is re-read at
    # dispatch time, so a task that selected none of them must fail before the
    # handler is ever reached.
    handler = _RecordingHandler()
    executor = CapabilityExecutor(_FixedResolver(_binding(handler, required_sandbox=("android",))))

    result = await executor.run(_capability_run(), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.USER_INPUT
    assert "needs one of ['android']" in result.error_message
    assert handler.calls == 0


@pytest.mark.asyncio
async def test_capability_executor_admits_a_selection_inside_the_allowed_set() -> None:
    # The executor verifies the submitter's pick, it never re-picks: a selection
    # the descriptor still allows goes straight through. Re-picking here would
    # strand the run on a lease acquired for the original choice.
    run = _capability_run()
    run.spec.required_sandbox = ["android"]
    done = TaskResult(run_id=run.run_id, task_id=run.spec.task_id, status=TaskStatus.COMPLETED, title="x", summary="ok")
    handler = _RecordingHandler(done)
    executor = CapabilityExecutor(_FixedResolver(_binding(handler, required_sandbox=("android",))))

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert handler.calls == 1


@pytest.mark.asyncio
async def test_capability_executor_rejects_a_result_for_another_run() -> None:
    # The result is written verbatim and drives the batch aggregate, so a
    # mismatched identity would attribute someone else's outcome to this run.
    run = _capability_run()
    stray = TaskResult(run_id="run-somewhere-else", task_id="t-other", status=TaskStatus.COMPLETED, title="x", summary="done")
    executor = CapabilityExecutor(_FixedResolver(_binding(_RecordingHandler(stray))))

    result = await executor.run(run, _FakeStore())

    assert result.run_id == run.run_id
    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.INTERNAL


@pytest.mark.asyncio
async def test_capability_executor_rejects_a_non_terminal_result() -> None:
    # A non-terminal status would be written as the run's outcome and leave the
    # row looking unsettled forever.
    run = _capability_run()
    unsettled = TaskResult(run_id=run.run_id, task_id=run.spec.task_id, status=TaskStatus.RUNNING, title="x", summary="working")
    executor = CapabilityExecutor(_FixedResolver(_binding(_RecordingHandler(unsettled))))

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert "non-terminal" in result.error_message


@pytest.mark.asyncio
async def test_capability_executor_scrubs_secret_values_from_the_persisted_result() -> None:
    # A handler that echoes an argument back - a command line, stderr, an
    # exception - must not carry the secret into the stored run.
    run = _capability_run()
    run.bind_secret_arguments({"password": "hunter2"})
    leaky = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title="x",
        summary="login --password hunter2 failed",
        output="hunter2",
        error_message="bad credentials for hunter2",
    )
    store = _FakeStore()

    result = await CapabilityExecutor(_FixedResolver(_binding(_RecordingHandler(leaky)))).run(run, store)

    assert "hunter2" not in result.model_dump_json()
    assert "hunter2" not in store.results[run.run_id].model_dump_json()
    assert "<redacted>" in result.summary


@pytest.mark.asyncio
async def test_capability_executor_redacts_a_whole_field_for_a_short_secret() -> None:
    # A short value is still a credential - a PIN, an OTP - but replacing it in
    # place would rewrite unrelated text (here, every "1"). Redacting the field
    # whole is the fail-closed answer, and it is visible rather than subtle.
    run = _capability_run()
    run.bind_secret_arguments({"pin": "1"})
    reported = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title="x",
        summary="1 of 10 cases passed",
    )

    result = await CapabilityExecutor(_FixedResolver(_binding(_RecordingHandler(reported)))).run(run, _FakeStore())

    assert result.summary == "<redacted>"


@pytest.mark.asyncio
async def test_invoker_settles_a_child_whose_creation_outcome_is_unknown() -> None:
    # create_run is not atomic with our knowledge of it: DBRunStore runs the RPC
    # on a worker thread, so a fault can surface after the server committed. A
    # row left QUEUED belongs to no scheduled batch and nothing would finalize it.
    class _AmbiguousStore(_FakeStore):
        async def create_run(self, run: TaskRun) -> None:
            self.runs[run.run_id] = run  # the server committed ...
            raise ConnectionError("connection reset")  # ... and the client never heard

    store = _AmbiguousStore()
    parent = _sub_agent_run(capabilities=("echo",))

    observation = await _invoker(_CapturingExecutor("capability"), store).invoke(
        parent, CapabilityCall(capability="echo", call_id="step-1")
    )

    assert observation.ok is False
    assert store.cancelled == [(f"{parent.run_id}-step-1", "Nested capability call was never started.")]


@pytest.mark.asyncio
async def test_invoker_settles_a_child_committed_after_the_call_was_cancelled() -> None:
    # DBRunStore commits from a worker thread that a cancelled await cannot
    # stop. Cleaning up before the write settles would look for a row that only
    # appears a moment later - and miss it.
    class _LateCommitStore(_FakeStore):
        async def create_run(self, run: TaskRun) -> None:
            await asyncio.sleep(0.05)
            self.runs[run.run_id] = run

    store = _LateCommitStore()
    parent = _sub_agent_run(capabilities=("echo",))
    invoke = asyncio.create_task(
        _invoker(_CapturingExecutor("capability"), store).invoke(parent, CapabilityCall(capability="echo", call_id="step-1"))
    )
    await asyncio.sleep(0.01)
    invoke.cancel()
    with pytest.raises(asyncio.CancelledError):
        await invoke

    child_id = f"{parent.run_id}-step-1"
    assert child_id in store.runs  # the write landed regardless of the cancel
    assert store.cancelled == [(child_id, "Nested capability call was never started.")]


@pytest.mark.asyncio
async def test_invoker_trusts_a_recorded_result_over_a_lost_response() -> None:
    # A lost response to write_result is indistinguishable from a crash at this
    # level. Reporting failure would have the model redo a side effect that
    # already happened, so the recorded row wins over the exception.
    class _LostResponseExecutor:
        async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
            token = await store.claim_run(run.run_id, "capability")
            await store.write_result(
                run.run_id,
                TaskResult(
                    run_id=run.run_id,
                    task_id=run.spec.task_id,
                    status=TaskStatus.COMPLETED,
                    title=run.spec.title,
                    summary="side effect already applied",
                ),
                token,
            )
            raise ConnectionError("connection reset")

    store = _FakeStore()
    parent = _sub_agent_run(capabilities=("echo",))

    observation = await _invoker(_LostResponseExecutor(), store).invoke(
        parent, CapabilityCall(capability="echo", call_id="step-1")
    )

    assert observation.ok is True
    assert observation.content == "side effect already applied"
    assert store.cancelled == []


@pytest.mark.asyncio
async def test_capability_executor_still_notifies_learning_when_the_write_response_is_lost() -> None:
    # Learning reads the run's trajectory from disk, not from the store, so it
    # belongs to "the work finished". Skipping it because the acknowledgement
    # was lost would drop the run from experience learning without a trace.
    from app.biz.task_runtime.capabilities import executor as module

    class _LostAckStore(_FakeStore):
        async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
            await super().write_result(run_id, result, token)
            raise ConnectionError("connection reset")

    seen: list[str] = []
    run = _capability_run()
    done = TaskResult(run_id=run.run_id, task_id=run.spec.task_id, status=TaskStatus.COMPLETED, title="x", summary="done")
    executor = CapabilityExecutor(_FixedResolver(_binding(_RecordingHandler(done))))

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(module, "on_run_terminal", lambda run, result: seen.append(run.run_id))
        with contextlib.suppress(ConnectionError):
            await executor.run(run, _LostAckStore())

    assert seen == [run.run_id]


@pytest.mark.asyncio
async def test_invoker_settles_a_child_whose_work_was_never_recorded() -> None:
    # The run was claimed but no result reached the store, and a nested child is
    # in no scheduled batch - without this it stays RUNNING until a sweep.
    class _ClaimThenFailExecutor:
        async def run(self, run: TaskRun, store: _FakeStore) -> TaskResult:
            await store.claim_run(run.run_id, "capability")
            raise ConnectionError("connection reset")

    store = _FakeStore()
    parent = _sub_agent_run(capabilities=("echo",))

    observation = await _invoker(_ClaimThenFailExecutor(), store).invoke(
        parent, CapabilityCall(capability="echo", call_id="step-1")
    )

    assert observation.ok is False
    assert [run_id for run_id, _ in store.cancelled] == [f"{parent.run_id}-step-1"]


@pytest.mark.asyncio
async def test_invoker_reports_a_child_that_settled_without_a_result() -> None:
    # A row cancelled mid-creation is terminal but has no outcome. The id is
    # taken, so the step can never succeed - saying "still in flight" would
    # invite the caller to wait for something that will never arrive.
    store = _FakeStore()
    parent = _sub_agent_run(capabilities=("echo",))
    call = CapabilityCall(capability="echo", call_id="step-1")
    from app.biz.task_runtime.sub_agent.invoker import _child_run

    child = _child_run(parent, call, "builtin:echo", {}, {})
    child.status = TaskStatus.CANCELLED
    await store.create_run(child)

    observation = await _invoker(_CapturingExecutor("capability"), store).invoke(parent, call)

    assert observation.ok is False
    assert "without a recorded result" in observation.content
