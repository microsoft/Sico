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

"""Core rewrite pipeline: parse CSV → build prompts → call LLM Hub → save output.

Includes the LLM Hub client, retry logic, and CSV parser — all in one module
to keep the skill compact.
"""

from __future__ import annotations

import asyncio
import base64
import csv
import logging
import mimetypes
import re
import time
from collections.abc import Awaitable, Callable
from itertools import count
from pathlib import Path
from typing import Any, TypeVar

import httpx

from rewrite_from_doc.output_formatter import save_csv, save_jsonl

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
#  Retry
# ---------------------------------------------------------------------------

_NON_RETRYABLE_STATUS_CODES = {
    400, 401, 403, 404, 405, 406, 410, 413, 422,
}
_RETRY_BASE_DELAY = 5.0
_BACKOFF_MULTIPLIER = 5
_MAX_DETAIL_LEN = 200

T = TypeVar("T")


def _is_retryable_status(status_code: int) -> bool:
    if status_code in _NON_RETRYABLE_STATUS_CODES:
        return False
    return status_code == 429 or 500 <= status_code < 600


def _try_extract_status_code(exc: Exception) -> int | None:
    resp = getattr(exc, "response", None)
    if resp is not None:
        code = getattr(resp, "status_code", None)
        if code is not None:
            return int(code)
    return None


async def _call_with_retry(
    attempt_fn: Callable[[], Awaitable[T]],
    *,
    max_retries: int = 3,
    base_delay: float = _RETRY_BASE_DELAY,
    label: str = "",
) -> T:
    """Async retry loop with multiplicative backoff."""
    max_attempts = max_retries + 1

    for attempt in count(1):
        started = time.perf_counter()
        try:
            return await attempt_fn()
        except Exception as exc:
            latency_ms = (time.perf_counter() - started) * 1000
            status_code = _try_extract_status_code(exc)

            if status_code and not _is_retryable_status(status_code):
                logger.error(
                    "%s Non-retryable (%d): %s",
                    label, status_code,
                    str(exc)[:_MAX_DETAIL_LEN],
                )
                raise

            detail = f"{type(exc).__name__}: {str(exc)[:_MAX_DETAIL_LEN]}"

            if attempt >= max_attempts:
                logger.error(
                    "%s All %d attempts exhausted (%.0fms) - %s",
                    label, max_attempts, latency_ms, detail,
                )
                raise

            delay = base_delay * (_BACKOFF_MULTIPLIER ** (attempt - 1))
            logger.warning(
                "%s Attempt %d/%d (%.0fms) - %s | retrying in %.1fs",
                label, attempt, max_attempts,
                latency_ms, detail, delay,
            )
            await asyncio.sleep(delay)

    raise RuntimeError("unreachable")  # pragma: no cover


# ---------------------------------------------------------------------------
#  CSV parser
# ---------------------------------------------------------------------------

_COLUMN_MAP = {
    "Title": "title",
    "Description": "description",
    "Platform": "platform",
    "Project Name": "project_name",
    "Steps": "steps",
}


