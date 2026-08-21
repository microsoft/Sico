from __future__ import annotations

import pytest

from app.biz.chat.preparation import (
    AgentInvocation,
    DirectCapability,
    LlmTaskPlanner,
    NeedsClarification,
    PlannedDecision,
    PlannedWorkItem,
    PreparationError,
    PlannerCallError,
    PlannerOutput,
    Rejected,
    WorkItem,
    WorkspaceCapabilityCatalogue,
    assemble_batch,
)
from app.biz.chat.preparation.planner import _planned_item_payload
from app.biz.task_runtime.capabilities.loader import CapabilityCard
from app.biz.task_runtime.planning import CatalogueQuery, ResolveContext
from app.biz.task_runtime.capabilities.descriptors import CapabilityDescriptor
from app.biz.task_runtime.domain.models import CapabilityDispatch, SubAgentDispatch
from app.biz.task_runtime.sub_agent.profile import ALL_CAPABILITIES, ProfileDescriptor
from app.tools.common import ToolContext


def _descriptor(capability_id: str = "skill:android-test.run", *, required: tuple[str, ...] = ()) -> CapabilityDescriptor:
    return CapabilityDescriptor(
        capability_id=capability_id,
        parameter_schema={"type": "object", "properties": {"case_id": {"type": "string"}}, "required": ["case_id"]},
        required_sandbox=required,  # type: ignore[arg-type]
        workspace_access="read_write",
        effect="mutate",
    )


def test_assemble_batch_maps_both_decisions_without_source_specific_logic() -> None:
    direct = WorkItem(
        item_id="case-1",
        title="Run case",
        goal="Run the selected case",
        params={"case_id": "TC-1"},
        stage_hint=0,
        metadata={"source": "workbook"},
    )
    agent = WorkItem(item_id="investigate-1", goal="Investigate the failure", params={"run_id": "r-1"})

    prepared = assemble_batch(
        "Run cases, then investigate failures",
        (
            PlannedWorkItem(
                source=direct,
                decision=DirectCapability("skill:android-test.run"),
                required_sandbox=("android",),
                selected_sandbox="android",
                rationale="prebound workbook action",
            ),
            PlannedWorkItem(
                source=agent,
                decision=AgentInvocation("default", ("builtin:echo",), max_model_turns=4),
                stage=1,
            ),
        ),
        join_strategy="all_success",
        max_concurrency=2,
        batch_metadata={"source": "fixture"},
        adapter_state={"hint": "summarize"},
    )

    first, second = prepared.batch.tasks
    assert isinstance(first.dispatch, CapabilityDispatch)
    assert first.dispatch.capability_id == "skill:android-test.run"
    assert first.args == {"case_id": "TC-1"}
    assert first.required_sandbox == ["android"]
    assert first.selected_sandbox == "android"
    assert first.metadata == {
        "source": "workbook",
        "preparation": {"rationale": "prebound workbook action"},
        "_task_runtime": {"selected_sandbox": "android"},
    }
    assert isinstance(second.dispatch, SubAgentDispatch)
    assert second.dispatch.profile_id == "default"
    assert second.dispatch.capability_grants == ["builtin:echo"]
    assert second.dispatch.max_model_turns == 4
    assert second.stage == 1
    assert prepared.batch.description == "Run cases, then investigate failures"
    assert prepared.batch.join_strategy == "all_success"
    assert prepared.batch.max_concurrency == 2
    assert prepared.batch_metadata == {"source": "fixture"}
    assert prepared.adapter_state == {"hint": "summarize"}


def test_planned_work_item_rejects_stage_hint_conflict() -> None:
    source = WorkItem(item_id="case-1", goal="Run case", stage_hint=2)

    with pytest.raises(ValueError, match="conflicts with source stage_hint"):
        PlannedWorkItem(source=source, decision=DirectCapability("echo"), stage=1)


@pytest.mark.asyncio
async def test_planner_validates_prebound_items_without_calling_llm() -> None:
    async def unexpected_call(*args):  # pragma: no cover - assertion is that this never runs
        raise AssertionError("planner LLM must not run for a fully prebound batch")

    planner = LlmTaskPlanner(unexpected_call)
    item = WorkItem(
        item_id="TC-1",
        goal="Run TC-1",
        params={"case_id": "TC-1"},
        prebound_decision=DirectCapability("skill:android-test.run"),
        stage_hint=0,
        sandbox_hint="android",
    )

    result = await planner.plan("Run workbook cases", (item,), (_descriptor(required=("android",)),), ())

    assert isinstance(result, tuple)
    assert result[0].decision == DirectCapability("skill:android-test.run")
    assert result[0].required_sandbox == ("android",)
    assert result[0].selected_sandbox == "android"


