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

"""-backed BaseChatClient for agent_framework integration."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterable, Awaitable, Callable, MutableSequence, Sequence
from typing import Any

from agent_framework import BaseChatClient, ChatResponse, ChatResponseUpdate, Content, Message
from agent_framework._tools import FunctionInvocationLayer, FunctionTool
from agent_framework._types import Annotation, ResponseStream, TextSpanRegion, UsageDetails

from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.hub import LLMHub
from app.llmhubs.response_format import build_response_format_option
from app.llmhubs.types import Input, InputContent, OutputItem, Request, Response, StreamChunk

logger = logging.getLogger(__name__)


class ChatClient(FunctionInvocationLayer, BaseChatClient):
    """A BaseChatClient backed by LLMHub — supports both sync and streaming."""

    def __init__(self, hub: LLMHub, model: str) -> None:
        super().__init__()
        self._hub = hub
        self._model = model

    def _inner_get_response(
        self,
        *,
        messages: Sequence[Message],
        stream: bool,
        options: dict[str, Any],
        **kwargs: Any,
    ) -> Awaitable[ChatResponse] | ResponseStream[ChatResponseUpdate, ChatResponse]:
        if stream:
            return ResponseStream(
                self._inner_get_streaming_response(messages=messages, options=options, **kwargs),
                finalizer=ChatResponse.from_updates,
            )
        return self._inner_get_non_streaming_response(messages=messages, options=options, **kwargs)

    async def _inner_get_non_streaming_response(
        self,
        *,
        messages: Sequence[Message],
        options: dict[str, Any],
        **kwargs: Any,
    ) -> ChatResponse:
        request = _chat_messages_to_llm_request(messages, self._model, options)
        response = await self._hub.generate(request)
        if response.code != 0:
            raise LLMHubRuntimeError(
                response.msg or f"LLMHub generate failed with code={response.code}",
                code=response.code,
                model=response.trace.model or self._model,
            )
        contents = _response_outputs_to_contents(response)
        return ChatResponse(
            messages=[Message(role="assistant", contents=contents)],
            finish_reason=_extract_finish_reason(response),
            usage_details=_usage_to_details(response),
            response_id=response.payload.get("id"),
            model=response.trace.model or self._model,
            additional_properties={"payload": response.payload} if response.payload else None,
        )

    async def _inner_get_streaming_response(
        self,
        *,
        messages: Sequence[Message],
        options: dict[str, Any],
        **kwargs: Any,
    ) -> AsyncIterable[ChatResponseUpdate]:
        request = _chat_messages_to_llm_request(messages, self._model, options)
        async for chunk in self._hub.generate_stream(request):
            if chunk.finish_reason == "error":
                raise LLMHubRuntimeError(
                    chunk.delta or "LLMHub streaming response failed",
                    model=self._model,
                )
            update = _stream_chunk_to_update(chunk, self._model)
            if update is not None:
                yield update


def _scan_computer_call_ids(messages: MutableSequence[Message]) -> set[str]:
    """Collect ``call_id``s referenced by computer_call entries across all messages."""
    computer_call_ids: set[str] = set()
    for msg in messages:
        for c in getattr(msg, "contents", None) or []:
            if c.type == "function_call" and c.name == "computer":
                computer_call_ids.add(c.call_id)
    return computer_call_ids


def _build_text_input(c: Any) -> InputContent | None:
    if not c.text:
        return None
    return InputContent(type="text", text=str(c.text))


def _build_function_call_input(c: Any) -> InputContent:
    if c.name == "computer":
        actions: list[dict[str, Any]] | None = None
        arguments = c.arguments
        if isinstance(arguments, str) and arguments.strip():
            try:
                parsed_arguments = json.loads(arguments)
                if isinstance(parsed_arguments, list):
                    actions = parsed_arguments
            except Exception:
                actions = None
        return InputContent(
            type="computer_call",
            call_id=c.call_id,
            name=c.name,
            actions=actions,
            arguments=c.arguments,
        )
    return InputContent(
        type="function_call",
        call_id=c.call_id,
        name=c.name,
        arguments=c.arguments,
    )


def _build_function_result_input(c: Any, computer_call_ids: set[str]) -> InputContent:
    if c.call_id in computer_call_ids:
        # Map back to computer_call_output for the Responses API.
        result_data = c.result
        if isinstance(result_data, dict):
            output_data = result_data
        elif isinstance(result_data, str):
            output_data = {
                "type": "computer_screenshot",
                "image_url": f"data:image/png;base64,{result_data}",
            }
        else:
            output_data = {}
        return InputContent(
            type="computer_call_output",
            call_id=c.call_id,
            output=output_data,
        )
    return InputContent(
        type="function_result",
        call_id=c.call_id,
        name=getattr(c, "name", ""),
        result=c.result,
    )


def _build_uri_image_input(c: Any) -> InputContent | None:
    if not c.has_top_level_media_type("image"):
        return None
    return InputContent(
        type="image",
        image_url=str(c.uri),
        file_url=str(c.uri),
        detail=_extract_image_detail(c),
        media_type=c.media_type or "",
    )


def _build_data_image_input(c: Any) -> InputContent | None:
    if not c.has_top_level_media_type("image"):
        return None
    image_uri = str(c.uri)
    image_base64 = image_uri.split(",", 1)[1] if image_uri.startswith("data:") and "," in image_uri else ""
    return InputContent(
        type="image",
        image_base64=image_base64,
        detail=_extract_image_detail(c),
        media_type=c.media_type or "",
    )


_CONTENT_ITEM_BUILDERS: dict[str, Callable[[Any, set[str]], InputContent | None]] = {
    "text": lambda c, _ids: _build_text_input(c),
    "function_call": lambda c, _ids: _build_function_call_input(c),
    "function_result": _build_function_result_input,
    "uri": lambda c, _ids: _build_uri_image_input(c),
    "data": lambda c, _ids: _build_data_image_input(c),
}


def _build_input_contents_from_message(
    message: Message,
    computer_call_ids: set[str],
) -> tuple[list[InputContent], str]:
    """Return the (content_parts, role) pair for a single ``Message``."""
    role = message.role if isinstance(message.role, str) else message.role.value
    content_parts: list[InputContent] = []

    for c in getattr(message, "contents", None) or []:
        builder = _CONTENT_ITEM_BUILDERS.get(c.type)
        if builder is None:
            continue
        part = builder(c, computer_call_ids)
        if part is not None:
            content_parts.append(part)

    text_val = getattr(message, "text", None)
    if text_val:
        text_value = text_val.text if hasattr(text_val, "text") else str(text_val)
        has_text_content = any(part.type == "text" for part in content_parts)
        if not has_text_content:
            content_parts.insert(0, InputContent(type="text", text=text_value))

    return content_parts, role


_REQUEST_OPTION_PASSTHROUGH_KEYS: tuple[str, ...] = (
    "temperature",
    "top_p",
    "max_tokens",
    "frequency_penalty",
    "presence_penalty",
    "request_timeout_ms",
    "stop",
    "seed",
    "tool_choice",
    "timeout_ms",
    "allow_multiple_tool_calls",
)


def _map_request_options(options: dict[str, Any]) -> dict[str, Any]:
    """Map agent_framework options dict → LLMHub ``Request.options`` dict."""
    llm_options: dict[str, Any] = {}
    if "response_format" in options:
        rf = options["response_format"]
        if rf is not None and hasattr(rf, "model_json_schema"):
            llm_options["response_format"] = build_response_format_option(rf)
        elif rf is not None:
            llm_options["response_format"] = rf
    if "reasoning" in options:
        reasoning = options["reasoning"]
        if isinstance(reasoning, dict) and "effort" in reasoning:
            llm_options["reasoning"] = {"effort": reasoning["effort"]}
    for key in _REQUEST_OPTION_PASSTHROUGH_KEYS:
        value = options.get(key)
        if value is not None:
            llm_options[key] = value
    return llm_options


def _chat_messages_to_llm_request(
    messages: MutableSequence[Message],
    model: str,
    options: dict[str, Any],
) -> Request:
    """Convert agent_framework Message list → Request."""
    instruction_parts: list[str] = []
    inputs: list[Input] = []

    # Scan messages to identify call_ids from computer_call outputs,
    # so we can convert their FunctionResultContent back to computer_call_output.
    computer_call_ids = _scan_computer_call_ids(messages)

    for msg in messages:
        content_parts, role = _build_input_contents_from_message(msg, computer_call_ids)

        if not content_parts:
            continue

        if role == "system":
            instruction_parts.extend(part.text for part in content_parts if part.type == "text" and part.text)
        else:
            inputs.append(Input(role=role, content=content_parts))

    llm_options = _map_request_options(options)
    tools = _prepare_tools(options.get("tools"))

    previous_response_id = options.get("previous_response_id", "")

    return Request(
        model=model,
        instructions="\n\n".join(instruction_parts),
        inputs=inputs,
        options=llm_options,
        tools=tools,
        previous_response_id=previous_response_id,
    )


def _prepare_tools(tools: list[Any] | None) -> list[dict[str, Any]]:
    if not tools:
        return []

    prepared: list[dict[str, Any]] = []
    for tool in tools:
        if isinstance(tool, FunctionTool):
            prepared.append(tool.to_json_schema_spec())
        elif isinstance(tool, dict):
            prepared.append(dict(tool))
        else:
            to_json_schema_spec = getattr(tool, "to_json_schema_spec", None)
            if callable(to_json_schema_spec):
                prepared.append(to_json_schema_spec())
            else:
                logger.debug("Skipping unsupported tool type for chat client: %s", type(tool))
    return prepared


def _extract_image_detail(content: Content) -> str:
    additional_properties = getattr(content, "additional_properties", None)
    if isinstance(additional_properties, dict):
        detail = additional_properties.get("detail")
        if detail is not None:
            return str(detail)
    detail = getattr(content, "detail", "")
    return str(detail) if detail is not None else ""


def _response_outputs_to_contents(response: Response) -> list[Any]:
    contents: list[Any] = []
    for output in response.outputs:
        content = _output_to_content(output)
        if content is not None:
            contents.append(content)
    return contents


def _output_text_to_content(output: OutputItem) -> Content | None:
    if not (output.text or output.annotations):
        return None
    annotations = _parse_url_citations(output.annotations) if output.annotations else None
    return Content.from_text(
        text=output.text,
        **({"annotations": annotations} if annotations else {}),
    )


def _output_refusal_to_content(output: OutputItem) -> Content | None:
    if not output.text:
        return None
    return Content.from_text(text=output.text)


def _output_function_call_to_content(output: OutputItem) -> Content | None:
    return Content.from_function_call(
        call_id=output.call_id,
        name=output.name,
        arguments=output.arguments or "",
    )


def _output_function_result_to_content(output: OutputItem) -> Content | None:
    return Content.from_function_result(
        call_id=output.call_id,
        result=output.result,
    )


def _output_computer_call_to_content(output: OutputItem) -> Content | None:
    return Content.from_function_call(
        call_id=output.call_id,
        name="computer",
        arguments=json.dumps(output.actions or [], ensure_ascii=False),
    )


def _output_web_search_call_to_content(output: OutputItem) -> Content | None:
    # Server-side tool; no client execution needed. Return as metadata-only text.
    query = ""
    if output.action and isinstance(output.action, dict):
        query = output.action.get("query", "")
    if query:
        return Content.from_text(text="", additional_properties={"web_search_query": query})
    return None


_OUTPUT_HANDLERS: dict[str, Callable[[OutputItem], Content | None]] = {
    "text": _output_text_to_content,
    "refusal": _output_refusal_to_content,
    "function_call": _output_function_call_to_content,
    "function_result": _output_function_result_to_content,
    "computer_call": _output_computer_call_to_content,
    "web_search_call": _output_web_search_call_to_content,
}


def _output_to_content(output: OutputItem) -> Content | None:
    handler = _OUTPUT_HANDLERS.get(output.type)
    if handler is None:
        return None
    return handler(output)


def _parse_url_citations(raw_annotations: list[dict[str, Any]]) -> list[Annotation]:
    """Convert Azure OpenAI url_citation annotations to Annotation TypedDicts."""
    citations: list[Annotation] = []
    for ann in raw_annotations:
        if ann.get("type") != "url_citation":
            continue
        regions: list[TextSpanRegion] = []
        start = ann.get("start_index")
        end = ann.get("end_index")
        if start is not None and end is not None:
            regions.append(TextSpanRegion(type="text_span", start_index=start, end_index=end))
        citations.append(
            Annotation(
                type="citation",
                title=ann.get("title", ""),
                url=ann.get("url", ""),
                annotated_regions=regions if regions else [],
            )
        )
    return citations


def _stream_chunk_to_update(chunk: StreamChunk, model: str) -> ChatResponseUpdate | None:
    contents: list[Any] = []
    for output in chunk.outputs:
        content = _output_to_content(output)
        if content is not None:
            contents.append(content)
    if chunk.usage is not None:
        contents.append(Content.from_usage(usage_details=_usage_to_details_from_chunk(chunk), raw_representation=chunk))
    if not contents and not chunk.finish_reason and not chunk.delta:
        return None
    if chunk.delta and not any(content.type == "text" and content.text == chunk.delta for content in contents):
        contents.insert(0, Content.from_text(text=chunk.delta))
    return ChatResponseUpdate(
        role="assistant",
        contents=contents,
        finish_reason=chunk.finish_reason,
        model=model,
    )


def _usage_to_details(response: Response) -> UsageDetails | None:
    usage = response.usage
    if usage.total_tokens == 0 and usage.prompt_tokens == 0 and usage.completion_tokens == 0:
        return None
    return UsageDetails(
        input_token_count=usage.prompt_tokens,
        output_token_count=usage.completion_tokens,
        total_token_count=usage.total_tokens,
    )


def _usage_to_details_from_chunk(chunk: StreamChunk) -> UsageDetails:
    usage = chunk.usage
    if usage is None:
        return UsageDetails(input_token_count=None, output_token_count=None, total_token_count=None)
    return UsageDetails(
        input_token_count=usage.prompt_tokens,
        output_token_count=usage.completion_tokens,
        total_token_count=usage.total_tokens,
    )


def _extract_finish_reason(response: Response) -> str | None:
    # Chat Completions format
    choices = response.payload.get("choices", []) if response.payload else []
    if choices:
        return choices[0].get("finish_reason")
    # Responses API format
    status = response.payload.get("status") if response.payload else None
    if status == "completed":
        return "stop"
    if status and status != "in_progress":
        return status
    return None
