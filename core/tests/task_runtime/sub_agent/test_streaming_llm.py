from __future__ import annotations

from dataclasses import replace

import pytest

from app.biz.task_runtime.sub_agent.loop import (
    AgentContent,
    AgentMessage,
    AgentModelOutputDelta,
    AgentModelState,
    AgentModelTurn,
    AgentTask,
    AgentToolDescriptor,
    CapabilityCall,
    FinalAnswer,
    Observation,
)
from app.biz.task_runtime.sub_agent.streaming_llm import HubStreamingAgentLLM
from app.llmhubs.types import OutputItem, StreamChunk, Usage


class _StreamClient:
    def __init__(self, *chunks: StreamChunk) -> None:
        self.chunks = chunks
        self.request = None

    async def generate_stream(self, request):
        self.request = request
        for chunk in self.chunks:
            yield chunk


def _state() -> AgentModelState:
    return AgentModelState(
        task=AgentTask(title="Continue the work", instructions="Use context when needed."),
        tools=(
            AgentToolDescriptor(
                tool_id="builtin:plan:read",
                description="Read the plan.",
                parameter_schema={"type": "object", "properties": {}},
            ),
        ),
        turn=1,
        max_model_turns=4,
        system_prompt="You are the main agent.",
        initial_messages=(
            AgentMessage(role="user", contents=(AgentContent(type="text", text="Prepare a plan"),)),
            AgentMessage(role="assistant", contents=(AgentContent(type="text", text="The plan is ready"),)),
        ),
    )


@pytest.mark.asyncio
async def test_stream_turn_emits_text_and_final_usage() -> None:
    client = _StreamClient(
        StreamChunk(delta="hello", outputs=[OutputItem(type="text", text="hello")]),
        StreamChunk(delta=" world", outputs=[OutputItem(type="text", text=" world")]),
        StreamChunk(finish_reason="stop", usage=Usage(prompt_tokens=5, completion_tokens=2, total_tokens=7)),
    )

    items = [item async for item in HubStreamingAgentLLM(model="test-model", client=client).stream_turn(_state())]

    assert [item.content.text for item in items if isinstance(item, AgentModelOutputDelta)] == ["hello", " world"]
    terminal = next(item for item in items if isinstance(item, AgentModelTurn))
    assert terminal.action == FinalAnswer(summary="hello world", output="hello world")
    assert terminal.usage.total_tokens == 7
    assert [item.role for item in client.request.inputs] == ["user", "assistant", "user"]
    assert client.request.options["allow_multiple_tool_calls"] is False


@pytest.mark.asyncio
async def test_stream_turn_forwards_observation_images_as_inline_model_input(tmp_path) -> None:
    image_path = tmp_path / "screenshot.png"
    image_path.write_bytes(b"image-bytes")
    state = replace(
        _state(),
        history=(
            Observation(
                capability="linux_workstation:browser:screenshot",
                ok=True,
                content="Captured screenshot.",
                call_id="call-1",
                arguments={"full_page": True},
                contents=(
                    AgentContent(
                        type="image",
                        uri="/storage/screenshot.png",
                        mime_type="image/png",
                        metadata={"local_path": str(image_path)},
                    ),
                ),
            ),
        ),
    )
    client = _StreamClient(StreamChunk(finish_reason="stop"))

    await anext(HubStreamingAgentLLM(client=client).stream_turn(state))

    image = client.request.inputs[-1].content[-1]
    assert image.type == "image"
    assert image.image_base64 == "aW1hZ2UtYnl0ZXM="
    assert image.media_type == "image/png"


@pytest.mark.asyncio
async def test_stream_turn_preserves_native_tool_call_history() -> None:
    state = replace(
        _state(),
        history=(
            Observation(
                capability="builtin:plan:read",
                ok=True,
                content='{"items": []}',
                call_id="call-1",
                arguments={"scope": "current"},
            ),
        ),
    )
    client = _StreamClient(StreamChunk(finish_reason="stop"))

    await anext(HubStreamingAgentLLM(client=client).stream_turn(state))

    continuation = client.request.inputs[-3:]
    assert [item.role for item in continuation] == ["user", "assistant", "tool"]
    assert "Capability results" not in continuation[0].content[0].text
    assert continuation[1].content[0].type == "function_call"
    assert continuation[1].content[0].arguments == {"scope": "current"}
    assert continuation[2].content[0].type == "function_result"
    assert continuation[2].content[0].result == '{"items": []}'


@pytest.mark.asyncio
async def test_stream_turn_maps_wire_function_name_back_to_capability() -> None:
    client = _StreamClient()
    model = HubStreamingAgentLLM(client=client)
    iterator = model.stream_turn(_state())

    async def chunks(request):
        wire_name = request.tools[0]["function"]["name"]
        yield StreamChunk(
            outputs=[
                OutputItem(
                    type="function_call",
                    name=wire_name,
                    call_id="call-1",
                    arguments='{"scope": "current"}',
                )
            ],
            finish_reason="tool_calls",
        )

    client.generate_stream = chunks
    items = [item async for item in iterator]

    terminal = next(item for item in items if isinstance(item, AgentModelTurn))
    assert terminal.action == CapabilityCall(
        capability="builtin:plan:read",
        args={"scope": "current"},
        call_id="call-1",
    )


@pytest.mark.asyncio
async def test_stream_turn_rejects_parallel_capability_calls() -> None:
    client = _StreamClient()

    async def chunks(request):
        wire_name = request.tools[0]["function"]["name"]
        yield StreamChunk(
            outputs=[
                OutputItem(type="function_call", name=wire_name, call_id="call-1", arguments="{}"),
                OutputItem(type="function_call", name=wire_name, call_id="call-2", arguments="{}"),
            ]
        )

    client.generate_stream = chunks
    items = [item async for item in HubStreamingAgentLLM(client=client).stream_turn(_state())]

    terminal = next(item for item in items if isinstance(item, AgentModelTurn))
    assert "parallel capability calls" in terminal.action.reason


@pytest.mark.asyncio
async def test_stream_turn_forwards_provider_web_search_without_local_capability_call() -> None:
    citation = {
        "type": "url_citation",
        "url": "https://example.test/weather",
        "title": "Weather source",
    }
    client = _StreamClient(
        StreamChunk(
            outputs=[
                OutputItem(
                    type="web_search_call",
                    call_id="search-1",
                    action={"type": "search", "query": "Shanghai weather"},
                )
            ]
        ),
        StreamChunk(delta="Sunny and 26 C."),
        StreamChunk(outputs=[OutputItem(type="text", annotations=[citation])]),
        StreamChunk(finish_reason="stop", usage=Usage(prompt_tokens=8, completion_tokens=4, total_tokens=12)),
    )
    state = replace(_state(), provider_tools=({"type": "web_search"},))

    items = [item async for item in HubStreamingAgentLLM(model="test-model", client=client).stream_turn(state)]

    assert client.request.tools[-1] == {"type": "web_search"}
    terminal = next(item for item in items if isinstance(item, AgentModelTurn))
    assert terminal.action == FinalAnswer(summary="Sunny and 26 C.", output="Sunny and 26 C.")
    assert not any(
        isinstance(item, AgentModelTurn) and isinstance(item.action, CapabilityCall)
        for item in items
    )
    metadata_items = [
        item for item in items if isinstance(item, AgentModelOutputDelta) and item.content.metadata
    ]
    assert metadata_items[-1].content.metadata == {"annotations": [citation]}
