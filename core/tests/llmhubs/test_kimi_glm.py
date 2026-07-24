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

import pytest
from agent_framework import Message

from app.llmhubs.adapters.openai_compat import OpenAICompatAdapter
from app.llmhubs.chat_client import _chat_messages_to_llm_request, _response_outputs_to_contents
from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.types import Input, InputContent, ModelRegistryEntry, OutputItem, Request, Response


def _entry(
    model_key: str,
    *,
    model_type: int = 1,
    **config,
) -> ModelRegistryEntry:
    return ModelRegistryEntry(
        model_key=model_key,
        display_name=model_key,
        model_type=model_type,
        provider_template_type=2,
        io_profile={
            "supports_reasoning": True,
            "supports_tools": True,
            "supports_structured_output": True,
        },
        config={
            "base_url": "https://provider.example/v1",
            "path": "/chat/completions",
            "upstream_model_name": model_key,
            **config,
        },
    )


def _tool_request(model: str, **options) -> Request:
    return Request(
        model=model,
        inputs=[
            Input(
                role="user",
                content=[InputContent(type="text", text="What is the weather?")],
            )
        ],
        options=options,
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "parameters": {"type": "object"},
                },
            }
        ],
    )


def test_kimi_k3_uses_official_reasoning_and_completion_fields() -> None:
    entry = _entry(
        "kimi-k3",
        reasoning_request_format="reasoning_effort",
        reasoning_content_field="reasoning_content",
        max_tokens_field="max_completion_tokens",
        max_tokens=131072,
    )
    request = _tool_request(
        "kimi-k3",
        reasoning={"effort": "high"},
        max_tokens=4096,
        tool_choice="auto",
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)

    assert body["reasoning_effort"] == "high"
    assert body["max_completion_tokens"] == 4096
    assert "max_tokens" not in body
    assert body["tool_choice"] == "auto"


def test_glm_5_2_uses_thinking_reasoning_effort_and_max_tokens() -> None:
    entry = _entry(
        "glm-5.2",
        reasoning_request_format="reasoning_effort",
        reasoning_content_field="reasoning_content",
        chat_completions_defaults={
            "thinking": {"type": "enabled", "clear_thinking": False}
        },
        supported_tool_choice_values=["auto"],
        max_tokens=131072,
    )
    request = _tool_request(
        "glm-5.2",
        reasoning_effort="max",
        max_tokens=4096,
        tool_choice="auto",
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)

    assert body["thinking"] == {"type": "enabled", "clear_thinking": False}
    assert body["reasoning_effort"] == "max"
    assert body["max_tokens"] == 4096


def test_request_thinking_overrides_glm_default() -> None:
    entry = _entry(
        "glm-5.2",
        reasoning_request_format="reasoning_effort",
        chat_completions_defaults={"thinking": {"type": "enabled"}},
    )
    request = _tool_request(
        "glm-5.2",
        thinking={"type": "disabled"},
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)

    assert body["thinking"] == {"type": "disabled"}


def test_openrouter_reasoning_passthrough_remains_backward_compatible() -> None:
    entry = _entry("openrouter-model")
    entry.config["base_url"] = "https://openrouter.ai/api/v1"
    entry.io_profile.pop("supports_reasoning")
    request = _tool_request(
        "openrouter-model",
        reasoning={"effort": "high"},
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)

    assert body["reasoning"] == {"effort": "high"}


def test_openrouter_max_completion_tokens_remains_backward_compatible() -> None:
    entry = _entry("openrouter-model")
    entry.config["base_url"] = "https://openrouter.ai/api/v1"
    request = _tool_request(
        "openrouter-model",
        max_completion_tokens=4096,
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)

    assert body["max_completion_tokens"] == 4096
    assert "max_tokens" not in body


def test_glm_rejects_non_auto_tool_choice() -> None:
    entry = _entry(
        "glm-5.2",
        reasoning_request_format="reasoning_effort",
        supported_tool_choice_values=["auto"],
    )

    with pytest.raises(LLMHubRuntimeError, match="does not support tool_choice"):
        OpenAICompatAdapter()._prepare_request(
            _tool_request("glm-5.2", tool_choice="required"),
            entry,
        )


def test_glm_rejects_unadvertised_json_schema_mode() -> None:
    entry = _entry(
        "glm-5.2",
        reasoning_request_format="reasoning_effort",
        supported_response_format_types=["json_object"],
    )

    with pytest.raises(LLMHubRuntimeError, match="does not support response_format type"):
        OpenAICompatAdapter()._prepare_request(
            _tool_request(
                "glm-5.2",
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "Answer", "schema": {}},
                },
            ),
            entry,
        )


