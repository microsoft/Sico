"""End-to-end smoke test for the refactored task runtime.

Drives the *exact* heterogeneous ``PreparedTaskBatch`` from the design example
through ``TaskManager.submit_prepared`` using only local stand-ins:

* ``echo`` - a real built-in payload served by :class:`BuiltinCapabilityProvider`.
* ``file_convert`` skill - served by a fake skill provider so the flow does not
  shell out to a real skill subprocess.
* sub-agent - a :class:`SubAgentExecutor` driven by a scripted LLM + recording
    capability invoker, wired through a :class:`DispatchRouter`; its ``linux_workstation``
  sandbox lease is served by the :class:`InMemorySandboxLeaseManager`.

This proves the manager composes its collaborators (submitter, scheduler, run
coordinator, sandbox coordinator, progress sink) into a working
pipeline that mixes capability / sub-agent dispatch and a real sandbox
acquire/release round-trip."""

from __future__ import annotations

import time
from dataclasses import replace
from pathlib import Path

import pytest

from app.biz.task_runtime.storage.artifact_store import FileArtifactStore
from app.biz.task_runtime.context import TurnContext
from app.biz.task_runtime.execution.command.local import LocalBackend
from app.biz.task_runtime.execution.router import DispatchRouter
from app.biz.task_runtime.sub_agent.executor import SubAgentExecutor
from app.biz.task_runtime.sub_agent.tool_controller import CAPABILITY_DISCOVER_TOOL_ID
from app.biz.task_runtime.sub_agent.invoker import RunCapabilityInvoker
from app.biz.task_runtime.sub_agent.loop import (
    AgentAction,
    AgentModelState,
    AgentModelTurn,
    CapabilityCall,
    FinalAnswer,
    NativeAgentLoopEngine,
    Observation,
)
from app.biz.task_runtime.sub_agent.profile import ALL_CAPABILITIES, AgentProfile, ProfileDescriptor, StaticAgentProfileResolver
from app.biz.task_runtime.guides import SkillGuideRegistry
from app.biz.task_runtime.domain.models import PreparedTaskBatch, TaskBatchInput
from app.biz.task_runtime.capabilities.builtin import BuiltinCapabilityProvider
from app.biz.task_runtime.capabilities.descriptors import (
    CapabilityBinding,
    CapabilityDescriptor,
    CatalogueQuery,
)
from app.biz.task_runtime.capabilities.resolver import CapabilityResolver
from app.biz.task_runtime.capabilities.executor import CapabilityExecutor
from app.biz.task_runtime.manager import TaskManager
from app.biz.task_runtime.domain.models import (
    CapabilityDispatch,
    SubAgentDispatch,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.sandbox.lease_manager import InMemorySandboxLeaseManager
from app.biz.task_runtime.storage.file_store import FileRunStore
from app.biz.task_runtime.workspace.layout import reset_workspace_layout, set_workspace_layout
from app.schemas.conversation.plan import Plan, PlanStep, PlanStepStatus, ToolCall, ToolCallStatus, ToolExecutionInfo
from app.tools.plan import PlanEditor


class _FakeWorkspaceLayout:
    def __init__(self, root: Path) -> None:
        self._root = root

    def workspace_path(self, agent_instance_id: int, username: str, *, conversation_id: int = 0) -> Path:
        return self._root

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int = 0) -> Path:
        return self._root.parent / "turn" / str(turn_id)


@pytest.fixture(autouse=True)
def _workspace_layout(tmp_path: Path, request: pytest.FixtureRequest) -> None:
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "workspace"))
    request.addfinalizer(lambda: reset_workspace_layout(token))


class _FakePlanEditor(PlanEditor):
    """In-memory plan editor: records streaming UI mutations without a backend."""

    def __init__(self) -> None:
        self.plan: Plan | None = None
        self.next_tool_call_id = 0
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
        if self.plan is None:
            return 0
        self.next_tool_call_id += 1
        tool_call = ToolCall(
            tool_name=name,
            message=initial_message,
            execution_info=execution_info or ToolExecutionInfo(),
            tool_call_id=self.next_tool_call_id,
            sub_call_index=sub_call_index,
            display=dict(display or {}),
            tool_call_status=tool_call_status or ToolCallStatus.RUNNING,
        )
        if parent_tool_call_id is None:
            if not self.plan.steps:
                self.plan.steps.append(PlanStep())
            self.plan.steps[0].tool_calls.append(tool_call)
        else:
            parent = self.plan.get_tool_call(parent_tool_call_id)
            if parent is None:
                return 0
            parent.sub_calls.append(tool_call)
        return tool_call.tool_call_id

    async def update_tool_call_message(self, tool_call_id: int, message: str):
        def updater(tool_call) -> None:
            tool_call.message = message

        return await self.update_tool_call(tool_call_id, updater)

    async def update_tool_call(self, tool_call_id: int, updater):
        tool_call = self.plan.get_tool_call(tool_call_id) if self.plan is not None else None
        if tool_call is None:
            return None
        updater(tool_call)
        return tool_call

    async def update_tool_call_tree(self, tool_call_id: int, updater) -> bool:
        tool_call = self.plan.get_tool_call(tool_call_id) if self.plan is not None else None
        if tool_call is None:
            return False
        updater(self.plan, tool_call, int(time.time() * 1000))
        return True

    async def is_plan_cancelled(self) -> bool:
        return self.cancelled


