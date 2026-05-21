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

from app.biz.llm.service import _normalize_integer_request_options
from app.llmhubs import generate, generate_stream
from app.llmhubs.adapters.anthropic import AnthropicAdapter
from app.llmhubs.adapters.azure_openai import AzureOpenAIAdapter
from app.llmhubs.adapters.gemini import GeminiAdapter
from app.llmhubs.adapters.http_binary import HttpBinaryAdapter
from app.llmhubs.adapters.http_json import HttpJsonAdapter
from app.llmhubs.adapters.openai_compat import OpenAICompatAdapter
from app.llmhubs.chat_client import _chat_messages_to_llm_request
from app.llmhubs.request_builder import build_llm_request
from app.llmhubs.types import Input, InputContent, ModelRegistryEntry, Request


def _model_entry(provider_template_type: int, **config) -> ModelRegistryEntry:
    return ModelRegistryEntry(
        model_key="test-model",
        display_name="Test Model",
        model_type=1,
        provider_template_type=provider_template_type,
        config=config,
    )


def _text_request(*, timeout_ms: object | None = None) -> Request:
    options: dict[str, object] = {}
    if timeout_ms is not None:
        options["timeout_ms"] = timeout_ms
    return Request(
        model="test-model",
        inputs=[
            Input(
                role="user",
                content=[InputContent(type="text", text="hello")],
            )
        ],
        options=options,
    )


class _FakeResponse:
    def __init__(self, data: dict[str, object], *, headers: dict[str, str] | None = None) -> None:
        self._data = data
        self.headers = headers or {"content-type": "application/json"}
        self.content = b""

    def json(self) -> dict[str, object]:
        return self._data


def test_build_llm_request_preserves_timeout_ms() -> None:
    request = build_llm_request(
        [{"role": "user", "content": "hello"}],
        model="gpt5.4",
        timeout_ms=120000,
    )

    assert request.options["timeout_ms"] == 120000


def test_chat_client_preserves_timeout_ms_option() -> None:
    request = _chat_messages_to_llm_request(
        [Message(role="user", contents=["hello"])],
        "gpt5.4",
        {"timeout_ms": 15000},
    )

    assert request.options["timeout_ms"] == 15000


def test_runtime_request_normalizes_timeout_ms_to_integer() -> None:
    options = _normalize_integer_request_options({"timeout_ms": 45000.0, "request_timeout_ms": 120000.0})

    assert options["timeout_ms"] == 45000
    assert options["request_timeout_ms"] == 120000


def test_openai_compat_request_timeout_overrides_model_default() -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-4.1",
        timeout_ms=60000,
    )

    request = _text_request(timeout_ms=12000)

    _, _, _, timeout = OpenAICompatAdapter()._prepare_request(request, entry)
    _, _, _, responses_timeout = OpenAICompatAdapter()._prepare_responses_request(request, entry)

    assert timeout == pytest.approx(12.0)
    assert responses_timeout == pytest.approx(12.0)


def test_azure_openai_request_timeout_overrides_model_default() -> None:
    entry = _model_entry(
        1,
        endpoint="https://example.openai.azure.com",
        deployment_name="gpt-4.1",
        api_version="preview",
        timeout_ms=60000,
    )

    request = _text_request(timeout_ms=12000)

    _, _, _, timeout = AzureOpenAIAdapter()._azure_prepare(request, entry)
    _, _, _, responses_timeout = AzureOpenAIAdapter()._azure_prepare_responses(request, entry)

    assert timeout == pytest.approx(12.0)
    assert responses_timeout == pytest.approx(12.0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("adapter_cls", "entry", "payload"),
    [
        (
            AnthropicAdapter,
            _model_entry(
                6,
                base_url="https://api.anthropic.com",
                upstream_model_name="claude-sonnet-4",
                timeout_ms=60000,
            ),
            {"content": [{"type": "text", "text": "ok"}], "usage": {}},
        ),
        (
            GeminiAdapter,
            _model_entry(
                7,
                base_url="https://generativelanguage.googleapis.com",
                upstream_model_name="gemini-2.5-flash",
                timeout_ms=60000,
            ),
            {"candidates": [{"content": {"parts": [{"text": "ok"}]}}], "usageMetadata": {}},
        ),
        (
            HttpJsonAdapter,
            _model_entry(
                4,
                base_url="https://example.com",
                request_field_mapping={"prompt": "input_text"},
                response_extraction={"text_path": "$.result"},
                timeout_ms=60000,
            ),
            {"result": "ok"},
        ),
        (
            HttpBinaryAdapter,
            _model_entry(
                5,
                base_url="https://example.com",
                request_field_mapping={"prompt": "input_text"},
                response_extraction={"download_url_path": "$.download_url", "artifact_type": "binary"},
                timeout_ms=60000,
            ),
            {"download_url": "https://example.com/output.bin"},
        ),
    ],
)
async def test_request_timeout_override_applies_to_non_openai_adapters(
    adapter_cls: type,
    entry: ModelRegistryEntry,
    payload: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, float] = {}

    async def fake_post(
        url: str,
        *,
        json: object,
        headers: dict[str, str],
        timeout: float,
        retry_mode: str = "full",
    ) -> _FakeResponse:
        del url, json, headers, retry_mode
        captured["timeout"] = timeout
        return _FakeResponse(payload)

    monkeypatch.setattr(adapter_cls, "_post", staticmethod(fake_post))

    adapter = adapter_cls()
    await adapter.generate(_text_request(timeout_ms=9000), entry)

    assert captured["timeout"] == pytest.approx(9.0)