@pytest.mark.asyncio
async def test_planner_requests_clarification_for_missing_prebound_argument() -> None:
    planner = LlmTaskPlanner()
    item = WorkItem(
        item_id="TC-1",
        goal="Run TC-1",
        prebound_decision=DirectCapability("skill:android-test.run"),
    )

    result = await planner.plan("Run workbook cases", (item,), (_descriptor(),), ())

    assert isinstance(result, NeedsClarification)
    assert result.code == "preparation_missing_arguments"
    assert result.missing == ("case_id",)


@pytest.mark.asyncio
async def test_planner_rejects_prebound_argument_with_wrong_schema_type() -> None:
    planner = LlmTaskPlanner()
    item = WorkItem(
        item_id="TC-1",
        goal="Run TC-1",
        params={"case_id": 42},
        prebound_decision=DirectCapability("skill:android-test.run"),
    )

    result = await planner.plan("Run workbook cases", (item,), (_descriptor(),), ())

    assert isinstance(result, Rejected)
    assert result.code == "preparation_invalid_arguments"
    assert result.details["validation_errors"][0]["path"] == "case_id"
    assert result.details["validation_errors"][0]["rule"] == "type"


@pytest.mark.asyncio
async def test_planner_persists_normalized_prebound_argument_types() -> None:
    descriptor = CapabilityDescriptor(
        capability_id="skill:jobs.run",
        parameter_schema={
            "type": "object",
            "properties": {"retries": {"type": "integer"}},
            "required": ["retries"],
        },
        required_sandbox=(),
        workspace_access="none",
        effect="mutate",
    )
    item = WorkItem(
        item_id="job-1",
        goal="Run job",
        params={"retries": "3"},
        prebound_decision=DirectCapability("skill:jobs.run"),
    )

    result = await LlmTaskPlanner().plan("Run", (item,), (descriptor,), ())

    assert isinstance(result, tuple)
    assert result[0].source.params == {"retries": 3}


@pytest.mark.asyncio
async def test_planner_rejects_unknown_prebound_capability() -> None:
    planner = LlmTaskPlanner()
    item = WorkItem(item_id="1", goal="Run", prebound_decision=DirectCapability("skill:missing.run"))

    result = await planner.plan("Run", (item,), (_descriptor(),), ())

    assert isinstance(result, Rejected)
    assert result.code == "preparation_unknown_capability"


@pytest.mark.asyncio
async def test_planner_batches_all_unresolved_items_into_one_llm_call() -> None:
    calls = []

    async def plan_once(batch_goal, unresolved, prebound, catalogue, profiles):
        calls.append((batch_goal, tuple(unresolved), tuple(prebound), catalogue, profiles))
        return PlannerOutput(
            items=[
                PlannedDecision(
                    item_id=item.item_id,
                    title=f"Task {item.item_id}",
                    dispatch_type="capability",
                    capability_id="builtin:echo",
                    args_json='{"message": "hello"}',
                )
                for item in unresolved
            ]
        )

    planner = LlmTaskPlanner(plan_once)
    descriptor = CapabilityDescriptor(
        capability_id="builtin:echo",
        parameter_schema={"type": "object", "properties": {"message": {"type": "string"}}},
        required_sandbox=(),
        workspace_access="none",
        effect="read",
    )

    result = await planner.plan(
        "Echo both",
        (WorkItem(item_id="1", goal="Say the first value"), WorkItem(item_id="2", goal="Say the second value")),
        (descriptor,),
        (ProfileDescriptor("default", "General tasks", ALL_CAPABILITIES),),
    )

    assert isinstance(result, tuple)
    assert len(calls) == 1
    assert [item.source.params for item in result] == [{"message": "hello"}, {"message": "hello"}]


def test_prebound_planner_payload_includes_dependency_context() -> None:
    source = WorkItem(
        item_id="producer",
        goal="Write the generated file",
        title="Generate file",
        params={"output_path": "results/generated.json"},
    )
    item = PlannedWorkItem(source, DirectCapability("builtin:echo"), stage=0)

    payload = _planned_item_payload(item)

    assert payload["goal"] == "Write the generated file"
    assert payload["title"] == "Generate file"
    assert payload["params"] == {"output_path": "results/generated.json"}


