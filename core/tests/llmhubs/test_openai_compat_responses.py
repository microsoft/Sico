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

from app.llmhubs.adapters.openai_compat import OpenAICompatAdapter
from app.llmhubs.types import Input, InputContent, ModelRegistryEntry, Request


def _model_entry(**config) -> ModelRegistryEntry:
    return ModelRegistryEntry(
        model_key="test-model",
        display_name="Test Model",
        model_type=2,
        provider_template_type=2,
        config={"base_url": "https://api.openai.com/v1", **config},
    )


def test_build_responses_input_preserves_interleaved_tool_item_order() -> None:
    request = Request(
        model="test-model",
        inputs=[
            Input(
                role="assistant",
                content=[
                    InputContent(type="text", text="before tool"),
                    InputContent(
                        type="function_call",
                        call_id="call-1",
                        name="lookup_weather",
                        arguments={"city": "Tokyo"},
                    ),
                    InputContent(type="text", text="after tool"),
                ],
            ),
            Input(
                role="user",
                content=[
                    InputContent(
                        type="function_result",
                        call_id="call-1",
                        result={"forecast": "sunny"},
                    ),
                    InputContent(type="text", text="continue"),
                ],
            ),
        ],
    )

    result = OpenAICompatAdapter()._build_responses_input(request, _model_entry())

    assert result == [
        {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "before tool"}],
        },
        {
            "type": "function_call",
            "call_id": "call-1",
            "name": "lookup_weather",
            "arguments": '{"city": "Tokyo"}',
        },
        {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "after tool"}],
        },
        {
            "type": "function_call_output",
            "call_id": "call-1",
            "output": '{"forecast": "sunny"}',
        },
        {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "continue"}],
        },
    ]


def test_parse_responses_stream_event_captures_annotations_from_message_item() -> None:
    chunk = OpenAICompatAdapter._parse_responses_stream_event(
        "response.output_item.done",
        {
            "item": {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "",
                        "annotations": [{"type": "url_citation", "url": "https://example.com"}],
                    }
                ],
            }
        },
    )

    assert chunk is not None
    assert chunk.delta == ""
    assert len(chunk.outputs) == 1
    assert chunk.outputs[0].type == "text"
    assert chunk.outputs[0].annotations == [{"type": "url_citation", "url": "https://example.com"}]


def test_parse_responses_stream_event_returns_terminal_usage() -> None:
    chunk = OpenAICompatAdapter._parse_responses_stream_event(
        "response.failed",
        {
            "response": {
                "usage": {
                    "input_tokens": 3,
                    "output_tokens": 5,
                    "total_tokens": 8,
                }
            }
        },
    )

    assert chunk is not None
    assert chunk.finish_reason == "error"
    assert chunk.usage is not None
    assert chunk.usage.prompt_tokens == 3
    assert chunk.usage.completion_tokens == 5
    assert chunk.usage.total_tokens == 8