@pytest.mark.asyncio
async def test_generate_returns_400_for_invalid_request_timeout_ms(
    monkeypatch: pytest.MonkeyPatch,
    install_test_hub,
) -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-4.1",
        timeout_ms=60000,
    )

    install_test_hub(entry)

    response = await generate(_text_request(timeout_ms="bad-timeout"), resolved_entry=entry)

    assert response.code == 400
    assert "request.options.timeout_ms" in response.msg


@pytest.mark.asyncio
async def test_generate_returns_400_for_zero_timeout_ms(
    monkeypatch: pytest.MonkeyPatch,
    install_test_hub,
) -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-4.1",
        timeout_ms=60000,
    )

    install_test_hub(entry)

    response = await generate(_text_request(timeout_ms=0), resolved_entry=entry)

    assert response.code == 400


def test_timeout_below_minimum_is_clamped_to_5_seconds() -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-4.1",
        timeout_ms=60000,
    )

    request = _text_request(timeout_ms=3000)

    _, _, _, timeout = OpenAICompatAdapter()._prepare_request(request, entry)

    assert timeout == pytest.approx(5.0)


def test_model_config_invalid_timeout_falls_back_to_default() -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-4.1",
        timeout_ms="not-a-number",
    )

    request = _text_request()  # no request-level override

    _, _, _, timeout = OpenAICompatAdapter()._prepare_request(request, entry)

    assert timeout == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_generate_returns_400_when_previous_response_id_unsupported(
    monkeypatch,
    install_test_hub,
) -> None:
    entry = ModelRegistryEntry(
        model_key="no-prev-id",
        display_name="No Previous ID",
        model_type=1,
        provider_template_type=2,
        io_profile={"supports_previous_response_id": False},
        config={
            "base_url": "https://api.openai.com/v1",
            "upstream_model_name": "gpt-4.1",
            "timeout_ms": 60000,
        },
    )

    install_test_hub(entry)

    request = Request(
        model="no-prev-id",
        inputs=[Input(role="user", content=[InputContent(type="text", text="hi")])],
        previous_response_id="resp_123",
    )

    response = await generate(request, resolved_entry=entry)

    assert response.code == 400
    assert "previous_response_id" in response.msg


@pytest.mark.asyncio
async def test_generate_stream_raises_when_previous_response_id_unsupported(
    monkeypatch,
    install_test_hub,
) -> None:
    from app.llmhubs.errors import LLMHubRuntimeError

    entry = ModelRegistryEntry(
        model_key="no-prev-id-stream",
        display_name="No Previous ID Stream",
        model_type=1,
        provider_template_type=2,
        io_profile={"supports_previous_response_id": False},
        config={
            "base_url": "https://api.openai.com/v1",
            "upstream_model_name": "gpt-4.1",
            "timeout_ms": 60000,
        },
    )

    install_test_hub(entry)

    request = Request(
        model="no-prev-id-stream",
        inputs=[Input(role="user", content=[InputContent(type="text", text="hi")])],
        previous_response_id="resp_123",
    )

    with pytest.raises(LLMHubRuntimeError) as excinfo:
        async for _ in generate_stream(request, resolved_entry=entry):
            pass

    assert excinfo.value.code == 400
    assert "previous_response_id" in str(excinfo.value)