class _ScriptedSubAgentLLM:
    """Emits a fixed action sequence, one per ``next_action`` invocation."""

    def __init__(self, *actions: AgentAction) -> None:
        self._actions = list(actions)
        self.seen_steps: list[int] = []

    async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
        self.seen_steps.append(state.step)
        if not self._actions:
            return AgentModelTurn(FinalAnswer(summary="done"))
        action = self._actions.pop(0)
        if isinstance(action, CapabilityCall) and ":" not in action.capability:
            action = replace(action, capability=f"skill:{action.capability}")
        return AgentModelTurn(action)


class _RecordingInvoker:
    """Captures capability calls and returns a successful observation each time."""

    def __init__(self) -> None:
        self.calls: list[CapabilityCall] = []
        self.catalogue_queries: list[CatalogueQuery] = []

    async def list_descriptors(self, run: TaskRun, query: CatalogueQuery):
        self.catalogue_queries.append(query)
        return tuple(
            CapabilityDescriptor(
                capability_id=capability_id,
                parameter_schema={},
                required_sandbox=(),
                workspace_access="none",
                effect="mutate",
            )
            for capability_id in ("skill:testcase_rewrite:rewrite", "skill:run_testcase:execute")
            if query.matches(
                CapabilityDescriptor(
                    capability_id=capability_id,
                    parameter_schema={},
                    required_sandbox=(),
                    workspace_access="none",
                    effect="mutate",
                )
            )
        )

    async def invoke(self, run: TaskRun, call: CapabilityCall, context) -> Observation:
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
        submission_id="submission-1",
    )


class _FakeSkillProvider:
    """Local stand-in for the real skill provider."""

    provider_id = "skill"

    async def list_descriptors(self, query):
        return ()

    async def resolve(self, capability_id: str, context) -> CapabilityBinding | None:
        return CapabilityBinding(
            descriptor=CapabilityDescriptor(
                capability_id=capability_id,
                parameter_schema={"type": "object", "properties": {}},
                required_sandbox=(),
                # The stand-in writes nothing, so it declares no workspace
                # access and gets a read-only mount.
                workspace_access="none",
                effect="mutate",
            ),
            handler=_FakeSkillHandler(),
        )


