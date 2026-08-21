"""Deterministically assemble planned work into the runtime handoff."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from app.biz.task_runtime.planning import (
    CapabilityDispatch,
    JoinStrategy,
    PreparedTaskBatch,
    SubAgentDispatch,
    TaskBatchInput,
    TaskSpec,
)

from .models import AgentInvocation, PlannedWorkItem


def assemble_batch(
    batch_goal: str,
    items: Sequence[PlannedWorkItem],
    *,
    join_strategy: JoinStrategy = "partial_ok",
    max_concurrency: int | None = None,
    batch_metadata: Mapping[str, Any] | None = None,
    adapter_state: Mapping[str, Any] | None = None,
) -> PreparedTaskBatch:
    """Create the sole preparation/runtime handoff without source-specific logic."""
    tasks = tuple(_task_spec(item) for item in items)
    description = batch_goal.strip() or f"Run {len(tasks)} prepared task(s)"
    return PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=tasks,
            join_strategy=join_strategy,
            max_concurrency=max_concurrency,
            description=description,
        ),
        batch_metadata=dict(batch_metadata or {}),
        adapter_state=dict(adapter_state or {}),
    )


def _task_spec(item: PlannedWorkItem) -> TaskSpec:
    source = item.source
    if isinstance(item.decision, AgentInvocation):
        dispatch = SubAgentDispatch(
            profile_id=item.decision.profile_id,
            capability_grants=list(item.decision.capability_grants),
            max_model_turns=item.decision.max_model_turns,
        )
    else:
        dispatch = CapabilityDispatch(capability_id=item.decision.capability_id)

    metadata = dict(source.metadata)
    if item.rationale:
        preparation = metadata.setdefault("preparation", {})
        if not isinstance(preparation, dict):
            raise ValueError(f"work item {source.item_id!r} metadata.preparation must be an object")
        preparation["rationale"] = item.rationale
    task = TaskSpec(
        task_id=source.item_id,
        title=(item.title or source.title or source.goal[:80]).strip()[:80],
        instructions=source.goal,
        dispatch=dispatch,
        args=dict(source.params),
        metadata=metadata,
        required_sandbox=list(item.required_sandbox),
        stage=item.stage,
    )
    if item.selected_sandbox:
        task.set_selected_sandbox(item.selected_sandbox)
    return task
