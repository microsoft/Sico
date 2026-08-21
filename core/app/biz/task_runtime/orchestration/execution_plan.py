"""Transient batch execution-planning models.

These are scheduling inputs computed by the submitter just before a batch runs;
they are *not* persisted and *not* part of the rendering layer. The submitter
derives concurrency lanes and per-sandbox-OS resource gates from them, then
folds a representative summary into the persisted :class:`BatchRecord`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ..capabilities.ids import skill_action_of
from ..context import TurnContext
from ..domain.models import PreparedTaskBatch
from ..sandbox.types import SANDBOX_OSES

if TYPE_CHECKING:
    from ..capabilities.loader import SkillLoader
    from ..sandbox.coordinator import SandboxCoordinator

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class SandboxTypePlan:
    """Per-sandbox-OS capacity slice of a batch's execution plan.

    A single batch can mix tasks bound to different sandbox OSes (e.g. an
    ``android`` run next to a ``windows`` run) plus sandbox-free tasks. Each OS
    leases from its own machine fleet, so its concurrency must be gated against
    *its own* idle capacity — never collapsed onto a single representative,
    which would throttle one fleet by another's saturation.
    """

    sandbox_type: str
    task_count: int
    concurrency: int
    available_count: int | None = None


@dataclass(frozen=True)
class BatchExecutionPlan:
    total_count: int
    concurrency: int
    planned_batch_sizes: tuple[int, ...]
    # ``sandbox_plans`` is the authoritative per-type breakdown that drives the
    # scheduler's resource gate. The scalar ``sandbox_*`` fields below are a
    # representative summary (primary/highest-priority bucket + aggregates) kept
    # for the persisted ``BatchRecord`` projection and the batch-level fallback
    # caption; they must never be used to size concurrency on their own.
    sandbox_type: str | None = None
    sandbox_task_count: int = 0
    sandbox_concurrency: int | None = None
    available_sandbox_count: int | None = None
    sandbox_plans: tuple[SandboxTypePlan, ...] = ()


class ExecutionPlanner:
    """Normalize capability requirements and plan per-fleet execution lanes."""

    def __init__(
        self,
        sandbox: SandboxCoordinator,
        max_concurrency: int,
        skill_loader: "SkillLoader | None" = None,
    ) -> None:
        self._sandbox = sandbox
        self._max_concurrency = max(1, max_concurrency)
        self._skill_loader = skill_loader

    def normalize(self, prepared: PreparedTaskBatch) -> None:
        skill_loader = self._skill_loader
        if skill_loader is None:
            return
        for task in prepared.batch.tasks:
            skill_name, action_name = skill_action_of(task.capability_id)
            if not skill_name or not action_name:
                continue
            card = skill_loader.resolve(f"{skill_name}.{action_name}")
            if card is None:
                continue
            authoritative = list(card.sandbox_options)
            preferred = task.selected_sandbox
            if preferred not in authoritative:
                preferred = None
            if task.sandbox_options != tuple(authoritative):
                _LOGGER.info(
                    "normalizing skill sandbox skill=%s action=%s from=%s to=%s",
                    skill_name,
                    action_name,
                    task.required_sandbox,
                    authoritative,
                )
                task.required_sandbox = authoritative
            task.set_selected_sandbox(preferred)

    async def plan(self, ctx: TurnContext, prepared: PreparedTaskBatch) -> BatchExecutionPlan:
        total_count = len(prepared.batch.tasks)
        sandbox_plans = await self._plan_sandbox_buckets(ctx, prepared)
        sandbox_task_count = sum(plan.task_count for plan in sandbox_plans)
        sandbox_lane_total = sum(plan.concurrency for plan in sandbox_plans)
        concurrency = _effective_batch_concurrency(
            total_count=total_count,
            configured=_batch_concurrency_limit(self._max_concurrency, prepared.batch.max_concurrency),
            sandbox_lane_total=sandbox_lane_total,
            non_sandbox_count=total_count - sandbox_task_count,
        )
        primary = sandbox_plans[0] if sandbox_plans else None
        return BatchExecutionPlan(
            total_count=total_count,
            concurrency=concurrency,
            planned_batch_sizes=_planned_batch_sizes(total_count, concurrency),
            sandbox_type=primary.sandbox_type if primary else None,
            sandbox_task_count=sandbox_task_count,
            sandbox_concurrency=sandbox_lane_total or None,
            available_sandbox_count=_aggregate_available_sandboxes(sandbox_plans),
            sandbox_plans=sandbox_plans,
        )

    async def _plan_sandbox_buckets(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
    ) -> tuple[SandboxTypePlan, ...]:
        available_by_type: dict[str, int | None] = {}
        all_options = {option for task in prepared.batch.tasks for option in task.sandbox_options}
        for sandbox_type in _ordered_sandbox_types({option: 1 for option in all_options}):
            available_by_type[sandbox_type] = await self._sandbox.available_count(ctx, sandbox_type)

        counts: dict[str, int] = {}
        for task in prepared.batch.tasks:
            options = task.sandbox_options
            if not options:
                continue
            selected = task.selected_sandbox
            if selected not in options or (len(options) > 1 and not available_by_type.get(selected)):
                selected = _choose_sandbox_option(options, counts, available_by_type)
                task.set_selected_sandbox(selected)
            counts[selected] = counts.get(selected, 0) + 1

        plans: list[SandboxTypePlan] = []
        for sandbox_type in _ordered_sandbox_types(counts):
            task_count = counts[sandbox_type]
            available = available_by_type.get(sandbox_type)
            concurrency = _sandbox_concurrency_limit(
                sandbox_task_count=task_count,
                available_sandbox_count=available,
            )
            plans.append(
                SandboxTypePlan(
                    sandbox_type=sandbox_type,
                    task_count=task_count,
                    concurrency=concurrency or 1,
                    available_count=available,
                )
            )
        return tuple(plans)


def _batch_concurrency_limit(configured: int, requested: int | None) -> int:
    """Apply a caller cap without allowing it to widen the deployment limit."""
    configured = max(1, configured)
    return min(configured, requested) if requested is not None else configured


def _planned_batch_sizes(total_count: int, concurrency: int) -> tuple[int, ...]:
    if total_count <= 0:
        return ()
    step = max(1, concurrency)
    return tuple(min(step, total_count - index) for index in range(0, total_count, step))


def _ordered_sandbox_types(types: dict[str, int]) -> list[str]:
    known = [sandbox_os for sandbox_os in SANDBOX_OSES if sandbox_os in types]
    extra = sorted(bucket for bucket in types if bucket not in SANDBOX_OSES)
    return known + extra


def _aggregate_available_sandboxes(plans: tuple[SandboxTypePlan, ...]) -> int | None:
    knowns = [plan.available_count for plan in plans if plan.available_count is not None]
    return sum(knowns) if knowns else None


def _sandbox_concurrency_limit(
    *,
    sandbox_task_count: int,
    available_sandbox_count: int | None,
) -> int | None:
    if sandbox_task_count <= 0:
        return None
    if available_sandbox_count is None or available_sandbox_count <= 0:
        return 1
    return max(1, min(sandbox_task_count, available_sandbox_count))


def _choose_sandbox_option(
    options: tuple[str, ...],
    counts: dict[str, int],
    available_by_type: dict[str, int | None],
) -> str:
    selectable_options = [option for option in options if (available_by_type.get(option) or 0) > 0]
    if not selectable_options:
        selectable_options = list(options)

    def score(sandbox_type: str) -> tuple[int, int]:
        available = available_by_type.get(sandbox_type)
        remaining = (available if available is not None else 0) - counts.get(sandbox_type, 0)
        return (remaining, -counts.get(sandbox_type, 0))

    return max(selectable_options, key=score)


def _execution_resource_limits(plan: BatchExecutionPlan) -> dict[str, int]:
    return {
        sandbox_plan.sandbox_type: sandbox_plan.concurrency for sandbox_plan in plan.sandbox_plans if sandbox_plan.concurrency > 0
    }


def _effective_batch_concurrency(
    *,
    total_count: int,
    configured: int,
    sandbox_lane_total: int,
    non_sandbox_count: int,
) -> int:
    if total_count <= 0:
        return 1
    useful = sandbox_lane_total + non_sandbox_count
    if useful <= 0:
        useful = total_count
    return max(1, min(max(1, configured), total_count, useful))
