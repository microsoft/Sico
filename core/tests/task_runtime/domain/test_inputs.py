"""Tests for ``TaskBatchInput`` / ``PreparedTaskBatch`` — the planner ↔ pipeline
↔ manager handoff types."""

from __future__ import annotations

import dataclasses

import pytest

from app.biz.task_runtime.domain.models import PreparedTaskBatch, TaskBatchInput
from app.biz.task_runtime.domain.models import CapabilityDispatch, TaskSpec


def _spec(task_id: str = "t1") -> TaskSpec:
    return TaskSpec(task_id=task_id, title="Run echo", dispatch=CapabilityDispatch(capability_id="builtin:echo"))


def test_task_batch_input_defaults() -> None:
    batch = TaskBatchInput(tasks=(_spec(),))
    assert batch.join_strategy == "partial_ok"
    assert batch.max_concurrency is None
    assert batch.description == ""
    assert len(batch.tasks) == 1


def test_task_batch_input_rejects_empty_tasks() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        TaskBatchInput(tasks=())


def test_task_batch_input_rejects_non_positive_concurrency() -> None:
    with pytest.raises(ValueError, match="max_concurrency must be positive"):
        TaskBatchInput(tasks=(_spec(),), max_concurrency=0)


def test_task_batch_input_preserves_legacy_positional_description() -> None:
    batch = TaskBatchInput((_spec(),), "all_success", "Legacy description")

    assert batch.description == "Legacy description"
    assert batch.max_concurrency is None


def test_task_batch_input_is_frozen() -> None:
    batch = TaskBatchInput(tasks=(_spec(),))
    with pytest.raises(dataclasses.FrozenInstanceError):
        batch.description = "x"  # type: ignore[misc]


def test_prepared_task_batch_default_metadata_is_isolated() -> None:
    batch = TaskBatchInput(tasks=(_spec(),))
    prep_a = PreparedTaskBatch(batch=batch)
    prep_b = PreparedTaskBatch(batch=batch)

    # Defaulted dicts must be distinct instances, not a shared mutable singleton.
    assert prep_a.batch_metadata is not prep_b.batch_metadata
    prep_a.batch_metadata["x"] = 1
    assert "x" not in prep_b.batch_metadata


def test_prepared_task_batch_carries_pipeline_metadata() -> None:
    batch = TaskBatchInput(tasks=(_spec("t1"), _spec("t2")), join_strategy="all_success")
    prep = PreparedTaskBatch(batch=batch, batch_metadata={"workbook_source_path": "cases.xlsx"})

    assert prep.batch.join_strategy == "all_success"
    assert prep.batch_metadata["workbook_source_path"] == "cases.xlsx"
