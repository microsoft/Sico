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
import logging
import time
from collections.abc import Awaitable, Callable
from itertools import count
from typing import TypeVar

logger = logging.getLogger(__name__)

_NON_RETRYABLE_STATUS_CODES = {400, 401, 403, 404, 405, 406, 410, 413, 422}

RETRY_BASE_DELAY = 1.0
_MAX_DETAIL_LEN = 200

T = TypeVar("T")


def call_with_retry(
    attempt_fn: Callable[[], T],
    *,
    on: type[BaseException] | tuple[type[BaseException], ...] = Exception,
    should_retry: Callable[[BaseException], bool] | None = None,
    max_retries: int = 3,
    base_delay: float = RETRY_BASE_DELAY,
    label: str = "",
) -> T:
    """Synchronous retry loop with exponential backoff.

    Calls ``attempt_fn()`` and returns its result. Only exceptions
    matching ``on`` are caught; all others propagate. For caught
    exceptions, ``should_retry(exc)`` (when provided) decides whether
    to retry — returning False aborts immediately. Otherwise retried
    up to ``max_retries`` times with delay ``base_delay * 2**(n-1)``.
    Per-attempt errors are logged when ``label`` is non-empty.
    """
    max_attempts = max_retries + 1
    for attempt in count(1):
        started = time.perf_counter()
        try:
            return attempt_fn()
        except on as exc:
            delay = _handle_failure(
                exc,
                should_retry=should_retry, label=label,
                attempt=attempt, max_attempts=max_attempts,
                started=started, base_delay=base_delay,
            )
            if delay is None:
                raise
            time.sleep(delay)

    raise RuntimeError(f"{label} FAILED after {max_attempts} attempts")


def _handle_failure(
    exc: BaseException,
    *,
    should_retry: Callable[[BaseException], bool] | None,
    label: str,
    attempt: int,
    max_attempts: int,
    started: float,
    base_delay: float,
) -> float | None:
    """Decide what to do after a caught exception.

    Returns the seconds to sleep before retrying, or ``None`` to signal
    the caller to re-raise (predicate said no, or attempts exhausted).
    Per-attempt errors are logged when ``label`` is non-empty.
    """
    if should_retry is not None and not should_retry(exc):
        if label:
            logger.error("%s Non-retryable (%s): %s",
                         label,
                         type(exc).__name__,
                         str(exc)[:_MAX_DETAIL_LEN],
                         )
        return None

    if label:
        latency_ms = (time.perf_counter() - started) * 1000
        logger.error("%s",
                     _format_failure(
                         exc,
                         label=label,
                         attempt=attempt,
                         max_attempts=max_attempts,
                         latency_ms=latency_ms,
                     ),
                     exc_info=(attempt == max_attempts),
                     )

    if attempt == max_attempts:
        return None

    return _backoff(base_delay, attempt)


def _format_failure(
    exc: BaseException, *, label: str, attempt: int, max_attempts: int,
    latency_ms: float,
) -> str:
    detail = f"{type(exc).__name__}: {str(exc)[:_MAX_DETAIL_LEN]}"
    resp = getattr(exc, "response", None)
    resp_text = getattr(resp, "text", None)
    if resp_text:
        detail += f" | {resp_text[:_MAX_DETAIL_LEN]}"
    return (
        f"{label} Attempt {attempt}/{max_attempts} "
        f"({latency_ms:.0f}ms) - {detail}"
    )


def _backoff(base_delay: float, attempt: int) -> float:
    """Exponential backoff: base * 2**(attempt-1)."""
    return base_delay * (2 ** (attempt - 1))


async def call_with_retry_async(
    attempt_fn: Callable[[], Awaitable[T]],
    *,
    on: type[BaseException] | tuple[type[BaseException], ...] = Exception,
    should_retry: Callable[[BaseException], bool] | None = None,
    max_retries: int = 3,
    base_delay: float = RETRY_BASE_DELAY,
    label: str = "",
) -> T:
    """Async sibling of :func:`call_with_retry`.

    Identical semantics, signature, and defaults — except ``attempt_fn``
    is awaited and the inter-attempt sleep yields to the event loop.
    """
    max_attempts = max_retries + 1
    for attempt in count(1):
        started = time.perf_counter()
        try:
            return await attempt_fn()
        except on as exc:
            delay = _handle_failure(
                exc,
                should_retry=should_retry, label=label,
                attempt=attempt, max_attempts=max_attempts,
                started=started, base_delay=base_delay,
            )
            if delay is None:
                raise
            await asyncio.sleep(delay)

    raise RuntimeError(f"{label} FAILED after {max_attempts} attempts")


async def call_http_with_retry(
    attempt_fn: Callable[[], Awaitable[T]],
    *,
    max_retries: int = 3,
    base_delay: float = 5.0,
    label: str = "",
    non_retryable: tuple[type[BaseException], ...] = (),
) -> T:
    """HTTP-aware async retry loop.

    Wraps :func:`call_with_retry_async` with a predicate that aborts
    immediately on non-retryable HTTP status codes (4xx except 429) and
    on exception types listed in ``non_retryable``.
    """
    def _should_retry(exc: BaseException) -> bool:
        status_code = _try_extract_status_code(exc)
        if status_code is not None and not _is_retryable_status(status_code):
            return False
        if non_retryable and isinstance(exc, non_retryable):
            return False
        return True

    return await call_with_retry_async(
        attempt_fn,
        should_retry=_should_retry,
        max_retries=max_retries,
        base_delay=base_delay,
        label=label,
    )


def _try_extract_status_code(exc: BaseException) -> int | None:
    resp = getattr(exc, "response", None)
    if resp is not None:
        code = getattr(resp, "status_code", None)
        if code is not None:
            return int(code)
    return None


def _is_retryable_status(status_code: int) -> bool:
    if status_code in _NON_RETRYABLE_STATUS_CODES:
        return False
    if status_code == 429:
        return True
    if 500 <= status_code < 600:
        return True
    return False
