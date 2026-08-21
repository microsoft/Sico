"""Logical scheduler buckets and physical command-backend admission.

The batch scheduler uses :func:`run_resource_key` only for sandbox fleets: a
scheduled run that needs Android or Windows holds one already-leased machine.
Docker containers and Kubernetes runner pods are different. They are created
inside ``CommandBackend`` and may be reached by direct or nested capability
calls, so their process-wide admission gate is acquired at that physical
boundary rather than by a logical parent ``TaskRun``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from ..capabilities.ids import SKILL_PROVIDER_ID, builtin_tool_of, provider_of
from ..capabilities.tool_catalog import RUN_COMMAND_TOOL_NAME
from ..config import _resolve_docker_concurrency, _resolve_k8s_pod_concurrency
from ..domain.models import TaskRun, TaskSpec

_LOGGER = logging.getLogger(__name__)


def spec_uses_command_backend(spec: TaskSpec) -> bool:
    """Whether a task's capability is expected to lower to a command."""
    capability_id = spec.capability_id
    if provider_of(capability_id) == SKILL_PROVIDER_ID:
        return True
    return builtin_tool_of(capability_id) == RUN_COMMAND_TOOL_NAME


def run_resource_key(run: TaskRun) -> str | None:
    """The already-leased sandbox fleet a scheduled run occupies, if any."""
    return run.spec.selected_sandbox


def backend_resource_limit(key: str | None) -> int:
    """Concurrency ceiling configured for a command-backend bucket (0 = unbounded)."""
    from .command.selection import RESOURCE_KEY_DOCKER, RESOURCE_KEY_K8S_POD

    if key == RESOURCE_KEY_K8S_POD:
        return _resolve_k8s_pod_concurrency()
    if key == RESOURCE_KEY_DOCKER:
        return _resolve_docker_concurrency()
    return 0


class ResourceLease:
    """One idempotently releasable permit from a :class:`ResourceGate`."""

    def __init__(self, semaphore: asyncio.Semaphore | None = None) -> None:
        self._semaphore = semaphore

    def release(self) -> None:
        semaphore, self._semaphore = self._semaphore, None
        if semaphore is not None:
            semaphore.release()


class ResourceGate:
    """Process-wide keyed concurrency gate.

    A bucket's ceiling is fixed by the first caller that gates on it, since
    resizing a semaphore under in-flight holders cannot be done safely. The gate
    is intentionally *advisory*: an unknown or non-positive limit yields
    immediately rather than blocking work that has no configured ceiling.
    """

    def __init__(self) -> None:
        self._buckets: dict[str, tuple[asyncio.Semaphore, int]] = {}

    async def acquire(self, key: str | None, limit: int) -> ResourceLease:
        """Acquire one permit, returning an idempotently releasable lease."""
        if not key or limit <= 0:
            return ResourceLease()
        semaphore = self._semaphore(key, limit)
        await semaphore.acquire()
        return ResourceLease(semaphore)

    @contextlib.asynccontextmanager
    async def hold(self, key: str | None, limit: int) -> AsyncIterator[None]:
        """Hold one slot of ``key`` for the duration of the block."""
        lease = await self.acquire(key, limit)
        try:
            yield
        finally:
            lease.release()

    def _semaphore(self, key: str, limit: int) -> asyncio.Semaphore:
        existing = self._buckets.get(key)
        if existing is None:
            semaphore = asyncio.Semaphore(limit)
            self._buckets[key] = (semaphore, limit)
            return semaphore
        semaphore, pinned = existing
        if pinned != limit:
            # Explains an otherwise baffling operator experience: raising the
            # configured ceiling mid-process changes nothing until restart.
            _LOGGER.debug("task_runtime.resource_gate keeps pinned limit %d for %s (requested %d)", pinned, key, limit)
        return semaphore


_DEFAULT_GATE = ResourceGate()


def default_resource_gate() -> ResourceGate:
    """The process-wide gate nested capability calls draw from."""
    return _DEFAULT_GATE
