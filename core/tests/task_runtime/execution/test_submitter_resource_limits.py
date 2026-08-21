"""Tests for sandbox scheduling buckets and the shared resource gate."""

from __future__ import annotations

import asyncio
import contextlib
import time

import pytest

from app.biz.task_runtime.domain.models import (
    CapabilityDispatch,
    SubAgentDispatch,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
)
from app.biz.task_runtime.orchestration.execution_plan import (
    BatchExecutionPlan,
    SandboxTypePlan,
    _execution_resource_limits,
)
from app.biz.task_runtime.execution.resources import ResourceGate, run_resource_key


def _run(spec: TaskSpec) -> TaskRun:
    return TaskRun(
        run_id=f"run-{spec.task_id}",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key=spec.task_id,
        executor="in_process",
        queued_at=int(time.time() * 1000),
    )


def _plan(*, sandbox_type=None, sandbox_concurrency=None) -> BatchExecutionPlan:
    sandbox_plans = ()
    if sandbox_type is not None:
        sandbox_plans = (
            SandboxTypePlan(
                sandbox_type=sandbox_type,
                task_count=1,
                concurrency=sandbox_concurrency or 1,
            ),
        )
    return BatchExecutionPlan(
        total_count=1,
        concurrency=1,
        planned_batch_sizes=(1,),
        sandbox_type=sandbox_type,
        sandbox_concurrency=sandbox_concurrency,
        sandbox_plans=sandbox_plans,
    )


# --- run_resource_key -------------------------------------------------------


def test_resource_key_prefers_required_sandbox():
    run = _run(
        TaskSpec(task_id="t", title="T", dispatch=CapabilityDispatch(capability_id="builtin:echo"), required_sandbox="android")
    )
    assert run_resource_key(run) == "android"


def test_resource_key_local_tool_has_no_bucket(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "local")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=CapabilityDispatch(capability_id="builtin:echo")))
    assert run_resource_key(run) is None


def test_resource_key_run_command_does_not_reserve_backend_for_parent(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=CapabilityDispatch(capability_id="builtin:run_command")))
    assert run_resource_key(run) is None


def test_resource_key_echo_stays_unbounded_even_on_pod_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=CapabilityDispatch(capability_id="builtin:echo")))
    assert run_resource_key(run) is None


def test_resource_key_skill_does_not_reserve_backend_for_parent(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=CapabilityDispatch(capability_id="skill:s.a")))
    assert run_resource_key(run) is None


def test_resource_key_sub_agent_does_not_reserve_backend_while_waiting(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=SubAgentDispatch(capability_grants=["echo"])))
    assert run_resource_key(run) is None


# --- _execution_resource_limits ---------------------------------------------


def test_limits_empty_for_local_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "local")
    assert _execution_resource_limits(_plan()) == {}


def test_limits_do_not_include_k8s_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    monkeypatch.delenv("TASK_RUNTIME_K8S_POD_CONCURRENCY", raising=False)
    assert _execution_resource_limits(_plan()) == {}


def test_limits_do_not_include_k8s_backend_override(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    monkeypatch.setenv("TASK_RUNTIME_K8S_POD_CONCURRENCY", "3")
    assert _execution_resource_limits(_plan()) == {}


def test_limits_do_not_include_docker_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    monkeypatch.delenv("TASK_RUNTIME_DOCKER_CONCURRENCY", raising=False)
    assert _execution_resource_limits(_plan()) == {}


def test_limits_include_only_sandbox_fleet(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    monkeypatch.setenv("TASK_RUNTIME_DOCKER_CONCURRENCY", "4")
    limits = _execution_resource_limits(_plan(sandbox_type="android", sandbox_concurrency=2))
    assert limits == {"android": 2}


# --- ResourceGate -----------------------------------------------------------


@pytest.mark.asyncio
async def test_gate_admits_only_as_many_holders_as_the_limit():
    # The backend decorator uses this process-wide gate for physical resources.
    gate = ResourceGate()
    inside = 0
    peak = 0

    async def _hold() -> None:
        nonlocal inside, peak
        async with gate.hold("k8s_pod", 1):
            inside += 1
            peak = max(peak, inside)
            await asyncio.sleep(0)
            inside -= 1

    await asyncio.gather(*(_hold() for _ in range(5)))

    assert peak == 1


@pytest.mark.asyncio
async def test_gate_releases_the_slot_when_the_held_block_fails():
    # A slot leaked by a crashed or cancelled call would shrink the ceiling for
    # the rest of the process, so release has to survive both exits.
    gate = ResourceGate()

    with contextlib.suppress(RuntimeError):
        async with gate.hold("docker", 1):
            raise RuntimeError("boom")

    holder = asyncio.create_task(_forever(gate))
    await asyncio.sleep(0)
    holder.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await holder

    # Still admits a new holder: neither exit path kept the slot.
    async with asyncio.timeout(1):
        async with gate.hold("docker", 1):
            pass


async def _forever(gate: ResourceGate) -> None:
    async with gate.hold("docker", 1):
        await asyncio.Event().wait()


@pytest.mark.asyncio
async def test_gate_is_advisory_when_no_ceiling_is_configured():
    # An unbucketed or unbounded run must not queue behind anything.
    gate = ResourceGate()
    async with gate.hold(None, 4), gate.hold("docker", 0):
        pass
