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

"""Environment-driven configuration readers for the task runtime.

All helpers read ``TASK_RUNTIME_*`` environment variables **on each call**, fall
back to documented defaults on missing / malformed input, and log at WARNING
when a configured value is unparseable so production misconfiguration is
surfaced rather than silently swallowed. Two parsing strategies back them:

* :func:`_resolve_clamped_env` clamps out-of-range values up to a ``floor``
  (timeouts / intervals / attempt counts).
* :func:`_resolve_positive_env` rejects non-positive values back to the default
  (concurrency ceilings).

=======================================  ========  =====  ========
Environment variable                     Default   Floor  Strategy
=======================================  ========  =====  ========
TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS  policy+30  1     clamp
TASK_RUNTIME_SANDBOX_RELEASE_ATTEMPTS    3         1      clamp
TASK_RUNTIME_STALE_RUN_AFTER_MS          180000    0      clamp
TASK_RUNTIME_RECONCILE_INTERVAL_SECONDS  30        1      clamp
TASK_RUNTIME_HEARTBEAT_INTERVAL_SECONDS  30        1      clamp
TASK_RUNTIME_REVERSE_RPC_TIMEOUT_SECONDS 20        1      clamp
TASK_RUNTIME_MAX_CONCURRENCY             scheduler 1      reject
TASK_RUNTIME_K8S_POD_CONCURRENCY         10        1      reject
TASK_RUNTIME_DOCKER_CONCURRENCY          10        1      reject
=======================================  ========  =====  ========

``clamp`` raises sub-floor values up to ``floor``; ``reject`` reverts any value
below 1 back to the default.
"""

from __future__ import annotations

import logging
import os

from .models import TaskRun
from .scheduler import DEFAULT_MAX_CONCURRENCY


_LOGGER = logging.getLogger(__name__)


def _reuse_wait_timeout_seconds(run: TaskRun) -> int:
    configured = os.getenv("TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS", "").strip()
    if configured:
        try:
            return max(1, int(configured))
        except ValueError:
            _LOGGER.warning("invalid TASK_RUNTIME_REUSE_WAIT_TIMEOUT_SECONDS=%r; using policy timeout", configured)
    return max(30, int(run.execution_policy.timeout_seconds) + 30)


def _resolve_clamped_env(var_name: str, default: int, *, floor: int) -> int:
    """Read an int ``TASK_RUNTIME_*`` env var, clamping the result up to ``floor``.

    Unset uses ``default``; malformed (non-integer) input logs at WARNING and
    falls back to ``default``. Parsed values below ``floor`` are clamped up to
    ``floor`` rather than rejected.
    """
    configured = os.getenv(var_name, str(default)).strip()
    try:
        return max(floor, int(configured))
    except ValueError:
        _LOGGER.warning("invalid %s=%r; using default %d", var_name, configured, default)
        return default


def _sandbox_release_attempts() -> int:
    return _resolve_clamped_env("TASK_RUNTIME_SANDBOX_RELEASE_ATTEMPTS", 3, floor=1)


def _stale_run_after_ms() -> int:
    return _resolve_clamped_env("TASK_RUNTIME_STALE_RUN_AFTER_MS", 180000, floor=0)


def _task_runtime_reconcile_interval_seconds() -> int:
    return _resolve_clamped_env("TASK_RUNTIME_RECONCILE_INTERVAL_SECONDS", 30, floor=1)


def _task_runtime_heartbeat_interval_seconds() -> int:
    return _resolve_clamped_env("TASK_RUNTIME_HEARTBEAT_INTERVAL_SECONDS", 30, floor=1)


def _task_runtime_reverse_rpc_timeout_seconds() -> int:
    """Default per-call gRPC deadline for every task-runtime reverse RPC.

    Reverse RPCs are short single-statement backend operations (claim, heartbeat,
    write_result, the batch-level liveness bump, ...). Without a deadline a call
    that stalls — a wedged connection, a backend hiccup — blocks its caller
    forever; in particular the batch-heartbeat beater ``await``s serially, so one
    parked ``heartbeat_batch`` silently freezes liveness for the whole batch and
    the sweeper reclaims healthy queued siblings as stale. The default sits well
    under the 180s stale window (``TASK_RUNTIME_STALE_RUN_AFTER_MS``) with room for
    the 30s beater to retry several times, yet is far above the millisecond
    latency of a healthy call, so it never aborts legitimate work.
    """
    return _resolve_clamped_env("TASK_RUNTIME_REVERSE_RPC_TIMEOUT_SECONDS", 20, floor=1)


def _resolve_max_concurrency() -> int:
    """Read ``TASK_RUNTIME_MAX_CONCURRENCY`` (default :data:`DEFAULT_MAX_CONCURRENCY`)."""
    return _resolve_positive_env("TASK_RUNTIME_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY)


# Default per-batch ceiling on *pod/container-backed* runs. The local backend
# runs host subprocesses and is bounded only by ``TASK_RUNTIME_MAX_CONCURRENCY``;
# the k8s and docker backends each spin up a sandbox per run, so they get their
# own (lower) cap that the scheduler enforces as a per-resource limit.
DEFAULT_BACKEND_POD_CONCURRENCY = 10


def _resolve_positive_env(var_name: str, default: int) -> int:
    """Read a positive-integer ``TASK_RUNTIME_*`` env var with a sane fallback.

    Falls back to ``default`` when unset, blank, non-numeric, or non-positive,
    logging at WARNING on malformed input so misconfiguration surfaces.
    """
    raw = os.getenv(var_name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        _LOGGER.warning("%s=%r is not an integer; falling back to %d", var_name, raw, default)
        return default
    if value < 1:
        _LOGGER.warning("%s=%d is not positive; falling back to %d", var_name, value, default)
        return default
    return value


def _resolve_k8s_pod_concurrency() -> int:
    """Read ``TASK_RUNTIME_K8S_POD_CONCURRENCY`` (default 10)."""
    return _resolve_positive_env("TASK_RUNTIME_K8S_POD_CONCURRENCY", DEFAULT_BACKEND_POD_CONCURRENCY)


def _resolve_docker_concurrency() -> int:
    """Read ``TASK_RUNTIME_DOCKER_CONCURRENCY`` (default 10)."""
    return _resolve_positive_env("TASK_RUNTIME_DOCKER_CONCURRENCY", DEFAULT_BACKEND_POD_CONCURRENCY)