@pytest.mark.asyncio
async def test_planner_requests_explicit_bindings_above_unresolved_item_limit() -> None:
    planner = LlmTaskPlanner(lambda *args: pytest.fail("scope limit must run before planner"))
    items = tuple(WorkItem(item_id=str(index), goal=f"Task {index}") for index in range(101))

    result = await planner.plan("Run tasks", items, (_descriptor(),), ())

    assert isinstance(result, NeedsClarification)
    assert result.code == "task_planner_scope_limit"
    assert result.details["unresolved_item_count"] == 101


@pytest.mark.asyncio
async def test_planner_requests_explicit_bindings_above_payload_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.biz.chat.preparation.planner._MAX_TASK_PLANNER_PAYLOAD_CHARS", 100)
    planner = LlmTaskPlanner(lambda *args: pytest.fail("scope limit must run before planner"))

    result = await planner.plan("Run task", (WorkItem(item_id="1", goal="A" * 200),), (_descriptor(),), ())

    assert isinstance(result, NeedsClarification)
    assert result.code == "task_planner_scope_limit"
    assert result.details["payload_chars"] > 100


@pytest.mark.asyncio
async def test_planner_assigns_stages_when_source_did_not_hint_them() -> None:
    async def plan_once(*args):
        return PlannerOutput(
            items=[
                PlannedDecision(
                    item_id="1",
                    dispatch_type="capability",
                    capability_id="builtin:echo",
                    args_json='{"message":"first"}',
                    stage=0,
                ),
                PlannedDecision(
                    item_id="2",
                    dispatch_type="capability",
                    capability_id="builtin:echo",
                    args_json='{"message":"second"}',
                    stage=1,
                ),
            ]
        )

    descriptor = CapabilityDescriptor(
        capability_id="builtin:echo",
        parameter_schema={"type": "object", "properties": {"message": {"type": "string"}}},
        required_sandbox=(),
        workspace_access="none",
        effect="read",
    )

    result = await LlmTaskPlanner(plan_once).plan(
        "Run in order",
        (WorkItem(item_id="1", goal="First"), WorkItem(item_id="2", goal="Second")),
        (descriptor,),
        (),
    )

    assert isinstance(result, tuple)
    assert [item.stage for item in result] == [0, 1]


