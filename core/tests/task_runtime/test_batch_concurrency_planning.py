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

from app.biz.task_runtime.execution_plan import BatchExecutionPlan, SandboxTypePlan
from app.biz.task_runtime.submitter import (
    _aggregate_available_sandboxes,
    _effective_batch_concurrency,
    _execution_resource_limits,
    _ordered_sandbox_types,
    _sandbox_concurrency_limit,
)


def test_sandbox_concurrency_clamps_to_idle_capacity() -> None:
    # 5 assigned machines, 51 sandbox tasks -> 5 lanes.
    assert _sandbox_concurrency_limit(sandbox_task_count=51, available_sandbox_count=5) == 5


def test_sandbox_concurrency_fail_closed_when_capacity_zero() -> None:
    # Every machine busy right now -> serialize over the one that frees up,
    # never fall back to the global scheduler max.
    assert _sandbox_concurrency_limit(sandbox_task_count=52, available_sandbox_count=0) == 1


def test_sandbox_concurrency_fail_closed_when_capacity_unknown() -> None:
    # Snapshot unavailable (None) must still fail closed, not fan out.
    assert _sandbox_concurrency_limit(sandbox_task_count=52, available_sandbox_count=None) == 1


def test_sandbox_concurrency_none_for_non_sandbox_batch() -> None:
    assert _sandbox_concurrency_limit(sandbox_task_count=0, available_sandbox_count=None) is None


def test_effective_concurrency_full_sandbox_batch_uses_capacity() -> None:
    assert (
        _effective_batch_concurrency(
            total_count=52,
            configured=20,
            sandbox_lane_total=5,
            non_sandbox_count=0,
        )
        == 5
    )


def test_effective_concurrency_zero_capacity_serializes_instead_of_global_max() -> None:
    assert (
        _effective_batch_concurrency(
            total_count=52,
            configured=20,
            sandbox_lane_total=1,
            non_sandbox_count=0,
        )
        == 1
    )


def test_effective_concurrency_non_sandbox_batch_caps_at_configured() -> None:
    # No sandbox lanes: 40 plain tasks fan out up to the configured max (20).
    assert (
        _effective_batch_concurrency(
            total_count=40,
            configured=20,
            sandbox_lane_total=0,
            non_sandbox_count=40,
        )
        == 20
    )


def test_effective_concurrency_mixed_batch_sums_lanes_capped_at_configured() -> None:
    # android(20) + 10 sandbox-free = 30 useful lanes, capped at 20.
    assert (
        _effective_batch_concurrency(
            total_count=30,
            configured=20,
            sandbox_lane_total=20,
            non_sandbox_count=10,
        )
        == 20
    )


def test_effective_concurrency_mixed_batch_below_configured_uses_useful() -> None:
    # android(5) + 1 sandbox-free = 6 useful lanes, under the cap.
    assert (
        _effective_batch_concurrency(
            total_count=6,
            configured=20,
            sandbox_lane_total=5,
            non_sandbox_count=1,
        )
        == 6
    )


def test_resource_gate_always_wired_for_sandbox_batch() -> None:
    plan = BatchExecutionPlan(
        total_count=52,
        concurrency=1,
        planned_batch_sizes=(1,) * 52,
        sandbox_type="emulator",
        sandbox_task_count=52,
        sandbox_concurrency=1,
        available_sandbox_count=0,
        sandbox_plans=(SandboxTypePlan(sandbox_type="emulator", task_count=52, concurrency=1, available_count=0),),
    )
    limits = _execution_resource_limits(plan)
    assert limits.get("emulator") == 1


def test_resource_gate_buckets_each_sandbox_type_independently() -> None:
    # A batch using a single sandbox type should produce one gate clamped to its
    # own idle fleet.
    plan = BatchExecutionPlan(
        total_count=10,
        concurrency=6,
        planned_batch_sizes=(6, 4),
        sandbox_type="emulator",
        sandbox_task_count=5,
        sandbox_concurrency=3,
        available_sandbox_count=3,
        sandbox_plans=(
            SandboxTypePlan(sandbox_type="emulator", task_count=5, concurrency=3, available_count=3),
        ),
    )
    limits = _execution_resource_limits(plan)
    assert limits.get("emulator") == 3


def test_ordered_sandbox_types_follows_canonical_priority() -> None:
    # Buckets are OS capabilities; insertion order is preserved by canonical
    # SANDBOX_OSES priority.
    assert _ordered_sandbox_types({"android": 5}) == ["android"]


def test_ordered_sandbox_types_appends_unknowns_last() -> None:
    assert _ordered_sandbox_types({"zzz": 1, "android": 2}) == ["android", "zzz"]


def test_aggregate_available_sums_known_capacities() -> None:
    plans = (
        SandboxTypePlan(sandbox_type="emulator", task_count=5, concurrency=3, available_count=3),
        SandboxTypePlan(sandbox_type="emulator", task_count=3, concurrency=2, available_count=2),
    )
    assert _aggregate_available_sandboxes(plans) == 5


def test_aggregate_available_none_when_all_unknown() -> None:
    plans = (SandboxTypePlan(sandbox_type="emulator", task_count=5, concurrency=1, available_count=None),)
    assert _aggregate_available_sandboxes(plans) is None
