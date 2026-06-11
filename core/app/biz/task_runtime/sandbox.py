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
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal, Protocol

from .models import ReservationToken, SandboxLeaseRef, SandboxRequirement
from .sandbox_types import (
    eligible_types_for_os,
    lease_type_from_sandbox_id,
)
from .time_utils import now_ms as _now_ms

if TYPE_CHECKING:
    from app.biz.reverse_grpc.sandbox import ReverseSandboxService


_LOGGER = logging.getLogger(__name__)


# Sandboxes this instance can start a task on right now. The instance snapshot
# is lease-scoped (see backend ``GetInstanceSandboxesWithStatus``): a held but
# idle lease reports ``assigned`` and a busy one ``in_use``. A pool resource
# that is merely ``available`` is *not* bound to this instance, so it can never
# be run here and must not count as ready.
_READY_STATUSES = frozenset({"assigned"})
# Sandboxes that belong to this instance regardless of momentary busyness.
_FLEET_STATUSES = frozenset({"assigned", "in_use"})


def _sandbox_status(sandbox: object) -> str:
    return str(getattr(sandbox, "status", "")).strip().lower()


class SandboxNoCapacityError(RuntimeError):
    pass


class SandboxUnhealthyError(RuntimeError):
    pass


class SandboxLeaseManager(Protocol):
    async def reserve(self, req: SandboxRequirement, run_id: str) -> ReservationToken: ...
    async def acquire(self, token: ReservationToken) -> SandboxLeaseRef: ...
    async def reset(self, lease: SandboxLeaseRef) -> None: ...
    async def heartbeat(self, lease: SandboxLeaseRef) -> None: ...
    async def release(self, lease: SandboxLeaseRef, outcome: Literal["clean", "dirty", "crashed"]) -> None: ...


@dataclass
class InMemorySandboxLeaseManager:
    capacities: dict[str, int]
    acquire_timeout_seconds: float = 30.0
    _semaphores: dict[str, asyncio.Semaphore] = field(default_factory=dict)
    _leases: dict[str, str] = field(default_factory=dict)
    reset_count: int = 0

    async def reserve(self, req: SandboxRequirement, run_id: str) -> ReservationToken:
        if req.count != 1:
            raise SandboxNoCapacityError("in-memory lease manager supports one sandbox per run")
        if self.capacities.get(req.type, 0) <= 0:
            raise SandboxNoCapacityError(f"No {req.type} sandbox capacity configured for run {run_id}")
        self._semaphore(req.type)
        return ReservationToken(
            reservation_id=f"reservation-{uuid.uuid4().hex[:12]}",
            run_id=run_id,
            type=req.type,
            expires_at=_now_ms() + 30_000,
        )

    async def acquire(self, token: ReservationToken) -> SandboxLeaseRef:
        semaphore = self._semaphore(token.type)
        try:
            await asyncio.wait_for(semaphore.acquire(), timeout=self.acquire_timeout_seconds)
        except TimeoutError as exc:
            raise SandboxNoCapacityError(f"Timed out waiting for {token.type} sandbox capacity") from exc
        now_ms = _now_ms()
        # token.type is an OS selector; pick the highest-priority concrete type
        # that can supply it so the in-memory lease looks like a real one (the
        # backend resolves the real machine). eligible_types_for_os always yields
        # at least one type, so [0] is safe.
        lease_type = eligible_types_for_os(token.type)[0]
        lease = SandboxLeaseRef(
            sandbox_id=f"{lease_type}:{uuid.uuid4().hex[:8]}",
            type=lease_type,
            endpoint=f"memory://{lease_type}/{token.run_id}",
            provider_base_url=f"memory://{lease_type}",
            device_id=f"{lease_type}-{token.run_id}",
            acquired_at=now_ms,
            expires_at=now_ms + 30 * 60 * 1000,
        )
        self._leases[lease.sandbox_id] = token.type
        return lease

    async def reset(self, lease: SandboxLeaseRef) -> None:
        self.reset_count += 1

    async def heartbeat(self, lease: SandboxLeaseRef) -> None:
        return None

    async def release(self, lease: SandboxLeaseRef, outcome: Literal["clean", "dirty", "crashed"]) -> None:
        sandbox_type = self._leases.pop(lease.sandbox_id, None)
        if sandbox_type is None:
            return
        if outcome != "crashed":
            self._semaphore(sandbox_type).release()

    async def available_count(self, sandbox_type: str) -> int:
        if self.capacities.get(sandbox_type, 0) <= 0:
            return 0
        return int(getattr(self._semaphore(sandbox_type), "_value", 0))

    def _semaphore(self, sandbox_type: str) -> asyncio.Semaphore:
        if sandbox_type not in self._semaphores:
            self._semaphores[sandbox_type] = asyncio.Semaphore(self.capacities[sandbox_type])
        return self._semaphores[sandbox_type]


