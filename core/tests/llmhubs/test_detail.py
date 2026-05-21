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
from agent_framework import Content, Message

from app.llmhubs import generate
from app.llmhubs.adapters.azure_openai import AzureOpenAIAdapter
from app.llmhubs.adapters.openai_compat import OpenAICompatAdapter
from app.llmhubs.chat_client import _chat_messages_to_llm_request
from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.image_detail import resolve_image_detail, supported_image_detail_levels
from app.llmhubs.request_builder import build_llm_request
from app.llmhubs.types import Input, InputContent, ModelRegistryEntry, Request


def _model_entry(provider_template_type: int, **config) -> ModelRegistryEntry:
    return ModelRegistryEntry(
        model_key="test-model",
        display_name="Test Model",
        model_type=2,
        provider_template_type=provider_template_type,
        config=config,
    )


def _image_request(*, detail: str) -> Request:
    return Request(
        model="test-model",
        inputs=[
            Input(
                role="user",
                content=[
                    InputContent(
                        type="image",
                        image_url="https://example.com/cat.png",
                        file_url="https://example.com/cat.png",
                        detail=detail,
                    )
                ],
            )
        ],
    )


def test_build_llm_request_preserves_top_level_image_detail() -> None:
    request = build_llm_request(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_image",
                        "image_url": "https://example.com/cat.png",
                        "detail": "high",
                    }
                ],
            }
        ],
        model="gpt5.4",
    )

    assert request.inputs[0].content[0].detail == "high"


def test_build_llm_request_preserves_nested_chat_image_detail() -> None:
    request = build_llm_request(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "https://example.com/cat.png",
                            "detail": "low",
                        },
                    }
                ],
            }
        ],
        model="gpt5.4",
    )

    assert request.inputs[0].content[0].detail == "low"


def test_chat_client_preserves_image_detail_from_additional_properties() -> None:
    request = _chat_messages_to_llm_request(
        [
            Message(
                role="user",
                contents=[
                    Content.from_uri(
                        uri="https://example.com/cat.png",
                        media_type="image/png",
                        additional_properties={"detail": "high"},
                    )
                ],
            )
        ],
        "gpt5.4",
        {},
    )

    assert request.inputs[0].content[0].detail == "high"


def test_openai_chat_completions_includes_detail_for_supported_model() -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-5.4",
        supported_image_detail_levels=["auto", "low", "high", "original"],
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(_image_request(detail="original"), entry)

    assert body["messages"][0]["content"][0]["image_url"]["detail"] == "original"


def test_openai_responses_includes_detail_for_supported_model() -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-5.4",
        supported_image_detail_levels=["auto", "low", "high", "original"],
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_responses_request(_image_request(detail="original"), entry)

    assert body["input"][0]["content"][0]["detail"] == "original"


def test_openai_compatible_backend_forwards_detail_to_non_native_endpoint_by_default() -> None:
    # Post B' semantics: Sico no longer fingerprints upstream hostnames to
    # decide whether to forward ``detail``. OpenAI-compatible endpoints (here
    # a DeepSeek-hosted vision model) get the standard ``auto``/``low``/``high``
    # passed through verbatim, and the upstream decides whether to honor it.
    entry = _model_entry(
        2,
        base_url="https://api.deepseek.com",
        upstream_model_name="deepseek-vl",
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(_image_request(detail="high"), entry)

    assert body["messages"][0]["content"][0]["image_url"]["detail"] == "high"


def test_openai_compatible_backend_opts_out_of_detail_via_empty_config() -> None:
    # Setting ``supported_image_detail_levels: []`` explicitly means "this
    # backend ignores detail entirely" — Sico drops the field from outbound
    # requests without raising. This is the migration path for providers
    # that 400 on any ``detail`` value.
    entry = _model_entry(
        2,
        base_url="https://api.deepseek.com",
        upstream_model_name="deepseek-vl",
        supported_image_detail_levels=[],
    )

    _, body, _, _ = OpenAICompatAdapter()._prepare_request(_image_request(detail="high"), entry)

    assert "detail" not in body["messages"][0]["content"][0]["image_url"]


def test_azure_openai_rejects_unsupported_original_detail_level() -> None:
    entry = _model_entry(
        1,
        endpoint="https://example.openai.azure.com",
        deployment_name="gpt-4o",
        api_version="preview",
    )

    with pytest.raises(LLMHubRuntimeError, match="does not support image detail"):
        AzureOpenAIAdapter()._azure_prepare(_image_request(detail="original"), entry)


def test_azure_openai_accepts_original_detail_when_config_declares_support() -> None:
    # Post B': ``original`` is a Sico-specific extension. The model config
    # must opt in via ``supported_image_detail_levels`` for it to be
    # accepted; Sico does not infer it from deployment or model-key names.
    entry = ModelRegistryEntry(
        model_key="gpt5.4",
        display_name="GPT 5.4",
        model_type=2,
        provider_template_type=1,
        config={
            "endpoint": "https://example.openai.azure.com",
            "deployment_name": "prod-vision-deployment",
            "api_version": "preview",
            "supported_image_detail_levels": ["auto", "low", "high", "original"],
        },
    )

    _, body, _, _ = AzureOpenAIAdapter()._azure_prepare(_image_request(detail="original"), entry)

    assert body["messages"][0]["content"][0]["image_url"]["detail"] == "original"


def test_azure_openai_rejects_original_detail_without_opt_in() -> None:
    # Mirror test for the unconfigured case: even a gpt-5.4 deployment that
    # upstream genuinely supports ``original`` gets a 400 from Sico unless
    # the config declares it. This keeps ``original`` explicit rather than
    # dependent on brittle name heuristics.
    entry = ModelRegistryEntry(
        model_key="gpt5.4",
        display_name="GPT 5.4",
        model_type=2,
        provider_template_type=1,
        config={
            "endpoint": "https://example.openai.azure.com",
            "deployment_name": "prod-vision-deployment",
            "api_version": "preview",
        },
    )

    with pytest.raises(LLMHubRuntimeError, match="does not support image detail 'original'"):
        AzureOpenAIAdapter()._azure_prepare(_image_request(detail="original"), entry)


@pytest.mark.asyncio
async def test_generate_returns_400_for_invalid_image_detail_value(
    monkeypatch: pytest.MonkeyPatch,
    install_test_hub,
) -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-4o",
    )

    install_test_hub(entry)

    response = await generate(_image_request(detail="invalid-level"), resolved_entry=entry)

    assert response.code == 400
    assert "invalid image detail value" in response.msg


