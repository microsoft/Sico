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

"""Per-run helpers for the task_runtime rendering layer.

Translates a ``TaskRun`` lifecycle into the structured ``TaskRuntimeExecutionInfo``
fields (current stage + sandbox identity) consumed by the plan editor.
"""

from __future__ import annotations

from app.schemas.conversation.plan import ToolCallStatus

from ...models import (
    SANDBOX_PRE_EXECUTION_STAGES,
    SANDBOX_STAGE_ACQUIRE,
    SANDBOX_STAGE_CAPACITY_WAIT,
    SANDBOX_STAGE_READY,
    SANDBOX_STAGE_RESET,
)
from ...models import TaskResult, TaskRun, TaskStatus


# Canonical stage labels carried in ``TaskRuntimeExecutionInfo.current_stage``.
STAGE_PLAN = "plan"
STAGE_WORKSPACE = "workspace"
STAGE_SANDBOX = "sandbox"
STAGE_EXECUTE = "execute"
STAGE_UPLOAD = "upload"
STAGE_RELEASE = "release"


def tool_call_status_for_result(run: TaskRun, result: TaskResult) -> ToolCallStatus:
    """Map a run's terminal :class:`TaskResult` to a structured tool-call status."""
    retried = run.attempt > 1
    if result.status == TaskStatus.COMPLETED:
        return ToolCallStatus.RETRY_SUCCESSFUL if retried else ToolCallStatus.SUCCESSFUL
    return ToolCallStatus.RETRY_FAILED if retried else ToolCallStatus.FAILED


def current_stage_for_run(
    run: TaskRun,
    *,
    active_stage: str | None,
    terminal_result: TaskResult | None,
    sandbox_released: bool,
) -> str:
    """Compute the canonical ``current_stage`` value for a run's tool call."""
    if terminal_result is not None:
        if run.spec.required_sandbox and sandbox_released:
            return STAGE_RELEASE
        if terminal_result.primary_artifact is not None:
            return STAGE_UPLOAD
        return STAGE_EXECUTE
    return _stage_alias(active_stage) or STAGE_PLAN


def _stage_alias(stage: str | None) -> str | None:
    if stage in {"context", "skill"}:
        return STAGE_PLAN
    if stage in {"runner", "workspace"}:
        return STAGE_WORKSPACE
    if stage in {SANDBOX_STAGE_CAPACITY_WAIT, SANDBOX_STAGE_ACQUIRE, SANDBOX_STAGE_RESET, SANDBOX_STAGE_READY}:
        return STAGE_SANDBOX
    return stage


# ---------------------------------------------------------------------------
# Per-run state predicates (consumed by TaskManager + batch helpers).
# ---------------------------------------------------------------------------


def _run_sandbox_ready(run: TaskRun) -> bool:
    return run.sandbox is not None and not _run_resetting_sandbox(run)


def _run_resetting_sandbox(run: TaskRun) -> bool:
    return run.status == TaskStatus.RUNNING and run.sandbox is not None and run.runtime_stage == SANDBOX_STAGE_RESET


def _run_waiting_for_sandbox_capacity(run: TaskRun) -> bool:
    return run.status == TaskStatus.RUNNING and run.sandbox is None and run.runtime_stage == SANDBOX_STAGE_CAPACITY_WAIT


def _run_acquiring_sandbox(run: TaskRun) -> bool:
    if run.status != TaskStatus.RUNNING or run.sandbox is not None:
        return False
    return run.runtime_stage in {"", SANDBOX_STAGE_ACQUIRE}


def _run_execution_started(run: TaskRun) -> bool:
    if run.status != TaskStatus.RUNNING:
        return False
    if not run.spec.required_sandbox:
        return True
    if run.runtime_stage in SANDBOX_PRE_EXECUTION_STAGES:
        return False
    return run.sandbox is not None