def test_kimi_k3_accepts_data_images_and_rejects_http_images() -> None:
    entry = _entry(
        "kimi-k3",
        model_type=2,
        reasoning_request_format="reasoning_effort",
        supported_image_url_schemes=["data", "ms"],
        supported_image_detail_levels=[],
    )
    base64_request = Request(
        model="kimi-k3",
        inputs=[
            Input(
                role="user",
                content=[InputContent(type="image", image_base64="iVBORw0KGgo=")],
            )
        ],
    )
    _, body, _, _ = OpenAICompatAdapter()._prepare_request(base64_request, entry)
    assert body["messages"][0]["content"][0]["image_url"]["url"].startswith("data:image/png;base64,")

    http_request = Request(
        model="kimi-k3",
        inputs=[
            Input(
                role="user",
                content=[InputContent(type="image", image_url="https://example.com/cat.png")],
            )
        ],
    )
    with pytest.raises(LLMHubRuntimeError, match="does not support image URL scheme"):
        OpenAICompatAdapter()._prepare_request(http_request, entry)


def test_non_streaming_reasoning_is_attached_to_tool_call_and_replayed() -> None:
    entry = _entry(
        "glm-5.2",
        reasoning_request_format="reasoning_effort",
        reasoning_content_field="reasoning_content",
    )
    response = OpenAICompatAdapter._parse_response(
        {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "reasoning_content": "I should check the weather.",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "get_weather", "arguments": "{}"},
                            }
                        ],
                    }
                }
            ]
        },
        entry,
    )
    tool_call = response.outputs[0]
    assert tool_call.provider_metadata == {
        "openai_compatible": {
            "model_key": "glm-5.2",
            "reasoning_content": "I should check the weather.",
        }
    }

    request = Request(
        model="glm-5.2",
        inputs=[
            Input(
                role="assistant",
                content=[
                    InputContent(
                        type="function_call",
                        call_id=tool_call.call_id,
                        name=tool_call.name,
                        arguments=tool_call.arguments,
                        provider_metadata=tool_call.provider_metadata,
                    )
                ],
            )
        ],
    )
    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)
    assert body["messages"][0]["reasoning_content"] == "I should check the weather."


def test_reasoning_metadata_is_not_replayed_to_another_model() -> None:
    entry = _entry(
        "kimi-k3",
        reasoning_request_format="reasoning_effort",
        reasoning_content_field="reasoning_content",
    )
    request = Request(
        model="kimi-k3",
        inputs=[
            Input(
                role="assistant",
                content=[
                    InputContent(
                        type="function_call",
                        call_id="call_1",
                        name="get_weather",
                        arguments="{}",
                        provider_metadata={
                            "openai_compatible": {
                                "model_key": "glm-5.2",
                                "reasoning_content": "GLM-only reasoning",
                            }
                        },
                    )
                ],
            )
        ],
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)

    assert "reasoning_content" not in body["messages"][0]


def test_streaming_reasoning_is_accumulated_and_attached_to_tool_call() -> None:
    entry = _entry(
        "kimi-k3",
        reasoning_request_format="reasoning_effort",
        reasoning_content_field="reasoning_content",
    )
    tool_state: dict[int, dict[str, str]] = {}
    metadata_state: dict[str, str] = {}

    assert (
        OpenAICompatAdapter._parse_stream_chunk(
            {"choices": [{"delta": {"reasoning_content": "Check "}}]},
            tool_state,
            metadata_state,
            entry,
        )
        is None
    )
    OpenAICompatAdapter._parse_stream_chunk(
        {
            "choices": [
                {
                    "delta": {
                        "reasoning_content": "weather.",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "function": {"name": "get_weather", "arguments": "{"},
                            }
                        ],
                    }
                }
            ]
        },
        tool_state,
        metadata_state,
        entry,
    )
    chunk = OpenAICompatAdapter._parse_stream_chunk(
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {"index": 0, "function": {"arguments": "}"}}
                        ]
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        },
        tool_state,
        metadata_state,
        entry,
    )

    assert chunk is not None
    assert chunk.outputs[0].arguments == "{}"
    assert chunk.outputs[0].provider_metadata == {
        "openai_compatible": {
            "model_key": "kimi-k3",
            "reasoning_content": "Check weather.",
        }
    }
    assert metadata_state == {}


def test_metadata_only_reasoning_survives_chat_client_round_trip() -> None:
    provider_metadata = {
        "openai_compatible": {
            "model_key": "glm-5.2",
            "reasoning_content": "Preserve this exactly.",
        }
    }
    contents = _response_outputs_to_contents(
        Response(outputs=[OutputItem(type="text", provider_metadata=provider_metadata)])
    )
    assert len(contents) == 1

    request = _chat_messages_to_llm_request(
        [Message(role="assistant", contents=contents)],
        "glm-5.2",
        {},
    )
    assert request.inputs[0].content[0].provider_metadata == provider_metadata

    entry = _entry(
        "glm-5.2",
        reasoning_request_format="reasoning_effort",
        reasoning_content_field="reasoning_content",
    )
    _, body, _, _ = OpenAICompatAdapter()._prepare_request(request, entry)
    assert body["messages"] == [
        {
            "role": "assistant",
            "content": "",
            "reasoning_content": "Preserve this exactly.",
        }
    ]
