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

import logging
import os
import time
from collections.abc import Callable
from typing import Any

import requests
from azure.identity import DefaultAzureCredential

DEFAULT_ANALYZER_ID = "prebuilt-documentSearch"
DEFAULT_API_VERSION = "2025-11-01"
DEFAULT_USER_AGENT = "dwp-core/knowledge"
DEFAULT_POLL_TIMEOUT_SECONDS = 600
DEFAULT_POLL_INTERVAL_SECONDS = 2
DEFAULT_REQUEST_TIMEOUT_SECONDS = 10


class ContentUnderstandingClient:
    """Lightweight client for Azure AI Content Understanding REST API."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_version: str = DEFAULT_API_VERSION,
        subscription_key: str | None = None,
        token_provider: Callable[[], str] | None = None,
    ) -> None:
        if not subscription_key and not token_provider:
            raise ValueError("Either subscription_key or token_provider is required")

        self._endpoint = endpoint.rstrip("/")
        self._api_version = api_version
        self._subscription_key = subscription_key
        self._token_provider = token_provider
        self._user_agent = DEFAULT_USER_AGENT
        self._request_timeout = DEFAULT_REQUEST_TIMEOUT_SECONDS
        self._poll_timeout = DEFAULT_POLL_TIMEOUT_SECONDS
        self._poll_interval = DEFAULT_POLL_INTERVAL_SECONDS
        self._logger = logging.getLogger(__name__)

        self._logger.info(
            "ContentUnderstandingClient initialized endpoint=%s api_version=%s",
            self._endpoint,
            self._api_version,
        )

    def analyze_document_from_url(self, url: str, analyzer_id: str = DEFAULT_ANALYZER_ID) -> dict[str, Any]:
        """Invoke the prebuilt document analyzer against a URL (e.g., SAS URL)."""
        self._logger.info("Starting content understanding analyze analyzer_id=%s url=%s", analyzer_id, url)
        data = {"inputs": [{"url": url}]}
        response = requests.post(
            url=self._analyze_url(analyzer_id),
            headers=self._headers(content_type="application/json"),
            json=data,
            timeout=self._request_timeout,
        )
        self._logger.debug(
            "Analyze request sent analyzer_id=%s status=%s headers=%s", analyzer_id, response.status_code, response.headers
        )
        self._raise_for_status(response)
        return self._poll_result(response)

    @staticmethod
    def extract_document(result: dict[str, Any]) -> tuple[str, str]:
        contents = result.get("result", {}).get("contents", [])
        if not contents:
            return "", ""

        full_text = contents[0].get("markdown", "")
        summary = contents[0].get("fields", {}).get("Summary", {}).get("valueString", "")
        return full_text, summary

    def _poll_result(self, response: requests.Response) -> dict[str, Any]:
        operation_location = response.headers.get("operation-location", "")
        if not operation_location:
            raise RuntimeError("Missing operation-location header from content understanding response")

        deadline = time.time() + self._poll_timeout
        while True:
            poll_response = requests.get(
                url=operation_location,
                headers=self._headers(),
                timeout=self._request_timeout,
            )
            self._raise_for_status(poll_response)
            body = poll_response.json()
            status = (body.get("status") or "").lower()
            self._logger.debug("Poll status=%s operation=%s", status, operation_location)
            if status == "succeeded":
                self._logger.info("Content understanding analysis succeeded operation=%s", operation_location)
                return body
            if status == "failed":
                self._logger.error("Content understanding analysis failed operation=%s body=%s", operation_location, body)
                raise RuntimeError(f"Content understanding analysis failed: {body}")
            if time.time() > deadline:
                self._logger.error("Content understanding analysis timed out operation=%s", operation_location)
                raise TimeoutError("Timed out waiting for content understanding analysis result")
            time.sleep(self._poll_interval)

    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {"x-ms-useragent": self._user_agent}
        if content_type:
            headers["Content-Type"] = content_type
        if self._subscription_key:
            headers["Ocp-Apim-Subscription-Key"] = self._subscription_key
        elif self._token_provider:
            headers["Authorization"] = f"Bearer {self._token_provider()}"
        return headers

    def _analyze_url(self, analyzer_id: str) -> str:
        return f"{self._endpoint}/contentunderstanding/analyzers/{analyzer_id}:analyze?api-version={self._api_version}"

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        if response.ok:
            return
        detail = ""
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        logging.getLogger(__name__).error(
            "Content understanding HTTP error status=%s url=%s detail=%s", response.status_code, response.url, detail
        )
        response.raise_for_status()

def build_content_understanding_client(logger: logging.Logger) -> ContentUnderstandingClient | None:
    endpoint = os.getenv("AZURE_CONTENT_UNDERSTANDING_ENDPOINT", "").strip()
    if not endpoint:
        logger.info("Content understanding endpoint not configured; extraction disabled")
        return None

    api_version = os.getenv("AZURE_CONTENT_UNDERSTANDING_API_VERSION", DEFAULT_API_VERSION)

    token_provider: Callable[[], str] | None = None
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)

    def _token_provider() -> str:
        token = credential.get_token("https://cognitiveservices.azure.com/.default")
        return token.token

    token_provider = _token_provider

    try:
        return ContentUnderstandingClient(
            endpoint=endpoint,
            api_version=api_version,
            token_provider=token_provider,
        )
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.error("Failed to initialize content understanding client: %s", exc)
        return None