# --- supported_image_detail_levels resolution policy (B') ------------------
# These tests cover the resolution rules directly so future edits cannot
# silently regress the contract documented in ``image_detail.py``.


def test_supported_image_detail_levels_defaults_to_openai_baseline() -> None:
    entry = _model_entry(
        2,
        base_url="https://api.openai.com/v1",
        upstream_model_name="gpt-4o",
    )

    assert supported_image_detail_levels(entry) == frozenset({"auto", "low", "high"})


def test_supported_image_detail_levels_returns_empty_for_non_image_model_type() -> None:
    # model_type=1 (text-only) must never forward the ``detail`` field,
    # regardless of provider or config.
    entry = ModelRegistryEntry(
        model_key="text-only-model",
        display_name="Text Only",
        model_type=1,
        provider_template_type=2,
        config={"base_url": "https://api.openai.com/v1"},
    )

    assert supported_image_detail_levels(entry) == frozenset()


def test_supported_image_detail_levels_ignores_explicit_config_for_text_model_type() -> None:
    entry = ModelRegistryEntry(
        model_key="text-only-model",
        display_name="Text Only",
        model_type=1,
        provider_template_type=2,
        config={
            "base_url": "https://api.openai.com/v1",
            "supported_image_detail_levels": ["auto", "original"],
        },
    )

    assert supported_image_detail_levels(entry) == frozenset()


def test_supported_image_detail_levels_returns_empty_for_artifact_model_type() -> None:
    entry = ModelRegistryEntry(
        model_key="artifact-model",
        display_name="Artifact Model",
        model_type=3,
        provider_template_type=2,
        config={"base_url": "https://api.openai.com/v1"},
    )

    assert supported_image_detail_levels(entry) == frozenset()


def test_supported_image_detail_levels_honors_explicit_config() -> None:
    entry = _model_entry(
        2,
        base_url="https://example.com",
        supported_image_detail_levels=["auto", "original"],
    )

    assert supported_image_detail_levels(entry) == frozenset({"auto", "original"})


def test_supported_image_detail_levels_empty_list_opts_out() -> None:
    entry = _model_entry(
        2,
        base_url="https://example.com",
        supported_image_detail_levels=[],
    )

    # Explicit empty list means "don't forward detail at all" — preserved as
    # an empty frozenset, which callers interpret as "silently drop detail".
    assert supported_image_detail_levels(entry) == frozenset()


def test_supported_image_detail_levels_drops_unknown_levels_in_config() -> None:
    # Forward compatibility: unknown levels in config are silently dropped so
    # older servers can load configs that reference newer levels.
    entry = _model_entry(
        2,
        base_url="https://example.com",
        supported_image_detail_levels=["auto", "ultra-mega-hd"],
    )

    assert supported_image_detail_levels(entry) == frozenset({"auto"})


def test_supported_image_detail_levels_accepts_comma_separated_string() -> None:
    entry = _model_entry(
        2,
        base_url="https://example.com",
        supported_image_detail_levels="auto, high , original",
    )

    assert supported_image_detail_levels(entry) == frozenset({"auto", "high", "original"})


def test_resolve_image_detail_returns_none_when_model_opts_out() -> None:
    # When the model explicitly opts out, a caller-supplied ``detail`` value
    # is dropped silently — no exception — so existing chat payloads remain
    # valid against providers that reject any ``detail`` field.
    entry = _model_entry(
        2,
        base_url="https://example.com",
        supported_image_detail_levels=[],
    )

    assert resolve_image_detail(entry, "high") is None
