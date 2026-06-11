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

"""Tests for ``TaskManager.submit_prepared``.

Validates that the new bypass-normalization API correctly executes prepared
batches and preserves caller-supplied ``batch_metadata`` verbatim."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.artifact_store import FileArtifactStore
from app.biz.task_runtime.executors.command_backend import LocalBackend
from app.biz.task_runtime.models import PreparedTaskBatch, TaskBatchInput
from app.biz.task_runtime.executors.tool_executor import ToolExecutor
from app.biz.task_runtime.manager import TaskManager
from app.biz.task_runtime.models import TaskSpec, ToolDispatch
from app.biz.task_runtime.store import FileRunStore
from app.schemas.conversation.plan import Plan
from app.biz.task_runtime.context import TurnContext
from app.tools.plan import PlanEditor


class _FakePlanEditor(PlanEditor):
    def __init__(self) -> None:
        self.plan: Plan | None = None
        self.next_tool_call_id = 0
        self.messages: dict[int, str] = {}
        self.deliverables: dict[int, list] = {}
        self.cancelled = False

    async def get_plan(self) -> Plan | None:
        return self.plan

    async def update_plan(self, plan: Plan) -> None:
        self.plan = plan

    async def create_tool_call(
        self,
        name,
        initial_message,
        execution_info=None,
        parent_tool_call_id=None,
        sub_call_index=0,
        display=None,
        tool_call_status=None,
    ):
        self.next_tool_call_id += 1
        self.messages[self.next_tool_call_id] = initial_message
        return self.next_tool_call_id

    async def update_tool_call_message(self, tool_call_id: int, message: str):
        self.messages[tool_call_id] = message
        return None

    async def update_tool_call(self, tool_call_id: int, updater):
        tool_call = SimpleNamespace(
            deliverables=self.deliverables.get(tool_call_id, []),
            tool_call_status=self.statuses.get(tool_call_id) if hasattr(self, "statuses") else None,
            execution_info=SimpleNamespace(
                task_runtime=SimpleNamespace(
                    current_stage="",
                    sandbox_id="",
                    sandbox_type="",
                    sandbox_endpoint="",
                    attempt=0,
                    max_attempts=0,
                    latest_progress_message="",
                )
            ),
        )
        updater(tool_call)
        self.deliverables[tool_call_id] = tool_call.deliverables
        return tool_call

    async def is_plan_cancelled(self) -> bool:
        return self.cancelled


def _turn_context() -> TurnContext:
    return TurnContext(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        conversation_id=1,
        turn_id=1,
        plan_editor=_FakePlanEditor(),
    )


def _echo_task(task_id: str, message: str) -> TaskSpec:
    return TaskSpec(
        task_id=task_id,
        title=f"Echo {task_id}",
        dispatch=ToolDispatch(tool_name="echo"),
        args={"message": message},
    )


def _tool_executor(tmp_path: Path) -> ToolExecutor:
    return ToolExecutor(
        artifact_store=FileArtifactStore(tmp_path / "artifacts"),
        sandbox_backend=LocalBackend(),
    )


@pytest.mark.asyncio
async def test_submit_prepared_executes_prepared_echo_batch(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "hello"), _echo_task("task-2", "world")),
            join_strategy="partial_ok",
            description="Prepared echo batch.",
        ),
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    assert result.completed_count == 2
    assert result.failed_count == 0


@pytest.mark.asyncio
async def test_submit_prepared_preserves_caller_supplied_batch_metadata(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "ok"),),
            description="Single task.",
        ),
        batch_metadata={"source": "request-builder", "trace_id": "abc-123"},
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    batch = await manager.store.get_batch(result.batch_id)
    assert batch is not None
    assert batch.metadata["source"] == "request-builder"
    assert batch.metadata["trace_id"] == "abc-123"


@pytest.mark.asyncio
async def test_submit_prepared_uses_caller_join_strategy(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "fast"),),
            join_strategy="first_success",
            description="First-success batch.",
        ),
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    assert result.completed_count == 1