@pytest.mark.asyncio
async def test_planner_does_not_infer_prebinding_from_instruction_text() -> None:
    calls = []

    async def planner_call(batch_goal, unresolved, prebound, catalogue, profiles):
        calls.append(tuple(unresolved))
        return PlannerOutput(
            items=[
                PlannedDecision(
                    item_id="1",
                    dispatch_type="capability",
                    capability_id="builtin:run_command",
                )
            ]
        )

    descriptor = CapabilityDescriptor(
        capability_id="builtin:run_command",
        parameter_schema={"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
        required_sandbox=(),
        workspace_access="read_only",
        effect="mutate",
    )
    item = WorkItem(
        item_id="1",
        goal="Use run_command for this exact command",
        params={"command": "printf hello"},
    )

    result = await LlmTaskPlanner(planner_call).plan("Run command", (item,), (descriptor,), ())

    assert isinstance(result, tuple)
    assert result[0].decision == DirectCapability("builtin:run_command")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_planner_does_not_execute_a_negated_capability_mention() -> None:
    calls = []

    async def planner_call(batch_goal, unresolved, prebound, catalogue, profiles):
        calls.append(tuple(unresolved))
        return PlannerOutput(
            items=[
                PlannedDecision(
                    item_id="1",
                    dispatch_type="sub_agent",
                    profile_id="default",
                )
            ]
        )

    descriptor = CapabilityDescriptor(
        capability_id="builtin:echo",
        parameter_schema={"type": "object", "properties": {}},
        required_sandbox=(),
        workspace_access="none",
        effect="read",
    )
    profile = ProfileDescriptor("default", "General tasks", ALL_CAPABILITIES)

    result = await LlmTaskPlanner(planner_call).plan(
        "Preserve the result",
        (WorkItem(item_id="1", goal="Do not use echo; leave the result unchanged"),),
        (descriptor,),
        (profile,),
    )

    assert isinstance(result, tuple)
    assert result[0].decision == AgentInvocation("default")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_planner_propagates_operational_failure() -> None:
    async def failing_call(*args):
        raise RuntimeError("provider unavailable")

    with pytest.raises(PlannerCallError) as excinfo:
        await LlmTaskPlanner(failing_call).plan(
            "Run",
            (WorkItem(item_id="1", goal="Run"),),
            (_descriptor(),),
            (),
        )

    assert excinfo.value.code == "task_planner_llm_failed"
    assert "provider unavailable" in str(excinfo.value)


@pytest.mark.asyncio
async def test_planner_rejects_llm_argument_outside_schema_enum() -> None:
    async def planner_call(*args):
        return PlannerOutput(
            items=[
                PlannedDecision(
                    item_id="1",
                    dispatch_type="capability",
                    capability_id="builtin:convert",
                    args_json='{"format":"pdf"}',
                )
            ]
        )

    descriptor = CapabilityDescriptor(
        capability_id="builtin:convert",
        parameter_schema={
            "type": "object",
            "properties": {"format": {"type": "string", "enum": ["csv"]}},
            "required": ["format"],
        },
        required_sandbox=(),
        workspace_access="read_only",
        effect="mutate",
    )

    with pytest.raises(PlannerCallError) as excinfo:
        await LlmTaskPlanner(planner_call).plan(
            "Convert output",
            (WorkItem(item_id="1", goal="Convert the output"),),
            (descriptor,),
            (),
        )

    assert excinfo.value.code == "task_planner_invalid_output"
    assert excinfo.value.details["validation_errors"][0]["rule"] == "enum"


@pytest.mark.asyncio
async def test_planner_returns_caller_argument_validation_as_rejection() -> None:
    async def planner_call(*args):
        return PlannerOutput(
            items=[
                PlannedDecision(
                    item_id="1",
                    dispatch_type="capability",
                    capability_id="skill:jobs.run",
                )
            ]
        )

    descriptor = CapabilityDescriptor(
        capability_id="skill:jobs.run",
        parameter_schema={
            "type": "object",
            "properties": {"retries": {"type": "integer"}},
            "required": ["retries"],
        },
        required_sandbox=(),
        workspace_access="none",
        effect="mutate",
    )

    result = await LlmTaskPlanner(planner_call).plan(
        "Run",
        (WorkItem(item_id="1", goal="Run", params={"retries": "not-an-integer"}),),
        (descriptor,),
        (),
    )

    assert isinstance(result, Rejected)
    assert result.code == "preparation_invalid_arguments"
    assert result.details["validation_errors"][0]["path"] == "retries"


@pytest.mark.asyncio
async def test_workspace_catalogue_is_caller_scoped_and_provider_filtered() -> None:
    card = CapabilityCard(name="android.run", skill_name="android", action_name="run")

    class _Loader:
        def list_cards(self, *, visibility):
            assert visibility == "public"
            return [card]

    context = ToolContext.model_construct(
        username="alice",
        agent_instance_id=7,
        project_id=11,
        skill_loader=_Loader(),
    )
    catalogue = WorkspaceCapabilityCatalogue()
    query = CatalogueQuery(
        caller=ResolveContext(username="alice", agent_instance_id=7, project_id=11),
        providers=("skill",),
    )

    descriptors = await catalogue.list_descriptors(context, query)
    denied = await catalogue.list_descriptors(
        context,
        CatalogueQuery(caller=ResolveContext(username="bob", agent_instance_id=7, project_id=11)),
    )

    assert [descriptor.capability_id for descriptor in descriptors] == ["skill:android.run"]
    assert denied == ()


@pytest.mark.asyncio
async def test_workspace_catalogue_reports_skill_loader_failure_operationally() -> None:
    class _FailingLoader:
        def list_cards(self, *, visibility):
            raise RuntimeError("index unavailable")

    context = ToolContext.model_construct(
        username="alice",
        agent_instance_id=7,
        project_id=11,
        skill_loader=_FailingLoader(),
    )

    with pytest.raises(PreparationError) as excinfo:
        await WorkspaceCapabilityCatalogue().list_descriptors(
            context,
            CatalogueQuery(
                caller=ResolveContext(username="alice", agent_instance_id=7, project_id=11),
                providers=("skill",),
            ),
        )

    assert excinfo.value.code == "capability_catalogue_failed"
    assert excinfo.value.details == {"provider": "skill"}
