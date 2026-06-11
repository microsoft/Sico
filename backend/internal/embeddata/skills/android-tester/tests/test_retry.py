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

from itertools import count
from types import SimpleNamespace

import pytest

from android_tester import retry
from android_tester.retry import (
    call_http_with_retry,
    call_with_retry,
    call_with_retry_async,
)


class _FakeHttpError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"http {status_code}")
        self.response = SimpleNamespace(
            status_code=status_code, text=f"body {status_code}",
        )


# ---------------------------------------------------------------------------
# call_with_retry
# ---------------------------------------------------------------------------


def test_call_with_retry_returns_immediately_on_success():
    calls = count(1)
    result = call_with_retry(lambda: next(calls))

    assert result == 1


def test_call_with_retry_retries_until_success(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(retry.time, "sleep", sleeps.append)
    attempts = count(1)

    def attempt_fn() -> int:
        n = next(attempts)
        if n < 3:
            raise ValueError(f"boom {n}")
        return n

    result = call_with_retry(attempt_fn, base_delay=0.5)

    assert result == 3
    assert sleeps == [0.5, 1.0]  # exponential 2**(n-1)


def test_call_with_retry_reraises_after_max_retries(monkeypatch):
    monkeypatch.setattr(retry.time, "sleep", lambda _s: None)
    attempts = count(1)

    def always_fails() -> None:
        raise RuntimeError(f"fail {next(attempts)}")

    with pytest.raises(RuntimeError, match="fail 4"):
        call_with_retry(always_fails, max_retries=3)


def test_call_with_retry_does_not_catch_unrelated_exceptions():
    def raises_type_error() -> None:
        raise TypeError("not retryable here")

    with pytest.raises(TypeError):
        call_with_retry(raises_type_error, on=ValueError)


def test_call_with_retry_aborts_when_should_retry_returns_false(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(retry.time, "sleep", sleeps.append)
    attempts = count(1)

    def attempt_fn() -> None:
        raise ValueError(f"fatal {next(attempts)}")

    with pytest.raises(ValueError, match="fatal 1"):
        call_with_retry(attempt_fn, should_retry=lambda _exc: False)

    assert sleeps == []


# ---------------------------------------------------------------------------
# call_with_retry_async
# ---------------------------------------------------------------------------


async def test_call_with_retry_async_returns_immediately_on_success():
    async def attempt_fn() -> str:
        return "ok"

    assert await call_with_retry_async(attempt_fn) == "ok"


async def test_call_with_retry_async_retries_until_success(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(retry.asyncio, "sleep", fake_sleep)
    attempts = count(1)

    async def attempt_fn() -> int:
        n = next(attempts)
        if n < 3:
            raise ValueError(f"boom {n}")
        return n

    result = await call_with_retry_async(attempt_fn, base_delay=0.5)

    assert result == 3
    assert sleeps == [0.5, 1.0]


async def test_call_with_retry_async_reraises_after_max_retries(monkeypatch):
    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(retry.asyncio, "sleep", fake_sleep)

    async def always_fails() -> None:
        raise RuntimeError("nope")

    with pytest.raises(RuntimeError, match="nope"):
        await call_with_retry_async(always_fails, max_retries=2)


async def test_call_with_retry_async_filters_by_on_type():
    async def raises_type_error() -> None:
        raise TypeError("not retryable here")

    with pytest.raises(TypeError):
        await call_with_retry_async(raises_type_error, on=ValueError)


# ---------------------------------------------------------------------------
# call_http_with_retry
# ---------------------------------------------------------------------------


async def test_call_http_with_retry_passes_through_success():
    async def attempt_fn() -> str:
        return "ok"

    assert await call_http_with_retry(attempt_fn) == "ok"


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
async def test_call_http_with_retry_aborts_on_non_retryable_status(
    monkeypatch, status,
):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(retry.asyncio, "sleep", fake_sleep)
    attempts = count(1)

    async def attempt_fn() -> None:
        next(attempts)
        raise _FakeHttpError(status)

    with pytest.raises(_FakeHttpError):
        await call_http_with_retry(attempt_fn, max_retries=3)

    assert sleeps == []
    assert next(attempts) == 2  # exactly one attempt happened


@pytest.mark.parametrize("status", [429, 500, 502, 503])
async def test_call_http_with_retry_retries_on_retryable_status(
    monkeypatch, status,
):
    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(retry.asyncio, "sleep", fake_sleep)
    attempts = count(1)

    async def attempt_fn() -> int:
        n = next(attempts)
        if n < 3:
            raise _FakeHttpError(status)
        return n

    result = await call_http_with_retry(
        attempt_fn, max_retries=5, base_delay=0.0,
    )

    assert result == 3


async def test_call_http_with_retry_aborts_on_non_retryable_exc_type(
    monkeypatch,
):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(retry.asyncio, "sleep", fake_sleep)

    class FatalError(Exception):
        pass

    async def attempt_fn() -> None:
        raise FatalError("stop")

    with pytest.raises(FatalError):
        await call_http_with_retry(
            attempt_fn, max_retries=3, non_retryable=(FatalError,),
        )

    assert sleeps == []
