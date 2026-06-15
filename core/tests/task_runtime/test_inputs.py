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

"""Tests for ``TaskBatchInput`` / ``PreparedTaskBatch`` — the planner ↔ pipeline
↔ manager handoff types."""

from __future__ import annotations

import dataclasses

import pytest

from app.biz.task_runtime.models import PreparedTaskBatch, TaskBatchInput
from app.biz.task_runtime.models import TaskSpec, ToolDispatch


def _spec(task_id: str = "t1") -> TaskSpec:
    return TaskSpec(task_id=task_id, title="Run echo", dispatch=ToolDispatch(tool_name="echo"))


def test_task_batch_input_defaults() -> None:
    batch = TaskBatchInput(tasks=(_spec(),))
    assert batch.join_strategy == "partial_ok"
    assert batch.description == ""
    assert len(batch.tasks) == 1


def test_task_batch_input_rejects_empty_tasks() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        TaskBatchInput(tasks=())


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