class ReverseGrpcSandboxLeaseManager:
    def __init__(
        self,
        *,
        agent_instance_id: int,
        service: ReverseSandboxService | None = None,
        acquire_timeout_seconds: float | None = None,
    ) -> None:
        self.agent_instance_id = str(agent_instance_id)
        if service is None:
            from app.biz.reverse_grpc.sandbox import ReverseSandboxService

            service = ReverseSandboxService.get_instance()
        self.service = service
        self.acquire_timeout_seconds = acquire_timeout_seconds or _sandbox_acquire_timeout_seconds()

    async def reserve(self, req: SandboxRequirement, run_id: str) -> ReservationToken:
        deadline = time.monotonic() + self.acquire_timeout_seconds
        while True:
            snapshot = await self._instance_sandboxes(req.type)
            ready = [s for s in snapshot if _sandbox_status(s) in _READY_STATUSES]
            if len(ready) >= req.count:
                break
            # Fast-fail: the instance owns zero machines of this type (no idle,
            # no busy sibling that will ever free one) and none is claimable from
            # the pool right now. Waiting out the full ``acquire_timeout`` would
            # only delay an inevitable failure, so reject immediately with a
            # clear message instead of pinning a worker slot for minutes.
            fleet = [s for s in snapshot if _sandbox_status(s) in _FLEET_STATUSES]
            if not fleet and not ready:
                raise SandboxNoCapacityError(f"No {req.type} sandbox is assigned to this agent instance for run {run_id}")
            if time.monotonic() >= deadline:
                raise SandboxNoCapacityError(f"No available {req.type} sandbox capacity for run {run_id}")
            await asyncio.sleep(_capacity_retry_sleep_seconds(deadline))
        return ReservationToken(
            reservation_id=f"reservation-{uuid.uuid4().hex[:12]}",
            run_id=run_id,
            type=req.type,
            expires_at=_now_ms() + int(self.acquire_timeout_seconds * 1000),
        )

    async def acquire(self, token: ReservationToken) -> SandboxLeaseRef:
        last_message = ""
        while True:
            result = await asyncio.to_thread(self.service.apply_sandbox, self.agent_instance_id, token.type)
            if result.applied:
                break
            last_message = result.message or f"No {token.type} sandbox could be acquired"
            deadline = token.expires_at / 1000
            if time.time() >= deadline:
                raise SandboxNoCapacityError(last_message)
            await asyncio.sleep(min(1.0, max(0.1, deadline - time.time())))
        now_ms = _now_ms()
        # The reservation was made against an OS selector; the concrete type is
        # whichever pool the backend actually acquired from, encoded in the
        # sandbox id (``{type}:{resourceID}``). Fall back to the highest-priority
        # eligible type if the id is unexpectedly shaped.
        lease_type = lease_type_from_sandbox_id(result.applied_sandbox_id)
        if lease_type is None:
            lease_type = eligible_types_for_os(token.type)[0]
        return SandboxLeaseRef(
            sandbox_id=result.applied_sandbox_id,
            type=lease_type,
            endpoint=result.endpoint,
            provider_base_url=result.provider_base_url,
            device_id=result.device_id,
            vnc_url=result.vnc_url,
            acquired_at=now_ms,
            expires_at=now_ms + 30 * 60 * 1000,
        )

    async def reset(self, lease: SandboxLeaseRef) -> None:
        try:
            await asyncio.to_thread(self.service.reset_sandbox, self.agent_instance_id, lease.sandbox_id)
        except Exception as exc:
            raise SandboxUnhealthyError(f"Failed to reset sandbox {lease.sandbox_id}: {exc}") from exc

    async def heartbeat(self, lease: SandboxLeaseRef) -> None:
        return None

    async def release(self, lease: SandboxLeaseRef, outcome: Literal["clean", "dirty", "crashed"]) -> None:
        if outcome != "crashed":
            await asyncio.to_thread(self.service.release_sandbox, self.agent_instance_id, lease.sandbox_id)

    async def available_count(self, sandbox_type: str) -> int:
        """Idle capacity of this instance: sandboxes ready to run a task *now*.

        Only ``assigned`` sandboxes count — they are leased to this instance and
        not currently executing, so they bound how many runs can proceed in
        parallel. ``in_use`` machines are excluded (busy) and pool ``available``
        ones are excluded (not yet ours). This is the value batch planning uses
        to clamp sandbox concurrency.
        """
        snapshot = await self._instance_sandboxes(sandbox_type)
        return sum(1 for sandbox in snapshot if _sandbox_status(sandbox) == "assigned")

    async def fleet_count(self, sandbox_type: str) -> int:
        """Machines that belong to this instance: ``assigned`` plus ``in_use``.

        Exposed for observability/tests; ``reserve`` derives the same value
        inline from a single snapshot to drive fast-fail.
        """
        snapshot = await self._instance_sandboxes(sandbox_type)
        return sum(1 for sandbox in snapshot if _sandbox_status(sandbox) in _FLEET_STATUSES)

    async def _instance_sandboxes(self, sandbox_type: str) -> list:
        return await asyncio.to_thread(self.service.get_instance_sandboxes, self.agent_instance_id, sandbox_type)


def _sandbox_acquire_timeout_seconds() -> float:
    configured = os.getenv("TASK_RUNTIME_SANDBOX_ACQUIRE_TIMEOUT_SECONDS", "300").strip()
    try:
        return max(1.0, float(configured))
    except ValueError:
        return 60.0


def _capacity_retry_sleep_seconds(deadline: float) -> float:
    return min(1.0, max(0.1, deadline - time.monotonic()))
