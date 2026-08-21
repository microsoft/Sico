"""Process-wide physical admission decorator for command backends."""

from __future__ import annotations

import asyncio

from ..resources import ResourceGate, ResourceLease, backend_resource_limit, default_resource_gate
from .contracts import CommandBackend, CommandResult, CommandSession, CommandSpec
from .selection import backend_resource_key


class LimitedCommandBackend:
    def __init__(self, backend: CommandBackend, *, key: str, limit: int, gate: ResourceGate) -> None:
        self._backend = backend
        self._key = key
        self._limit = limit
        self._gate = gate

    async def run(self, spec: CommandSpec) -> CommandResult:
        async with self._gate.hold(self._key, self._limit):
            return await self._backend.run(spec)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return _LimitedCommandSession(
            self._backend.open_session(pod_name=pod_name, image=image),
            key=self._key,
            limit=self._limit,
            gate=self._gate,
        )


class _LimitedCommandSession:
    def __init__(self, session: CommandSession, *, key: str, limit: int, gate: ResourceGate) -> None:
        self._session = session
        self._key = key
        self._limit = limit
        self._gate = gate
        self._lease: ResourceLease | None = None
        self._lock = asyncio.Lock()
        self._close_lock = asyncio.Lock()
        self._closed = False

    async def run(self, spec: CommandSpec) -> CommandResult:
        async with self._lock:
            if self._closed:
                raise RuntimeError("command session is closed")
            if self._lease is None:
                self._lease = await self._gate.acquire(self._key, self._limit)
        return await self._session.run(spec)

    async def aclose(self) -> None:
        async with self._close_lock:
            if self._closed:
                return
            self._closed = True
            try:
                await self._session.aclose()
            finally:
                lease, self._lease = self._lease, None
                if lease is not None:
                    lease.release()


def limit_backend(
    backend: CommandBackend,
    *,
    gate: ResourceGate | None = None,
    key: str | None = None,
    limit: int | None = None,
) -> CommandBackend:
    resource_key = key if key is not None else backend_resource_key()
    resource_limit = limit if limit is not None else backend_resource_limit(resource_key)
    if not resource_key or resource_limit <= 0:
        return backend
    return LimitedCommandBackend(
        backend,
        key=resource_key,
        limit=resource_limit,
        gate=gate or default_resource_gate(),
    )
