"""Unit tests for the production sub-agent LLM adapter.

The adapter's job is purely translation: build a decision prompt from the loop
state and map the model's structured reply onto the executor's action union. The
LLM itself is stubbed, so these tests stay deterministic and never touch
llmhubs."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest
from pydantic import BaseModel

from app.llmhubs.structured import StructuredResponseDecodeError

from app.biz.task_runtime.sub_agent.loop import (
    AgentContent,
    AgentContextBlock,
    AgentModelState,
    AgentTask,
    AgentToolDescriptor,
    CapabilityCall,
    FinalAnswer,
    InvalidAction,
    Observation,
    TokenUsage,
)
from app.llmhubs.structured import StructuredCompletion
from app.llmhubs.types import Trace, Usage
from app.biz.task_runtime.sub_agent.llm import (
    HubSubAgentLLM,
    _build_prompt,
    _Decision,
    _to_action,
)


def _state(
    *,
    capabilities: tuple[str, ...] = ("echo",),
    title: str = "Rewrite and run TC-001",
    instructions: str = "Rewrite the testcase then execute it.",
    args: dict[str, Any] | None = None,
    history: list[Observation] | None = None,
    step: int = 1,
    max_model_turns: int = 8,
    context: tuple[AgentContextBlock, ...] = (),
) -> AgentModelState:
    return AgentModelState(
        task=AgentTask(title=title, instructions=instructions, arguments=args or {}),
        tools=tuple(AgentToolDescriptor(tool_id=capability) for capability in capabilities),
        turn=step,
        max_model_turns=max_model_turns,
        system_prompt="",
        context=context,
        history=tuple(history or ()),
    )


class _FakeClient:
    """Records the prompt and returns a pre-baked decision payload."""

    def __init__(self, decision: _Decision) -> None:
        self._decision = decision
        self.prompt: str | None = None
        self.kwargs: dict[str, Any] = {}

    async def complete_structured_result(self, response_model: type[BaseModel], *, prompt: str | None = None, **kwargs: Any):
        self.prompt = prompt
        self.kwargs = kwargs
        assert response_model is _Decision
        return StructuredCompletion(
            value=self._decision,
            usage=Usage(prompt_tokens=10, completion_tokens=2, total_tokens=12),
            trace=Trace(model="test-model", latency_ms=7),
        )


# ---------------------------------------------------------------------------
# _to_action
# ---------------------------------------------------------------------------
def test_to_action_maps_final_answer() -> None:
    action = _to_action(_Decision(action="final_answer", summary="done", output="full output"))
    assert action == FinalAnswer(summary="done", output="full output")


def test_to_action_maps_capability_call_and_parses_arguments() -> None:
    decision = _Decision(action="call_capability", capability="echo", arguments_json='{"text": "hi"}')
    action = _to_action(decision)
    assert action == CapabilityCall(capability="echo", args={"text": "hi"})


def test_to_action_reports_invalid_json_arguments() -> None:
    decision = _Decision(action="call_capability", capability="echo", arguments_json="not json")
    action = _to_action(decision)
    assert isinstance(action, InvalidAction)
    assert action.capability == "echo"
    assert "not valid JSON" in action.reason


def test_to_action_reports_non_object_arguments() -> None:
    decision = _Decision(action="call_capability", capability="echo", arguments_json="[1, 2, 3]")
    action = _to_action(decision)
    assert isinstance(action, InvalidAction)
    assert "must be a JSON object" in action.reason


def test_to_action_rejects_an_unrecognised_action() -> None:
    # Executing on a verb the model never used would trigger a side effect
    # nobody asked for; the allow-list bounds *which* capability may run, not
    # *whether* one should have.
    action = _to_action(_Decision(action="", capability="run_command", arguments_json="{}"))

    assert isinstance(action, InvalidAction)
    assert action.capability == "run_command"
    assert "call_capability" in action.reason


# ---------------------------------------------------------------------------
# _build_prompt
# ---------------------------------------------------------------------------
def test_build_prompt_includes_task_capabilities_and_budget() -> None:
    prompt = _build_prompt(_state(capabilities=("echo", "run_testcase.execute")))
    assert "Rewrite and run TC-001" in prompt
    assert "Rewrite the testcase then execute it." in prompt
    assert "- echo" in prompt
    assert "- run_testcase.execute" in prompt
    assert "Step 1 of 8." in prompt
    assert "History: none yet" in prompt


def test_build_prompt_keeps_runtime_discovery_rules_with_activated_guide() -> None:
    state = replace(
        _state(capabilities=("runtime:capability:discover",)),
        system_prompt="ACTIVATED_SLIDE_GUIDE",
    )

    prompt = _build_prompt(state)

    assert "action='search'" in prompt
    assert "automatically promoted" in prompt
    assert "ACTIVATED_SLIDE_GUIDE" in prompt


def test_build_prompt_renders_provider_neutral_descriptor_metadata() -> None:
    state = _state(capabilities=())
    state = replace(
        state,
        tools=(
            AgentToolDescriptor(
                tool_id="gui.android:tap",
                description="Tap screen coordinates.",
                parameter_schema={"type": "object", "properties": {"x": {"type": "integer"}}},
            ),
        ),
    )
    prompt = _build_prompt(state)
    assert "- gui.android:tap: Tap screen coordinates." in prompt
    assert '"x": {"type": "integer"}' in prompt


def test_build_prompt_renders_history_with_verdicts() -> None:
    history = [
        Observation(capability="echo", ok=True, content="hello", arguments={"text": "hello"}),
        Observation(capability="run_command", ok=False, content="boom", status="failed"),
    ]
    prompt = _build_prompt(_state(history=history, step=3))
    assert "[1] echo -> ok: hello" in prompt
    assert 'arguments: {"text": "hello"}' in prompt
    assert "[2] run_command -> FAILED[failed]: boom" in prompt


def test_build_prompt_renders_structured_observation_detail() -> None:
    # Values the next step may need are labelled lines, not prose, so the model
    # can hand them off verbatim.
    history = [
        Observation(
            capability="conv.run",
            ok=False,
            content="see stderr",
            status="failed",
            error_class="skill_runtime",
            error_message="exit code 2",
            artifacts=("output/csv/a.csv",),
        )
    ]
    prompt = _build_prompt(_state(history=history, step=2))
    assert "error_class: skill_runtime" in prompt
    assert "error: exit code 2" in prompt
    assert "artifacts: output/csv/a.csv" in prompt


def test_build_prompt_exposes_promoted_native_capability_schema() -> None:
    state = _state(capabilities=())
    state = AgentModelState(
        task=state.task,
        tools=(
            AgentToolDescriptor(
                tool_id="linux_workstation:shell:exec",
                description="Run a shell command.",
                parameter_schema={"type": "object", "required": ["command"]},
            ),
        ),
        turn=2,
        max_model_turns=state.max_model_turns,
        system_prompt=state.system_prompt,
        toolset_revision=2,
    )

    prompt = _build_prompt(state)

    assert "linux_workstation:shell:exec" in prompt
    assert '"required": ["command"]' in prompt


def test_build_prompt_empty_capabilities_states_final_only() -> None:
    prompt = _build_prompt(_state(capabilities=()))
    assert "Capabilities: none are available" in prompt


def test_build_prompt_includes_task_args_when_present() -> None:
    prompt = _build_prompt(_state(args={"testcase_id": "TC-001"}))
    assert "TC-001" in prompt


# ---------------------------------------------------------------------------
# next_action (integration with an injected client)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_next_action_returns_mapped_capability_call() -> None:
    client = _FakeClient(_Decision(action="call_capability", capability="echo", arguments_json='{"text": "hi"}'))
    llm = HubSubAgentLLM(client=client)
    action = await llm.next_action(_state())
    assert action == CapabilityCall(capability="echo", args={"text": "hi"})
    assert client.prompt is not None and "echo" in client.prompt


@pytest.mark.asyncio
async def test_next_action_leaves_capability_selector_for_loop_policy() -> None:
    selector = "linux_workstation:browser:**"
    client = _FakeClient(_Decision(action="call_capability", capability=selector, arguments_json="{}"))

    action = await HubSubAgentLLM(client=client).next_action(_state())

    assert action == CapabilityCall(capability=selector)


@pytest.mark.asyncio
async def test_next_action_returns_mapped_final_answer() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="all set"))
    llm = HubSubAgentLLM(client=client)
    assert await llm.next_action(_state()) == FinalAnswer(summary="all set", output="")


@pytest.mark.asyncio
async def test_next_action_forwards_temperature_when_set() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="ok"))
    llm = HubSubAgentLLM(client=client, temperature=0.0)
    await llm.next_action(_state())
    assert client.kwargs == {"temperature": 0.0}


@pytest.mark.asyncio
async def test_next_action_omits_temperature_by_default() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="ok"))
    llm = HubSubAgentLLM(client=client)
    await llm.next_action(_state())
    assert client.kwargs == {}


@pytest.mark.asyncio
async def test_complete_turn_preserves_usage_and_trace() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="ok"))
    turn = await HubSubAgentLLM(client=client).complete_turn(_state())

    assert turn.usage == TokenUsage(input_tokens=10, output_tokens=2, total_tokens=12)
    assert turn.model == "test-model"
    assert turn.latency_ms == 7


@pytest.mark.asyncio
async def test_complete_turn_retries_one_failed_structured_decision() -> None:
    class _FlakyClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__(_Decision(action="final_answer", summary="ok"))
            self.calls = 0

        async def complete_structured_result(self, response_model, *, prompt=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                raise ValueError("Extra data")
            return await super().complete_structured_result(response_model, prompt=prompt, **kwargs)

    client = _FlakyClient()

    turn = await HubSubAgentLLM(client=client).complete_turn(_state())

    assert turn.action == FinalAnswer(summary="ok", output="")
    assert client.calls == 2


@pytest.mark.asyncio
async def test_complete_turn_gives_corrective_feedback_after_conflicting_json() -> None:
    class _ConflictingClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__(_Decision(action="call_capability", capability="builtin:read_file"))
            self.prompts: list[str] = []

        async def complete_structured_result(self, response_model, *, prompt=None, **kwargs):
            self.prompts.append(prompt)
            if len(self.prompts) == 1:
                raise StructuredResponseDecodeError(
                    'Extra data; raw_response=\'{"action":"call_capability"}\\n{"action":"final_answer"}\''
                )
            return await super().complete_structured_result(response_model, prompt=prompt, **kwargs)

    client = _ConflictingClient()

    turn = await HubSubAgentLLM(client=client).complete_turn(_state())

    assert turn.action == CapabilityCall(capability="builtin:read_file", args={})
    assert len(client.prompts) == 2
    assert client.prompts[0] not in (None, "")
    assert client.prompts[1].startswith(client.prompts[0])
    assert "Return exactly ONE structured decision" in client.prompts[1]
    assert "do not also return a fallback final_answer" in client.prompts[1]


@pytest.mark.asyncio
async def test_complete_turn_recovers_first_ordered_decision_after_retry_conflicts() -> None:
    first = _Decision(action="call_capability", capability="builtin:read_file")
    second = _Decision(action="final_answer", summary="I still need to read the file.")

    class _PersistentlyConflictingClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__(first)
            self.calls = 0

        async def complete_structured_result(self, response_model, *, prompt=None, **kwargs):
            self.calls += 1
            raise StructuredResponseDecodeError(
                "Extra data",
                candidates=(first, second),
                usage=Usage(prompt_tokens=10, completion_tokens=4, total_tokens=14),
                trace=Trace(model="test-model", latency_ms=7),
            )

    client = _PersistentlyConflictingClient()

    turn = await HubSubAgentLLM(client=client).complete_turn(_state())

    assert turn.action == CapabilityCall(capability="builtin:read_file", args={})
    assert turn.usage == TokenUsage(input_tokens=10, output_tokens=4, total_tokens=14)
    assert turn.model == "test-model"
    assert client.calls == 2


@pytest.mark.asyncio
async def test_complete_turn_forwards_image_context_as_multimodal_content() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="ok"))
    state = _state(
        context=(
            AgentContextBlock(
                source="gui-observation",
                content="Current screen",
                contents=(AgentContent(type="image", uri="https://example.test/screen.png", mime_type="image/png"),),
            ),
        )
    )

    await HubSubAgentLLM(client=client).complete_turn(state)

    blocks = client.kwargs["content_blocks"]
    assert blocks[0]["type"] == "text"
    assert blocks[1] == {"type": "image_url", "image_url": {"url": "https://example.test/screen.png"}}


@pytest.mark.asyncio
async def test_complete_turn_inlines_local_observation_images(tmp_path) -> None:
    image_path = tmp_path / "screen.png"
    image_path.write_bytes(b"image-bytes")
    client = _FakeClient(_Decision(action="final_answer", summary="ok"))
    state = _state(
        history=(
            Observation(
                capability="linux_workstation:browser:screenshot",
                ok=True,
                contents=(
                    AgentContent(
                        type="image",
                        uri="/storage/screen.png",
                        mime_type="image/png",
                        metadata={"local_path": str(image_path)},
                    ),
                ),
            ),
        )
    )

    await HubSubAgentLLM(client=client).complete_turn(state)

    assert client.kwargs["content_blocks"][-1] == {
        "type": "image_url",
        "image_url": {"url": "data:image/png;base64,aW1hZ2UtYnl0ZXM="},
    }
