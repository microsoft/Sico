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

"""Experience-learning LLM adapters backed by llmhubs.

The generic single-shot structured-output client (:class:`LLMClient` /
:class:`HubLLMClient`) now lives in :mod:`app.llmhubs.structured` so every layer
can reuse it without importing across domain packages; this module keeps the
embedding client, which is specific to experience deduplication.
"""

from __future__ import annotations

from app.llmhubs.hub import LLMHub
from app.llmhubs.structured import DEFAULT_CHAT_MODEL, HubLLMClient, LLMClient

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


class LLMHubEmbeddingClient:
    """Embedding client using LLMHub for configuration."""

    def __init__(self, *, model: str = DEFAULT_EMBEDDING_MODEL) -> None:
        self._hub = LLMHub()
        self._model = model

    def embed(self, text: str) -> list[float]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        # Use the LLMHub to generate embeddings via the configured model
        # The embedding model must be configured in llmhubs configs
        from app.llmhubs.config_loader import ModelConfigLoader

        loader = ModelConfigLoader()
        definitions = loader.load()
        definition = definitions.get(self._model)
        if definition is None:
            raise ValueError(f"Embedding model '{self._model}' not found in llmhubs configs")

        config = definition.config
        endpoint = config.get("endpoint")
        api_key = config.get("api_key")
        api_version = config.get("api_version", "preview")
        deployment_name = config.get("deployment_name") or self._model

        if not endpoint:
            raise RuntimeError(f"Embedding model '{self._model}' is missing endpoint configuration")

        from openai import AzureOpenAI

        if api_key:
            client = AzureOpenAI(
                azure_endpoint=endpoint,
                api_version=api_version,
                api_key=api_key,
            )
        else:
            from azure.identity import DefaultAzureCredential, get_bearer_token_provider

            token_provider = get_bearer_token_provider(
                DefaultAzureCredential(exclude_interactive_browser_credential=True),
                "https://cognitiveservices.azure.com/.default",
            )
            client = AzureOpenAI(
                azure_endpoint=endpoint,
                api_version=api_version,
                azure_ad_token_provider=token_provider,
            )

        response = client.embeddings.create(model=deployment_name, input=texts)
        return [item.embedding for item in response.data]


__all__ = ["LLMClient", "HubLLMClient", "LLMHubEmbeddingClient", "DEFAULT_CHAT_MODEL", "DEFAULT_EMBEDDING_MODEL"]
