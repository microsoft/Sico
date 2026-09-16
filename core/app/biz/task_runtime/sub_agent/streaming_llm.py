"""Streaming agent-model adapter backed directly by LLMHub."""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import AsyncIterator
from typing import Protocol

from app.llmhubs.hub import LLMHub
from app.llmhubs.types import Input, InputContent, ModelRegistryEntry, Request, StreamChunk

from .image_content import image_data_url
from .loop import (
    AgentContent,
    AgentMessage,
    AgentModelOutputDelta,
    AgentModelState,
    AgentModelStreamItem,
    AgentModelTurn,
    CapabilityCall,
    FinalAnswer,
    InvalidAction,
    Observation,
    TokenUsage,
)


class StreamingLLM(Protocol):
    def generate_stream(self, request: Request) -> AsyncIterator[StreamChunk]: ...


class HubStreamingAgentLLM:
    """Translate neutral agent state to an LLMHub tool-calling stream."""

    def __init__(
        self,
        *,
        model: str | None = None,
        client: StreamingLLM | None = None,
        resolved_entry: ModelRegistryEntry | None = None,
    ) -> None:
        self._model = model or ""
        self._client = client
        self._resolved_entry = resolved_entry

    async def stream_turn(self, state: AgentModelState) -> AsyncIterator[AgentModelStreamItem]:
        client = self._client or LLMHub()
        request, capability_by_wire_name = _build_request(state, self._model)
        text_parts: list[str] = []
        capability_calls: list[CapabilityCall] = []
        usage = TokenUsage()
        started = time.perf_counter()

        stream = (
            client.generate_stream(request, resolved_entry=self._resolved_entry)
            if self._resolved_entry is not None
            else client.generate_stream(request)
        )
        async for chunk in stream:
            text = chunk.delta or ""
            if text:
                text_parts.append(text)
                yield AgentModelOutputDelta(AgentContent(type="text", text=text))
            for output in chunk.outputs:
                if output.type == "text":
                    if output.text and not text:
                        text_parts.append(output.text)
                        yield AgentModelOutputDelta(
                            AgentContent(
                                type="text",
                                text=output.text,
                                metadata={"annotations": output.annotations or []},
                            )
                        )
                    elif output.annotations:
                        yield AgentModelOutputDelta(
                            AgentContent(type="text", metadata={"annotations": output.annotations})
                        )
                elif output.type == "function_call":
                    capability_calls.append(
                        _capability_call(output.name, output.call_id, output.arguments, capability_by_wire_name)
                    )
                elif output.type == "refusal" and output.text:
                    text_parts.append(output.text)
                    yield AgentModelOutputDelta(AgentContent(type="text", text=output.text, metadata={"refusal": True}))
            if chunk.usage is not None:
                usage = TokenUsage(
                    input_tokens=chunk.usage.prompt_tokens,
                    output_tokens=chunk.usage.completion_tokens,
                    total_tokens=chunk.usage.total_tokens,
                )

        text = "".join(text_parts)
        if len(capability_calls) > 1:
            action = InvalidAction(reason="parallel capability calls are not supported")
        elif capability_calls:
            action = capability_calls[0]
        else:
            action = FinalAnswer(summary=text.strip(), output=text)
        yield AgentModelTurn(
            action=action,
            usage=usage,
            model=self._model,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )


