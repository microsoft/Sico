from __future__ import annotations

import json
import time

import pytest

from app.biz.task_runtime.capabilities.descriptors import CapabilityDescriptor, CatalogueQuery
from app.biz.task_runtime.capabilities.tool_catalog import RUNTIME_TOOLS
from app.biz.task_runtime.domain.models import SubAgentDispatch, TaskExecutionPolicy, TaskRun, TaskSpec
from app.biz.task_runtime.sub_agent.loop import (
    AgentLoopLimits,
    AgentLoopRequest,
    AgentLoopSnapshot,
    AgentTask,
    CapabilityCall,
    Observation,
)
from app.biz.task_runtime.sub_agent.profile import AgentProfile
from app.biz.task_runtime.sub_agent.tool_controller import (
    CAPABILITY_DISCOVER_TOOL_ID,
    MAX_PROMOTED_SCHEMA_BYTES,
    RuntimeAgentToolController,
)


def _descriptor(capability_id: str, description: str = "run operation", schema_size: int = 0) -> CapabilityDescriptor:
    schema: dict[str, object] = {"type": "object"}
    if schema_size:
        schema["description"] = "x" * schema_size
    return CapabilityDescriptor(
        capability_id=capability_id,
        description=description,
        parameter_schema=schema,
        required_sandbox=(),
        workspace_access="none",
        effect="read",
    )


class _Invoker:
    def __init__(self, descriptors: tuple[CapabilityDescriptor, ...]) -> None:
        self.descriptors = descriptors
        self.calls: list[CapabilityCall] = []

    async def list_descriptors(self, run: TaskRun, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
        return tuple(descriptor for descriptor in self.descriptors if query.matches(descriptor))

    async def invoke(self, run: TaskRun, call: CapabilityCall, context) -> Observation:
        self.calls.append(call)
        return Observation(capability=call.capability, call_id=call.call_id, ok=True)


def _run() -> TaskRun:
    return TaskRun(
        run_id="run-controller",
        batch_id="batch-controller",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=TaskSpec(task_id="task", title="Task", dispatch=SubAgentDispatch()),
        execution_policy=TaskExecutionPolicy(),
        idempotency_key="task",
        executor="in_process",
        queued_at=int(time.time() * 1000),
    )


def _snapshot() -> AgentLoopSnapshot:
    request = AgentLoopRequest(
        engine_run_id="run-controller",
        task=AgentTask(title="Task"),
        system_prompt="",
        tools=(),
        limits=AgentLoopLimits(max_model_turns=4),
    )
    return AgentLoopSnapshot(request=request, turn=1, history=())


async def _discover(controller: RuntimeAgentToolController, **args: object) -> Observation:
    tool = (await controller.snapshot()).tools[0]
    return await tool.invoke(CapabilityCall(capability=CAPABILITY_DISCOVER_TOOL_ID, args=dict(args)), _snapshot())


@pytest.mark.asyncio
async def test_search_ranks_and_promotes_at_most_five_native_tools() -> None:
    descriptors = (
        _descriptor("builtin:generic:0", "shell command utility"),
        _descriptor("builtin:generic:1", "shell command utility"),
        _descriptor("builtin:generic:2", "shell command utility"),
        _descriptor("builtin:generic:3", "shell command utility"),
        _descriptor("builtin:generic:4", "shell command utility"),
        _descriptor("linux_workstation:shell:exec", "Run a shell command in the workstation"),
        _descriptor("builtin:generic:5", "shell command utility"),
    )
    controller = RuntimeAgentToolController(_run(), AgentProfile("default", "", "*"), _Invoker(descriptors))

    observation = await _discover(controller, action="search", query="shell command", limit=5)

    payload = json.loads(observation.content)
    assert payload["matches"][0]["capability_id"] == "linux_workstation:shell:exec"
    assert len(payload["promoted_capability_ids"]) == 5
    toolset = await controller.snapshot()
    assert toolset.revision == 2
    assert len(toolset.tools) == 6
    shell = next(tool for tool in toolset.tools if tool.descriptor.tool_id == "linux_workstation:shell:exec")
    assert shell.descriptor.parameter_schema == {"type": "object"}


@pytest.mark.asyncio
async def test_artifact_search_promotes_real_write_artifact_descriptor_first() -> None:
    descriptors = tuple(
        CapabilityDescriptor(
            capability_id=f"builtin:{tool.name}",
            description=tool.usage,
            parameter_schema=tool.parameter_schema,
            required_sandbox=(),
            workspace_access=tool.workspace_access,
            effect=tool.effect,
        )
        for tool in RUNTIME_TOOLS
    )
    controller = RuntimeAgentToolController(_run(), AgentProfile("default", "", "*"), _Invoker(descriptors))

    observation = await _discover(controller, action="search", query="create HTML artifact", limit=3)

    payload = json.loads(observation.content)
    assert payload["matches"][0]["capability_id"] == "builtin:write_artifact"
    assert payload["promoted_capability_ids"][0] == "builtin:write_artifact"


@pytest.mark.asyncio
async def test_browse_returns_total_and_cursor_without_promotion() -> None:
    descriptors = tuple(_descriptor(f"builtin:operation:{index}") for index in range(5))
    controller = RuntimeAgentToolController(_run(), AgentProfile("default", "", "*"), _Invoker(descriptors))

    first = json.loads((await _discover(controller, action="browse", page_size=2)).content)
    second = json.loads((await _discover(controller, action="browse", page_size=2, cursor=first["next_cursor"])).content)

    assert first["total"] == 5
    assert len(first["capabilities"]) == 2
    assert len(second["capabilities"]) == 2
    assert {item["capability_id"] for item in first["capabilities"]}.isdisjoint(
        item["capability_id"] for item in second["capabilities"]
    )
    toolset = await controller.snapshot()
    assert toolset.revision == 1
    assert [tool.descriptor.tool_id for tool in toolset.tools] == [CAPABILITY_DISCOVER_TOOL_ID]


@pytest.mark.asyncio
async def test_promotions_are_additive_and_share_one_run_wide_schema_budget() -> None:
    first = _descriptor("builtin:first", "first marker", MAX_PROMOTED_SCHEMA_BYTES - 1_000)
    second = _descriptor("builtin:second", "second marker", 2_000)
    controller = RuntimeAgentToolController(_run(), AgentProfile("default", "", "*"), _Invoker((first, second)))

    first_result = json.loads((await _discover(controller, action="search", query="first marker", limit=1)).content)
    second_result = json.loads((await _discover(controller, action="search", query="second marker", limit=1)).content)

    assert first_result["promoted_capability_ids"] == ["builtin:first"]
    assert second_result["promoted_capability_ids"] == []
    assert second_result["skipped_schema_budget"] == ["builtin:second"]
    toolset = await controller.snapshot()
    assert toolset.revision == 2
    assert [tool.descriptor.tool_id for tool in toolset.tools] == [CAPABILITY_DISCOVER_TOOL_ID, "builtin:first"]
