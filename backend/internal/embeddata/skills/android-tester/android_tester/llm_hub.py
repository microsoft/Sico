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

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

import httpx

from android_tester.image_store import Image
from android_tester.retry import call_http_with_retry
from android_tester.telemetry import measure_time

logger = logging.getLogger(__name__)

_LLM_URL_TEMPLATE = "{endpoint}/api/{app_name}/llm/runtime/generate"

class LLMHubError(Exception):
    """Base error for LLM Hub operations."""


class LLMHubAPIError(LLMHubError):
    """Raised when the LLM Hub returns a non-zero error code."""

    def __init__(self, code: int, msg: str) -> None:
        self.code = code
        self.api_msg = msg
        super().__init__(
            f"LLM Hub API error {code}: {msg}"
        )


class LLMResponseFormatError(LLMHubError):
    """Raised when the LLM Hub response is missing expected content."""


class LLMHubClient:
    def __init__(
        self,
        endpoint: str,
        model: str,
        app_name: str = "sico",
        headers: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
        max_retries: int = 3,
    ) -> None:
        self._endpoint = _LLM_URL_TEMPLATE.format(
            endpoint=endpoint.strip().rstrip("/"),
            app_name=app_name,
        )
        self._model = model
        self._headers = headers or {}
        client_kwargs: dict = {}
        if timeout_seconds is not None:
            client_kwargs["timeout"] = timeout_seconds
        self._client = httpx.AsyncClient(**client_kwargs)
        self._max_retries = max_retries

    async def aclose(self) -> None:
        await self._client.aclose()

    @measure_time("answer_duration")
    async def ask(
        self,
        prompt: str,
        *images: Image,
        history: list[tuple[str, Image, str]] | None = None,
    ) -> str:
        inputs: list[dict[str, Any]] = []
        await self._append_history(inputs, history)

        inputs.append(
            await self._build_message("user", prompt, *images),
        )
        body: dict[str, Any] = {
            "model": self._model,
            "inputs": inputs,
        }

        req_headers = {
            "Content-Type": "application/json",
            "accept": "application/json",
        }
        req_headers.update(self._headers)

        @measure_time("inference_duration")
        async def _attempt() -> dict:
            resp = await self._client.post(
                self._endpoint,
                headers=req_headers,
                json=body,
            )
            resp.raise_for_status()
            return resp.json()

        try:
            data = await call_http_with_retry(
                _attempt,
                max_retries=self._max_retries,
                label=f"LLMHub {self._model} -",
            )
        except LLMHubError:
            raise
        except Exception as e:
            raise LLMHubError(f"LLM request failed: {e}") from e

        self._check_error(data)
        return self._extract_text_from_answer(data)

    async def _build_message(
        self, role: str, prompt: str, *images: Image,
    ) -> dict[str, Any]:
        image_content = await asyncio.gather(
            *(self._build_image_content(img) for img in images),
        )
        return {
            "role": role,
            "content": [
                {"type": "text", "text": prompt},
                *image_content,
            ],
        }

    @staticmethod
    async def _build_image_content(image: Image) -> dict[str, Any]:
        b64 = base64.b64encode(await image.read()).decode("utf-8")
        return {
            "type": "image",
            "imageBase64": b64,
            "mediaType": image.mime,
        }

    async def _append_history(
        self,
        inputs: list[dict[str, Any]],
        history: list[tuple[str, Image, str]] | None,
    ) -> None:
        for h_prompt, h_image, h_response in (history or []):
            inputs.extend((
                await self._build_message("user", h_prompt, h_image),
                await self._build_message("assistant", h_response),
            ))

    @staticmethod
    def _check_error(data: dict) -> None:
        code = data.get("code", 0)
        if code != 0:
            raise LLMHubAPIError(
                code, data.get("msg", "")
            )

    @staticmethod
    def _extract_text_from_answer(data: dict) -> str:
        inner = data.get("data", data)  # fall back to body if "data" absent
        outputs = inner.get("outputs")
        if not outputs:
            raise LLMResponseFormatError(
                f"LLM Hub response missing 'outputs': {str(data)[:500]}"
            )
        text_parts: list[str] = []
        for part in outputs:
            if part.get("type") == "text":
                text = part.get("text", "")
                if text:
                    text_parts.append(text)
            else:
                logger.warning(
                    "Ignore unexpected output type %r in LLM Hub response",
                    part.get("type"),
                )
        if not text_parts:
            raise LLMResponseFormatError(
                f"LLM Hub response contained no text output: {str(data)[:500]}"
            )
        return "\n\n".join(text_parts)
