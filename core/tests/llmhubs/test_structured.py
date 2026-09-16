from __future__ import annotations

import pytest
from pydantic import BaseModel

from app.llmhubs.structured import HubLLMClient, StructuredResponseDecodeError
from app.llmhubs.types import OutputItem, Response, Trace, Usage


class _Result(BaseModel):
    value: int


class _StubHub:
    def __init__(self, response: Response) -> None:
        self.response = response
        self.request = None

    async def generate(self, request) -> Response:
        self.request = request
        return self.response


def _client(response: Response) -> HubLLMClient:
    client = object.__new__(HubLLMClient)
    client.model = "test-model"
    client._hub = _StubHub(response)
    return client


@pytest.mark.asyncio
async def test_structured_completion_delegates_default_model_to_hub() -> None:
    client = _client(Response(outputs=[OutputItem(type="text", text='{"value": 1}')]))
    client.model = ""

    await client.complete_structured_result(_Result, prompt="Return one value")

    assert client._hub.request.model == ""


@pytest.mark.asyncio
async def test_structured_completion_collapses_equivalent_text_outputs() -> None:
    client = _client(
        Response(
            outputs=[
                OutputItem(type="text", text='{"value": 1}'),
                OutputItem(type="text", text='{"value":1}'),
            ]
        )
    )

    completion = await client.complete_structured_result(_Result, prompt="Return one value")

    assert completion.value == _Result(value=1)


@pytest.mark.asyncio
async def test_structured_decode_error_includes_raw_response_and_output_count() -> None:
    client = _client(
        Response(
            outputs=[
                OutputItem(type="text", text='{"value": 1}'),
                OutputItem(type="text", text='{"value": 2}'),
            ],
            usage=Usage(prompt_tokens=3, completion_tokens=4, total_tokens=7),
            trace=Trace(model="test-model", latency_ms=9),
        )
    )

    with pytest.raises(StructuredResponseDecodeError) as caught:
        await client.complete_structured_result(_Result, prompt="Return one value")

    message = str(caught.value)
    assert "Extra data at line 2 column 1" in message
    assert "text_output_count=2" in message
    assert "response_chars=25" in message
    assert 'raw_response=\'{"value": 1}\\n{"value": 2}\'' in message
    assert caught.value.candidates == (_Result(value=1), _Result(value=2))
    assert caught.value.usage == Usage(prompt_tokens=3, completion_tokens=4, total_tokens=7)
    assert caught.value.trace == Trace(model="test-model", latency_ms=9)


@pytest.mark.asyncio
async def test_structured_decode_error_bounds_raw_response_excerpt() -> None:
    malformed = '{"value": 1}' + ("x" * 5_000) + '{"value": 2}'
    client = _client(Response(outputs=[OutputItem(type="text", text=malformed)]))

    with pytest.raises(StructuredResponseDecodeError) as caught:
        await client.complete_structured_result(_Result, prompt="Return one value")

    message = str(caught.value)
    assert "text_output_count=1" in message
    assert f"response_chars={len(malformed)}" in message
    assert "chars omitted" in message
    assert len(message) < 4_500