class _FakeSkillHandler:
    async def execute(self, context) -> TaskResult:
        run = context.run
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
        CapabilityCall(capability=CAPABILITY_DISCOVER_TOOL_ID, args={"action": "search", "query": "run testcase"}),
        CapabilityCall(
            capability="skill:run_testcase:execute",
            args={"testcase_id": "TC-001"},
        ),
        FinalAnswer(summary="TC-001 rewritten and executed", output="verdict: pass"),
    )
    invoker = _RecordingInvoker()
    resolver = CapabilityResolver(
        (
            BuiltinCapabilityProvider(
                artifact_store=FileArtifactStore(tmp_path / "artifacts"),
                command_backend=LocalBackend(),
            ),
            _FakeSkillProvider(),
        )
    )
    research_ceiling = frozenset(("skill:run_testcase.execute",))
    profile_resolver = StaticAgentProfileResolver(
        {
            "research": AgentProfile(
                profile_id="research",
                system_prompt="Research carefully.",
                capability_ceiling=research_ceiling,
            ),
        },
        descriptors={
            "research": ProfileDescriptor(
                profile_id="research",
                when_to_use="Tasks requiring source comparison.",
                capability_ceiling=research_ceiling,
            ),
        },
    )
    router = DispatchRouter(
        capability=CapabilityExecutor(resolver),
        sub_agent=SubAgentExecutor(
            NativeAgentLoopEngine(llm),
            invoker,
            profile_resolver=profile_resolver,
        ),
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
                    dispatch=CapabilityDispatch(capability_id="builtin:echo"),
                    args={"message": "hello"},
                ),
                TaskSpec(
                    task_id="t2",
                    title="Convert PDF to markdown",
                    dispatch=CapabilityDispatch(capability_id="skill:file_convert.to_markdown"),
                    args={"path": "input.pdf"},
                ),
                TaskSpec(
                    task_id="t3",
                    title="Auto-rewrite and execute TC-001",
                    instructions="Rewrite the failing testcase, then execute it and report the verdict.",
                    dispatch=SubAgentDispatch(
                        profile_id="research",
                        capability_grants=["testcase_rewrite.rewrite", "run_testcase.execute"],
                        max_model_turns=8,
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

    context = _turn_context()
    result = await manager.submit_prepared(context, prepared)

    # All three heterogeneous dispatch kinds completed.
    assert result.completed_count == 3
    assert result.failed_count == 0
    assert result.status == TaskStatus.COMPLETED
    step = context.plan_editor.plan.steps[0]
    assert step.status == PlanStepStatus.COMPLETED
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert all(child.tool_call_status == ToolCallStatus.SUCCESSFUL for child in step.tool_calls[0].sub_calls)

    # The sub-agent only invoked an allow-listed capability.
    assert [call.capability for call in invoker.calls] == ["skill:run_testcase:execute"]
    assert len(invoker.catalogue_queries) == 1
    assert invoker.catalogue_queries[0].search == "run testcase"

    # Caller-supplied batch metadata is preserved verbatim; runtime-owned
    # observability is namespaced under the reserved ``_task_runtime`` key so it
    # can never collide with a caller-provided field.
    batch = await manager.store.get_batch(result.batch_id)
    assert batch is not None
    persisted_runs = {run.spec.task_id: run for run in await manager.store.list_batch_runs(result.batch_id)}
    persisted_dispatch = persisted_runs["t3"].spec.dispatch
    assert isinstance(persisted_dispatch, SubAgentDispatch)
    assert persisted_dispatch.profile_id == "research"
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


@pytest.mark.asyncio
async def test_guide_governed_sub_agent_writes_primary_artifact_e2e(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(
        '[{"id":6,"name":"writing-prds","description":"Help users write effective PRDs."}]',
        encoding="utf-8",
    )
    guide_root = tmp_path / "skills" / "6" / "resolved" / "cortex"
    guide_root.mkdir(parents=True)
    (guide_root / "SKILL.md").write_text(
        "# Writing PRDs\nPRD_GUIDE_MARKER\n" + ("Follow this product requirements workflow. " * 20),
        encoding="utf-8",
    )
    guide_registry = SkillGuideRegistry(workspace)
    guide_ref = guide_registry.list_guides()[0].ref
    seen_prompts: list[str] = []

    class _PrdLLM(_ScriptedSubAgentLLM):
        async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
            seen_prompts.append(state.system_prompt)
            return await super().complete_turn(state)

    llm = _PrdLLM(
        CapabilityCall(
            capability=CAPABILITY_DISCOVER_TOOL_ID,
            args={"action": "search", "query": "write artifact"},
        ),
        CapabilityCall(
            capability="builtin:write_artifact",
            args={"filepath": "asset_management_prd.md", "content": "# Asset Management PRD\n"},
            call_id="write-prd",
        ),
        FinalAnswer(summary="Created the asset management PRD."),
    )
    store = FileRunStore(tmp_path / "turn" / "results")
    artifact_store = FileArtifactStore(tmp_path / "artifacts")
    resolver = CapabilityResolver((BuiltinCapabilityProvider(artifact_store=artifact_store, command_backend=LocalBackend()),))
    capability_executor = CapabilityExecutor(resolver)
    profile = AgentProfile(profile_id="default", system_prompt="", capability_ceiling=ALL_CAPABILITIES)
    profile_resolver = StaticAgentProfileResolver(
        {"default": profile},
        descriptors={
            "default": ProfileDescriptor(
                profile_id="default",
                when_to_use="General tasks.",
                capability_ceiling=ALL_CAPABILITIES,
            )
        },
    )
    router = DispatchRouter(
        capability=capability_executor,
        sub_agent=SubAgentExecutor(
            NativeAgentLoopEngine(llm),
            RunCapabilityInvoker(capability_executor, resolver, store),
            profile_resolver=profile_resolver,
            guide_registry=guide_registry,
        ),
    )
    manager = TaskManager(store, router, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(
                TaskSpec(
                    task_id="prd-1",
                    title="Write asset management PRD",
                    instructions="Create and save an asset management PRD.",
                    dispatch=SubAgentDispatch(
                        profile_id="default",
                        capability_grants=["builtin:write_artifact"],
                        instruction_refs=[guide_ref],
                    ),
                ),
            ),
            join_strategy="all_success",
            description="Write a PRD",
        )
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    assert result.status == TaskStatus.COMPLETED
    assert "PRD_GUIDE_MARKER" in seen_prompts[0]
    parent_result = result.results[0]
    assert parent_result.primary_artifact is not None
    assert parent_result.primary_artifact.name == "asset_management_prd.md"
    assert parent_result.artifacts == [parent_result.primary_artifact]
    parent = next(run for run in await store.list_batch_runs(result.batch_id) if run.spec.task_id == "prd-1")
    child_run_id = f"{parent.run_id}-write-prd"
    detail = await store.get_task_detail(child_run_id, "artifacts")
    assert detail.result is not None
    assert detail.result.primary_artifact is not None
    assert detail.result.primary_artifact.name == "asset_management_prd.md"
    assert artifact_store.get(detail.result.primary_artifact.uri).read_text(encoding="utf-8") == "# Asset Management PRD\n"
