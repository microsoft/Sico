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

from types import SimpleNamespace

from app.biz.task_runtime.config import (
    DEFAULT_BACKEND_POD_CONCURRENCY,
    _resolve_clamped_env,
    _resolve_positive_env,
    _reuse_wait_timeout_seconds,
    _sandbox_release_attempts,
    _stale_run_after_ms,
    _task_runtime_heartbeat_interval_seconds,
    _task_runtime_reconcile_interval_seconds,
)


def _run_with_timeout(timeout_seconds: int) -> SimpleNamespace:
    return SimpleNamespace(execution_policy=SimpleNamespace(timeout_seconds=timeout_seconds))


# ---------------------------------------------------------------------------
# _resolve_clamped_env
# ---------------------------------------------------------------------------


def test_clamped_env_uses_default_when_unset(monkeypatch) -> None:
    monkeypatch.delenv("TASK_RUNTIME_X", raising=False)

    assert _resolve_clamped_env("TASK_RUNTIME_X", 30, floor=1) == 30


def test_clamped_env_reads_valid_value(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_X", "45")

    assert _resolve_clamped_env("TASK_RUNTIME_X", 30, floor=1) == 45


def test_clamped_env_clamps_up_to_floor(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_X", "0")

    assert _resolve_clamped_env("TASK_RUNTIME_X", 30, floor=1) == 1


def test_clamped_env_falls_back_on_malformed(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_X", "not-a-number")

    assert _resolve_clamped_env("TASK_RUNTIME_X", 30, floor=1) == 30


# ---------------------------------------------------------------------------
# _resolve_positive_env
# ---------------------------------------------------------------------------


def test_positive_env_uses_default_when_blank(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_Y", "   ")

    assert _resolve_positive_env("TASK_RUNTIME_Y", 10) == 10


def test_positive_env_reads_valid_value(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_Y", "7")

    assert _resolve_positive_env("TASK_RUNTIME_Y", 10) == 7


def test_positive_env_rejects_non_positive(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_Y", "0")

    assert _resolve_positive_env("TASK_RUNTIME_Y", 10) == 10


def test_positive_env_rejects_malformed(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_Y", "abc")

    assert _resolve_positive_env("TASK_RUNTIME_Y", 10) == 10


# ---------------------------------------------------------------------------
# _reuse_wait_timeout_seconds
# ---------------------------------------------------------------------------


def test_reuse_wait_prefers_env_override(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS", "300")

    assert _reuse_wait_timeout_seconds(_run_with_timeout(600)) == 300


def test_reuse_wait_clamps_env_override_to_one(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS", "0")

    assert _reuse_wait_timeout_seconds(_run_with_timeout(600)) == 1


def test_reuse_wait_falls_back_to_policy_plus_30(monkeypatch) -> None:
    monkeypatch.delenv("TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS", raising=False)

    assert _reuse_wait_timeout_seconds(_run_with_timeout(600)) == 630


def test_reuse_wait_fallback_has_floor_of_30(monkeypatch) -> None:
    monkeypatch.delenv("TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS", raising=False)

    # policy + 30 = 10, but the floor keeps it at 30.
    assert _reuse_wait_timeout_seconds(_run_with_timeout(-20)) == 30


def test_reuse_wait_ignores_malformed_env(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS", "oops")

    assert _reuse_wait_timeout_seconds(_run_with_timeout(600)) == 630


# ---------------------------------------------------------------------------
# Concrete readers wire the right defaults / floors.
# ---------------------------------------------------------------------------


def test_sandbox_release_attempts_default(monkeypatch) -> None:
    monkeypatch.delenv("TASK_RUNTIME_SANDBOX_RELEASE_ATTEMPTS", raising=False)

    assert _sandbox_release_attempts() == 3


def test_stale_run_after_ms_allows_zero_floor(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_STALE_RUN_AFTER_MS", "0")

    assert _stale_run_after_ms() == 0


def test_reconcile_interval_default(monkeypatch) -> None:
    monkeypatch.delenv("TASK_RUNTIME_RECONCILE_INTERVAL_SECONDS", raising=False)

    assert _task_runtime_reconcile_interval_seconds() == 30


def test_heartbeat_interval_clamps_to_floor(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_HEARTBEAT_INTERVAL_SECONDS", "0")

    assert _task_runtime_heartbeat_interval_seconds() == 1


def test_default_backend_pod_concurrency_constant() -> None:
    assert DEFAULT_BACKEND_POD_CONCURRENCY == 10
