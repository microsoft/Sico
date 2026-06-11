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

"""Tests for ``TaskSpec.stage`` and the submitter's staged-execution helpers.

Covers the wave grouping (``_group_runs_by_stage``), the per-join-strategy
gate (``_stage_gate_blocks``), and the schema clamp that keeps ``stage``
non-negative."""

from __future__ import annotations

import time

from app.biz.task_runtime.models import (
    ErrorClass,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    ToolDispatch,
)
from app.biz.task_runtime.submitter import _group_runs_by_stage, _stage_gate_blocks


def _run(task_id: str, stage: int, batch_item_index: int = 0) -> TaskRun:
    spec = TaskSpec(task_id=task_id, title=task_id, dispatch=ToolDispatch(tool_name="echo"), stage=stage)
    return TaskRun(
        run_id=f"run-{task_id}",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=batch_item_index,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key=task_id,
        executor="in_process",
        queued_at=int(time.time() * 1000),
    )


def _result(task_id: str, status: TaskStatus) -> TaskResult:
    return TaskResult(
        run_id=f"run-{task_id}",
        task_id=task_id,
        status=status,
        title=task_id,
        summary="",
        error_class=None if status == TaskStatus.COMPLETED else ErrorClass.INTERNAL,
    )


# --- TaskSpec.stage ---------------------------------------------------------


def test_stage_defaults_to_zero():
    spec = TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="echo"))
    assert spec.stage == 0


def test_negative_stage_is_clamped():
    spec = TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="echo"), stage=-3)
    assert spec.stage == 0


# --- _group_runs_by_stage ---------------------------------------------------


def test_grouping_orders_waves_ascending_and_tolerates_gaps():
    runs = [_run("a", stage=10), _run("b", stage=0), _run("c", stage=10), _run("d", stage=5)]
    waves = _group_runs_by_stage(runs)
    assert [stage for stage, _ in waves] == [0, 5, 10]
    assert [r.spec.task_id for r in waves[2][1]] == ["a", "c"]


def test_single_stage_collapses_to_one_wave():
    runs = [_run("a", stage=0), _run("b", stage=0)]
    waves = _group_runs_by_stage(runs)
    assert len(waves) == 1
    assert waves[0][0] == 0


# --- _stage_gate_blocks -----------------------------------------------------


def test_gate_blocks_on_failure_for_hard_strategies():
    results = [_result("a", TaskStatus.COMPLETED), _result("b", TaskStatus.FAILED)]
    assert _stage_gate_blocks(results, "all_success") is True
    assert _stage_gate_blocks(results, "fail_fast") is True


def test_gate_passes_when_all_complete():
    results = [_result("a", TaskStatus.COMPLETED), _result("b", TaskStatus.COMPLETED)]
    assert _stage_gate_blocks(results, "all_success") is False


def test_soft_strategies_never_block_downstream():
    results = [_result("a", TaskStatus.FAILED)]
    assert _stage_gate_blocks(results, "partial_ok") is False
    assert _stage_gate_blocks(results, "first_success") is False
