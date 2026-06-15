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

"""Tests for the submitter's backend/sandbox-aware scheduler resource limits.

Covers the env-driven docker/k8s pod concurrency caps (item 4/5): how a run is
bucketed (:func:`_run_resource_key`) and how the per-batch limit dict is built
(:func:`_execution_resource_limits`) so pod/container-backed runs are throttled
while local in-process tools stay unbounded."""

from __future__ import annotations

import time

from app.biz.task_runtime.models import (
    SkillDispatch,
    SubAgentDispatch,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
    ToolDispatch,
)
from app.biz.task_runtime.execution_plan import BatchExecutionPlan, SandboxTypePlan
from app.biz.task_runtime.submitter import _execution_resource_limits, _run_resource_key


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


# --- _run_resource_key ------------------------------------------------------


def test_resource_key_prefers_required_sandbox():
    run = _run(TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="echo"), required_sandbox="android"))
    assert _run_resource_key(run) == "android"


def test_resource_key_local_tool_has_no_bucket(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "local")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="echo")))
    assert _run_resource_key(run) is None


def test_resource_key_run_command_uses_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="run_command")))
    assert _run_resource_key(run) == "k8s_pod"


def test_resource_key_echo_stays_unbounded_even_on_pod_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="echo")))
    assert _run_resource_key(run) is None


def test_resource_key_skill_uses_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=SkillDispatch(skill_name="s", action_name="a")))
    assert _run_resource_key(run) == "docker"


def test_resource_key_sub_agent_uses_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    run = _run(TaskSpec(task_id="t", title="T", dispatch=SubAgentDispatch(capabilities=["echo"])))
    assert _run_resource_key(run) == "k8s_pod"


# --- _execution_resource_limits ---------------------------------------------


def test_limits_empty_for_local_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "local")
    assert _execution_resource_limits(_plan()) == {}


def test_limits_default_k8s_pod(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    monkeypatch.delenv("TASK_RUNTIME_K8S_POD_CONCURRENCY", raising=False)
    assert _execution_resource_limits(_plan()) == {"k8s_pod": 10}


def test_limits_env_overrides_k8s_pod(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    monkeypatch.setenv("TASK_RUNTIME_K8S_POD_CONCURRENCY", "3")
    assert _execution_resource_limits(_plan()) == {"k8s_pod": 3}


def test_limits_default_docker(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    monkeypatch.delenv("TASK_RUNTIME_DOCKER_CONCURRENCY", raising=False)
    assert _execution_resource_limits(_plan()) == {"docker": 10}


def test_limits_merge_sandbox_and_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    monkeypatch.setenv("TASK_RUNTIME_DOCKER_CONCURRENCY", "4")
    limits = _execution_resource_limits(_plan(sandbox_type="android", sandbox_concurrency=2))
    assert limits == {"android": 2, "docker": 4}
