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

import time
from types import SimpleNamespace

import pytest

import app.biz.task_runtime.sandbox as sandbox_module
from app.biz.task_runtime.models import ReservationToken, SandboxLeaseRef, SandboxRequirement
from app.biz.task_runtime.sandbox import ReverseGrpcSandboxLeaseManager, SandboxNoCapacityError


@pytest.mark.asyncio
async def test_reverse_grpc_reserve_waits_for_released_capacity(monkeypatch) -> None:
    monkeypatch.setattr(sandbox_module, "_capacity_retry_sleep_seconds", lambda deadline: 0)
    service = _FakeReverseSandboxService(
        sandbox_statuses=[("in_use",), ("assigned",)],
        apply_results=[_applied_result()],
    )
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)

    token = await manager.reserve(SandboxRequirement(type="android"), "run-1")

    assert token.type == "android"
    assert service.list_calls == 2


@pytest.mark.asyncio
async def test_reverse_grpc_acquire_retries_until_apply_succeeds() -> None:
    service = _FakeReverseSandboxService(
        sandbox_statuses=[("assigned",)],
        apply_results=[SimpleNamespace(applied=False, message="busy"), _applied_result()],
    )
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)
    token = ReservationToken(
        reservation_id="reservation-1",
        run_id="run-1",
        type="android",
        expires_at=int((time.time() + 1) * 1000),
    )

    lease = await manager.acquire(token)

    assert lease.sandbox_id == "sandbox-1"
    assert service.apply_calls == 2


@pytest.mark.asyncio
async def test_reverse_grpc_reserve_fast_fails_when_instance_owns_no_sandbox(monkeypatch) -> None:
    monkeypatch.setattr(sandbox_module, "_capacity_retry_sleep_seconds", lambda deadline: 0)
    # The instance holds zero machines of this type (empty snapshot); waiting out
    # the full acquire timeout would only delay an inevitable failure.
    service = _FakeReverseSandboxService(sandbox_statuses=[()], apply_results=[])
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=300)

    with pytest.raises(SandboxNoCapacityError, match="assigned to this agent instance"):
        await manager.reserve(SandboxRequirement(type="android"), "run-1")

    assert service.list_calls == 1  # single snapshot, no polling


@pytest.mark.asyncio
async def test_reverse_grpc_reserve_waits_when_busy_sibling_holds_machine(monkeypatch) -> None:
    monkeypatch.setattr(sandbox_module, "_capacity_retry_sleep_seconds", lambda deadline: 0)
    # A busy ``in_use`` machine belongs to the instance, so reserve must wait for
    # it to free rather than fast-fail.
    service = _FakeReverseSandboxService(
        sandbox_statuses=[("in_use",), ("assigned",)],
        apply_results=[],
    )
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)

    token = await manager.reserve(SandboxRequirement(type="android"), "run-1")

    assert token.type == "android"
    assert service.list_calls == 2


@pytest.mark.asyncio
async def test_reverse_grpc_available_count_only_counts_assigned() -> None:
    service = _FakeReverseSandboxService(
        sandbox_statuses=[("assigned", "in_use", "available", "unhealthy")],
        apply_results=[],
    )
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)

    assert await manager.available_count("emulator") == 1


@pytest.mark.asyncio
async def test_reverse_grpc_fleet_count_includes_assigned_and_in_use() -> None:
    service = _FakeReverseSandboxService(
        sandbox_statuses=[("assigned", "in_use", "available", "unhealthy")],
        apply_results=[],
    )
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)

    assert await manager.fleet_count("emulator") == 2


@pytest.mark.asyncio
async def test_reverse_grpc_acquire_times_out_after_retries() -> None:
    service = _FakeReverseSandboxService(
        sandbox_statuses=[("assigned",)],
        apply_results=[SimpleNamespace(applied=False, message="busy")],
    )
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)
    token = ReservationToken(
        reservation_id="reservation-1",
        run_id="run-1",
        type="android",
        expires_at=int((time.time() + 0.01) * 1000),
    )

    with pytest.raises(SandboxNoCapacityError, match="busy"):
        await manager.acquire(token)


@pytest.mark.asyncio
async def test_reverse_grpc_dirty_release_only_releases() -> None:
    service = _FakeReverseSandboxService(sandbox_statuses=[("assigned",)], apply_results=[])
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)

    await manager.release(_lease(), "dirty")

    assert service.reset_calls == []
    assert service.release_calls == [("2", "sandbox-1")]


@pytest.mark.asyncio
async def test_reverse_grpc_crashed_release_keeps_lease_in_use() -> None:
    service = _FakeReverseSandboxService(sandbox_statuses=[("assigned",)], apply_results=[])
    manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=2, service=service, acquire_timeout_seconds=1)

    await manager.release(_lease(), "crashed")

    assert service.reset_calls == []
    assert service.release_calls == []


class _FakeReverseSandboxService:
    def __init__(self, *, sandbox_statuses: list[tuple[str, ...]], apply_results: list[SimpleNamespace]) -> None:
        self.sandbox_statuses = list(sandbox_statuses)
        self.apply_results = list(apply_results)
        self.list_calls = 0
        self.apply_calls = 0
        self.reset_calls: list[tuple[str, str]] = []
        self.release_calls: list[tuple[str, str]] = []

    def get_instance_sandboxes(self, agent_instance_id: str, sandbox_type: str):
        self.list_calls += 1
        statuses = self.sandbox_statuses.pop(0) if len(self.sandbox_statuses) > 1 else self.sandbox_statuses[0]
        return [SimpleNamespace(status=status) for status in statuses]

    def apply_sandbox(self, agent_instance_id: str, sandbox_type: str):
        self.apply_calls += 1
        if len(self.apply_results) > 1:
            return self.apply_results.pop(0)
        return self.apply_results[0]

    def reset_sandbox(self, agent_instance_id: str, sandbox_id: str) -> None:
        self.reset_calls.append((agent_instance_id, sandbox_id))

    def release_sandbox(self, agent_instance_id: str, sandbox_id: str) -> None:
        self.release_calls.append((agent_instance_id, sandbox_id))


def _applied_result() -> SimpleNamespace:
    return SimpleNamespace(
        applied=True,
        applied_sandbox_id="sandbox-1",
        endpoint="127.0.0.1:5555",
        provider_base_url="http://sandbox",
        device_id="device-1",
        vnc_url="http://sandbox/vnc",
    )


def _lease() -> SandboxLeaseRef:
    return SandboxLeaseRef(
        sandbox_id="sandbox-1",
        type="emulator",
        endpoint="127.0.0.1:5555",
        provider_base_url="http://sandbox",
        device_id="device-1",
        acquired_at=1,
    )