def _parse_csv(
    file_path: str | Path,
    encoding: str = "utf-8",
    max_rows: int = 0,
) -> list[dict[str, str]]:
    """Parse a test-case CSV and return a list of dicts.

    Each dict has keys: title, description, platform, project_name,
    steps (raw text), and steps_list (split lines).
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")

    if encoding.lower().replace("-", "") == "utf8":
        encoding = "utf-8-sig"

    testcases: list[dict[str, str]] = []
    delimiter = "\t" if path.suffix.lower() == ".tsv" else ","

    with open(path, "r", encoding=encoding, newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        for i, row in enumerate(reader):
            if 0 < max_rows <= i:
                break
            tc: dict[str, str] = {}
            for csv_col, key in _COLUMN_MAP.items():
                tc[key] = (row.get(csv_col) or "").strip()
            tc["steps_list"] = [
                s.strip()
                for s in tc["steps"].splitlines()
                if s.strip()
            ]
            testcases.append(tc)

    logger.info("Parsed %d test cases from %s", len(testcases), path.name)
    return testcases


# ---------------------------------------------------------------------------
#  LLM Hub client
# ---------------------------------------------------------------------------

_LLM_URL_TEMPLATE = "{endpoint}/api/{app_name}/llm/runtime/generate"


class LLMHubError(Exception):
    """Base error for LLM Hub operations."""


class _LLMHubAPIError(LLMHubError):
    def __init__(self, code: int, msg: str) -> None:
        self.code = code
        self.api_msg = msg
        super().__init__(f"LLM Hub API error {code}: {msg}")


class _LLMResponseFormatError(LLMHubError):
    pass


class _LLMHubClient:
    """Async client for the Sico LLM Hub runtime/generate API."""

    _REMOTE_URL_RE = re.compile(r"^(?!file)\w+://")

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

    async def ask(
        self,
        prompt: str,
        images: list[str | Path] | None = None,
    ) -> str:
        """Send a prompt (with optional images) and return the text response."""
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        if images:
            for img in images:
                content.append(self._build_image_content(img))

        body: dict[str, Any] = {
            "model": self._model,
            "inputs": [{"role": "user", "content": content}],
        }
        req_headers = {
            "Content-Type": "application/json",
            "accept": "application/json",
        }
        req_headers.update(self._headers)

        async def _attempt() -> dict:
            resp = await self._client.post(
                self._endpoint, headers=req_headers, json=body,
            )
            resp.raise_for_status()
            return resp.json()

        try:
            data = await _call_with_retry(
                _attempt,
                max_retries=self._max_retries,
                label=f"LLMHub {self._model} -",
            )
        except LLMHubError:
            raise
        except Exception as e:
            raise LLMHubError(f"LLM request failed: {e}") from e

        self._check_error(data)
        return self._extract_text(data)

    @classmethod
    def _build_image_content(cls, image: str | Path) -> dict[str, Any]:
        ref = str(image)
        if cls._REMOTE_URL_RE.match(ref):
            return {"type": "image", "imageUrl": ref}
        path = Path(ref)
        raw = path.read_bytes()
        b64 = base64.b64encode(raw).decode("utf-8")
        mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        return {"type": "image", "imageBase64": b64, "mediaType": mime}

    @staticmethod
    def _check_error(data: dict) -> None:
        code = data.get("code", 0)
        if code != 0:
            raise _LLMHubAPIError(code, data.get("msg", ""))

    @staticmethod
    def _extract_text(data: dict) -> str:
        inner = data.get("data", data)
        outputs = inner.get("outputs")
        if not outputs:
            raise _LLMResponseFormatError(
                f"LLM Hub response missing 'outputs': {str(data)[:500]}"
            )
        text_parts: list[str] = []
        for part in outputs:
            if part.get("type") == "text":
                text = part.get("text", "")
                if text:
                    text_parts.append(text)
        if not text_parts:
            raise _LLMResponseFormatError(
                f"LLM Hub response contained no text output: {str(data)[:500]}"
            )
        return "\n\n".join(text_parts)


# ---------------------------------------------------------------------------
#  Prompt helpers
# ---------------------------------------------------------------------------


def _format_testcase(tc: dict[str, str]) -> str:
    lines = [
        f"Title: {tc.get('title', '')}",
        f"Description: {tc.get('description', '')}",
        f"Platform: {tc.get('platform', '')}",
        f"Project: {tc.get('project_name', '')}",
        "Steps:",
    ]
    for i, step in enumerate(tc.get("steps_list", []), 1):
        lines.append(f"  {i}. {step}")
    return "\n".join(lines)


def _build_prompt(
    template: str,
    tc: dict[str, str],
    feature_doc: str,
    action_space: str,
) -> str:
    text = template.replace("{feature_doc}", feature_doc)
    text = text.replace("{action_space}", action_space)
    text = text.replace("{testcase}", _format_testcase(tc))
    return text


# ---------------------------------------------------------------------------
#  TestCaseRewriter
# ---------------------------------------------------------------------------


class TestCaseRewriter:
    """Rewrite test cases using the Sico LLM Hub."""

    def __init__(
        self,
        *,
        sico_endpoint: str,
        model: str,
        input_csv: str | Path,
        prompt_template_path: str | Path,
        feature_doc_path: str | Path,
        action_space_path: str | Path,
        output_dir: str | Path,
        start_image_path: str | Path | None = None,
        encoding: str = "utf-8",
        max_rows: int = 0,
        max_workers: int = 3,
        batch_size: int = 20,
        sleep_between_batches: float = 3.0,
        output_format: str = "csv",
        sico_headers: dict[str, str] | None = None,
        timeout_seconds: int = 300,
        max_retry_rounds: int = 3,
        app_name: str = "sico",
    ) -> None:
        self._sico_endpoint = sico_endpoint
        self._model = model
        self._app_name = app_name
        self._input_csv = Path(input_csv)
        self._prompt_template_path = Path(prompt_template_path)
        self._feature_doc_path = Path(feature_doc_path)
        self._action_space_path = Path(action_space_path)
        self._output_dir = Path(output_dir)
        self._start_image_path = (
            Path(start_image_path) if start_image_path else None
        )
        self._encoding = encoding
        self._max_rows = max_rows
        self._max_workers = max_workers
        self._batch_size = batch_size
        self._sleep_between_batches = sleep_between_batches
        self._output_format = output_format
        self._sico_headers = sico_headers or {}
        self._timeout_seconds = timeout_seconds
        self._max_retry_rounds = max_retry_rounds

    async def run_async(self) -> Path:
        """Execute the full rewrite pipeline. Returns output path."""
        # 1. Parse test cases
        testcases = _parse_csv(
            self._input_csv,
            encoding=self._encoding,
            max_rows=self._max_rows,
        )
        if not testcases:
            logger.warning("No test cases found. Exiting.")
            return self._output_dir

        # 2. Load context files
        template = self._prompt_template_path.read_text(encoding="utf-8")
        feature_doc = self._feature_doc_path.read_text(encoding="utf-8")
        action_space = self._action_space_path.read_text(encoding="utf-8")
        logger.info(
            "Loaded template (%d chars), feature doc (%d chars), "
            "action space (%d chars)",
            len(template), len(feature_doc), len(action_space),
        )

        # 2b. Log run metadata for reproducibility
        import hashlib

        def _sha256(text: str) -> str:
            return hashlib.sha256(text.encode()).hexdigest()[:16]

        logger.info(
            "Run config: model=%s, input=%s (sha=%s), "
            "prompt_template (sha=%s), feature_doc (sha=%s), "
            "max_rows=%d, max_retries=%d",
            self._model,
            self._input_csv.name,
            _sha256(self._input_csv.read_text(encoding=self._encoding)),
            _sha256(template),
            _sha256(feature_doc),
            self._max_rows,
            self._max_retry_rounds,
        )

        # 3. Optional start image
        image_path: Path | None = None
        if self._start_image_path and self._start_image_path.exists():
            image_path = self._start_image_path

        # 4. Call LLM Hub in batches (with automatic retry)
        llm = _LLMHubClient(
            endpoint=self._sico_endpoint,
            model=self._model,
            app_name=self._app_name,
            headers=self._sico_headers,
            timeout_seconds=self._timeout_seconds,
        )
        try:
            results = await self._batch_call(
                llm, testcases, template,
                feature_doc, action_space, image_path,
            )
            # Retry failed rows up to max_retry_rounds
            for retry_round in range(1, self._max_retry_rounds + 1):
                failed = [
                    i for i, r in enumerate(results)
                    if r == "0" or r == ""
                ]
                if not failed:
                    break
                logger.info(
                    "Retry round %d/%d: %d failed cases",
                    retry_round, self._max_retry_rounds,
                    len(failed),
                )
                retry_results = await self._batch_call(
                    llm,
                    [testcases[i] for i in failed],
                    template, feature_doc,
                    action_space, image_path,
                )
                for j, idx in enumerate(failed):
                    if retry_results[j] not in ("0", ""):
                        results[idx] = retry_results[j]
            final_failed = sum(
                1 for r in results if r == "0" or r == ""
            )
            if final_failed:
                logger.warning(
                    "%d cases still failed after %d retry rounds",
                    final_failed, self._max_retry_rounds,
                )
        finally:
            await llm.aclose()

        logger.info("Received %d responses", len(results))

        # 5. Save output
        jsonl_path = save_jsonl(
            self._output_dir, testcases, results,
        )
        if self._output_format == "csv":
            out = save_csv(
                self._output_dir, self._input_csv,
                testcases, results,
                encoding=self._encoding,
            )
        else:
            out = jsonl_path

        return out

    async def _batch_call(
        self,
        llm: _LLMHubClient,
        testcases: list[dict],
        template: str,
        feature_doc: str,
        action_space: str,
        image_path: Path | None,
    ) -> list[str]:
        """Call LLM in batches with concurrency control."""
        results: list[str] = [""] * len(testcases)
        sem = asyncio.Semaphore(self._max_workers)

        async def _call_one(idx: int) -> None:
            tc = testcases[idx]
            prompt = _build_prompt(template, tc, feature_doc, action_space)
            images: list[str | Path] = []
            if image_path:
                images.append(image_path)

            async with sem:
                try:
                    resp = await llm.ask(prompt, images or None)
                    results[idx] = resp
                except LLMHubError as e:
                    logger.error("LLM call failed for case %d: %s", idx, e)
                    results[idx] = "0"
                except Exception as e:
                    logger.error("Unexpected error for case %d: %s", idx, e)
                    results[idx] = "0"

        total = len(testcases)
        for batch_start in range(0, total, self._batch_size):
            batch_end = min(batch_start + self._batch_size, total)
            batch_num = batch_start // self._batch_size + 1
            logger.info(
                "Batch %d: cases %d-%d of %d",
                batch_num, batch_start + 1, batch_end, total,
            )
            tasks = [
                asyncio.create_task(_call_one(i))
                for i in range(batch_start, batch_end)
            ]
            await asyncio.gather(*tasks)
            if batch_end < total:
                await asyncio.sleep(self._sleep_between_batches)

        return results

    def run(self) -> Path:
        """Synchronous wrapper for run_async."""
        return asyncio.run(self.run_async())