def _build_request(state: AgentModelState, model: str) -> tuple[Request, dict[str, str]]:
    instructions = "\n\n".join(
        part
        for part in (
            state.system_prompt.strip(),
            "Call at most one capability per model turn. Reply directly when no capability is needed.",
        )
        if part
    )
    wire_name_by_capability = {tool.tool_id: _wire_name(tool.tool_id) for tool in state.tools}
    inputs = [_message_input(message) for message in state.initial_messages if message.role != "system"]
    system_history = [
        content.text
        for message in state.initial_messages
        if message.role == "system"
        for content in message.contents
        if content.text
    ]
    if system_history:
        instructions = "\n\n".join((*system_history, instructions))
    inputs.append(Input(role="user", content=[InputContent(type="text", text=_turn_prompt(state))]))
    for observation in state.history:
        if observation.arguments is not None:
            inputs.extend(_observation_inputs(observation, wire_name_by_capability))
    observation_media = [
        _image_input(content)
        for observation in state.history
        for content in observation.contents
        if content.type == "image" and content.uri
    ]
    if observation_media:
        inputs.append(Input(role="user", content=observation_media))

    capability_by_wire_name: dict[str, str] = {}
    tools: list[dict[str, object]] = []
    for tool in state.tools:
        wire_name = wire_name_by_capability[tool.tool_id]
        capability_by_wire_name[wire_name] = tool.tool_id
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": wire_name,
                    "description": f"Capability {tool.tool_id}. {tool.description}".strip(),
                    "parameters": dict(tool.parameter_schema) or {"type": "object", "properties": {}},
                },
            }
        )
    tools.extend(dict(tool) for tool in state.provider_tools)
    return (
        Request(
            model=model,
            instructions=instructions,
            inputs=inputs,
            options={"allow_multiple_tool_calls": False, "tool_choice": "auto"},
            tools=tools,
        ),
        capability_by_wire_name,
    )


def _observation_inputs(
    observation: Observation,
    wire_name_by_capability: dict[str, str],
) -> tuple[Input, Input]:
    wire_name = wire_name_by_capability.get(observation.capability, observation.capability)
    return (
        Input(
            role="assistant",
            content=[
                InputContent(
                    type="function_call",
                    call_id=observation.call_id,
                    name=wire_name,
                    arguments=dict(observation.arguments or {}),
                )
            ],
        ),
        Input(
            role="tool",
            content=[
                InputContent(
                    type="function_result",
                    call_id=observation.call_id,
                    name=wire_name,
                    result=observation.content,
                )
            ],
        ),
    )


def _message_input(message: AgentMessage) -> Input:
    contents = [
        _image_input(content) if content.type == "image" else InputContent(type="text", text=content.text)
        for content in message.contents
        if content.text or content.uri
    ]
    return Input(role=message.role, content=contents)


def _image_input(content: AgentContent) -> InputContent:
    source = image_data_url(content)
    if source.startswith("data:") and "," in source:
        header, encoded = source.split(",", 1)
        mime_type = header[5:].split(";", 1)[0]
        return InputContent(type="image", image_base64=encoded, media_type=mime_type or content.mime_type)
    return InputContent(type="image", image_url=source, file_url=source, media_type=content.mime_type)


def _turn_prompt(state: AgentModelState) -> str:
    sections = [f"Task: {state.task.title}"]
    if state.task.instructions.strip():
        sections.append(state.task.instructions.strip())
    if state.task.arguments:
        sections.append(f"Task arguments:\n{json.dumps(state.task.arguments, ensure_ascii=False)}")
    for block in state.context:
        sections.append(f"<{block.source}>\n{block.content}\n</{block.source}>")
    internal_observations = [
        {
            "capability": item.capability,
            "ok": item.ok,
            "content": item.content,
        }
        for item in state.history
        if item.arguments is None
    ]
    if internal_observations:
        sections.append(f"Runtime feedback:\n{json.dumps(internal_observations, ensure_ascii=False)}")
    return "\n\n".join(sections)


def _wire_name(capability_id: str) -> str:
    digest = hashlib.sha256(capability_id.encode("utf-8")).hexdigest()[:24]
    return f"cap_{digest}"


def _capability_call(
    wire_name: str,
    call_id: str,
    arguments: str | dict | None,
    capability_by_wire_name: dict[str, str],
) -> CapabilityCall:
    capability = capability_by_wire_name.get(wire_name, "")
    if not capability:
        return CapabilityCall(capability=wire_name, call_id=call_id)
    if isinstance(arguments, dict):
        args = arguments
    else:
        try:
            parsed = json.loads(arguments or "{}")
            args = parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            args = {}
    return CapabilityCall(capability=capability, args=args, call_id=call_id)
