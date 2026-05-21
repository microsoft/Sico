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

RETRY_BASE_DELAY = 5.0
BACKOFF_MULTIPLIER = 5
_MAX_DETAIL_LEN = 200

T = TypeVar("T")


def is_retryable_status(status_code: int) -> bool:
    if status_code in _NON_RETRYABLE_STATUS_CODES:
        return False
    if status_code == 429:
        return True
    if 500 <= status_code < 600:
        return True
    return False


def try_extract_status_code(exc: Exception) -> int | None:
    resp = getattr(exc, "response", None)
    if resp is not None:
        code = getattr(resp, "status_code", None)
        if code is not None:
            return int(code)
    return None


async def call_with_retry(
    attempt_fn: Callable[[], Awaitable[T]],
    *,
    max_retries: int = 3,
    base_delay: float = RETRY_BASE_DELAY,
    label: str = "",
    non_retryable: tuple[type[BaseException], ...] = (),
) -> T:
    """Async retry loop with multiplicative backoff.

    ``attempt_fn`` is an async callable that returns a result on success.
    Exceptions whose HTTP status is non-retryable abort immediately, as
    do exceptions whose type appears in ``non_retryable``. All other
    exceptions are retried up to ``max_retries`` times.
    """
    max_attempts = max_retries + 1

    for attempt in count(1):
        started = time.perf_counter()
        try:
            return await attempt_fn()
        except Exception as exc:
            latency_ms = (time.perf_counter() - started) * 1000
            status_code = try_extract_status_code(exc)

            if status_code and not is_retryable_status(status_code):
                logger.error("%s Non-retryable (%d): %s",
                             label,
                             status_code,
                             str(exc)[:_MAX_DETAIL_LEN],
                             )
                raise
            if non_retryable and isinstance(exc, non_retryable):
                logger.error("%s Non-retryable (%s): %s",
                             label,
                             type(exc).__name__,
                             str(exc)[:_MAX_DETAIL_LEN],
                             )
                raise

            detail = f"{type(exc).__name__}: {str(exc)[:_MAX_DETAIL_LEN]}"
            resp = getattr(exc, "response", None)
            resp_text = getattr(resp, "text", None)
            if resp_text:
                detail += f" | {resp_text[:_MAX_DETAIL_LEN]}"

            logger.error("%s Attempt %d/%d (%.0fms) - %s",
                         label,
                         attempt,
                         max_attempts,
                         latency_ms,
                         detail,
                         exc_info=(attempt == max_attempts),
                         )

            if attempt == max_attempts:
                raise

            await asyncio.sleep(base_delay * attempt)

    # Unreachable: the loop always exits via return or raise.
    raise RuntimeError(f"{label} FAILED after {max_attempts} attempts")
