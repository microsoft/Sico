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

"""Pure text/label builders for the task_runtime rendering layer.

Leaf module of the ``rendering`` subpackage. Functions here take domain objects
(``TaskSpec``, ``TaskRun``, ``BatchRecord``, ``BatchResult``, ``TaskResult``)
and return plain strings or lists of strings used by ``run_view`` /
``batch_view`` and by ``manager.py`` when assembling plan and tool-call
messages.

No side effects, no I/O, no dependencies on other rendering modules.
"""

from __future__ import annotations

from app.schemas.conversation.plan import ToolDeliverable, ToolDeliverableType

from ...models import PreparedTaskBatch
from ...models import (
    BatchRecord,
    BatchResult,
    BatchStatus,
    SandboxLeaseRef,
    TaskRun,
    TaskSpec,
)
from ...sandbox_types import SANDBOX_OSES
from .artifact_links import (
    _artifact_link_line,
)
from .renderers import renderer_for


RECOVERED_PARENT_MESSAGE_RESULT_PREFIX = "task_runtime_recovery_batch:"


# ---------------------------------------------------------------------------
# Recovered (post-crash) parent message helpers
# ---------------------------------------------------------------------------


def _recovered_parent_message_content(batch: BatchRecord, result: BatchResult) -> str:
    lines = [
        "Task execution finished after recovery.",
        "",
        f"- Status: {_recovered_batch_status_label(result.status)}",
        f"- Tasks: {_batch_result_counts(result)} ({result.total_count} total)",
    ]
    if batch.reason:
        lines.append(f"- Request: {batch.reason}")

    report_lines = []
    report_count = 0
    for item in result.results:
        if item.primary_artifact is None:
            continue
        report_count += 1
        if len(report_lines) >= 5:
            continue
        report_lines.append(f"- {_artifact_link_line(item.primary_artifact, run_label=True)}")
    if report_lines:
        lines.extend(["", "Run reports:", *report_lines])
        omitted = report_count - len(report_lines)
        if omitted > 0:
            lines.append(f"- {omitted} more run report(s) omitted.")
    return "\n".join(lines)


def _recovered_parent_message_result(batch_id: str) -> str:
    return f"{RECOVERED_PARENT_MESSAGE_RESULT_PREFIX}{batch_id}"


def _recovered_batch_status_label(status: BatchStatus) -> str:
    if status == BatchStatus.PARTIAL:
        return "completed with failed tasks"
    return status.value.replace("_", " ")


def _parent_tool_call_name(prepared: PreparedTaskBatch) -> str:
    _ = prepared
    return "Run Tasks"


def _python_module_entrypoint_label(module_name: str) -> str:
    return f"python module: {module_name}"


def _delegate_plan_title(prepared: PreparedTaskBatch) -> str:
    tasks = prepared.batch.tasks
    if len(tasks) != 1:
        return "Delegated Tasks"
    task = tasks[0]
    if plan_title := _task_display_value(task, "plan_title"):
        return plan_title
    if task.kind == "skill":
        return "Skill Task"
    return "Task"


def _delegate_plan_step_title(prepared: PreparedTaskBatch) -> str:
    tasks = prepared.batch.tasks
    if len(tasks) != 1:
        title = _common_task_display_value(list(tasks), "batch_step_title")
        if not title and _batch_sandbox_type(prepared):
            title = "Run delegated tasks and record progress"
        return title or "Run delegated tasks"
    task = tasks[0]
    title = _task_display_value(task, "single_step_title")
    if not title and task.kind == "skill":
        title = "Run skill task"
    return title or "Run task"


# ---------------------------------------------------------------------------
# Task display / metadata accessors
# ---------------------------------------------------------------------------


def _task_context_lines(task: TaskSpec) -> list[str]:
    lines: list[str] = []
    context = renderer_for(task).context_line(task)
    if context:
        lines.append(context)
    lines.extend(_environment_lines(task))
    return lines


def _task_display_value(task: TaskSpec, key: str) -> str:
    display = task.metadata.get("display")
    if isinstance(display, dict):
        value = display.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    capability = task.metadata.get("capability")
    if isinstance(capability, dict):
        capability_display = capability.get("display")
        if isinstance(capability_display, dict):
            value = capability_display.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _common_task_display_value(tasks: list[TaskSpec] | tuple[TaskSpec, ...], key: str) -> str:
    values = {_task_display_value(task, key) for task in tasks}
    values.discard("")
    return next(iter(values)) if len(values) == 1 else ""


def _task_display_map(task: TaskSpec) -> dict[str, str]:
    """Return the merged display map (task metadata + capability) for a task.

    The frontend consumes this map directly to render generic labels instead of
    pattern-matching ``ToolCall.message`` for keywords like ``android``.
    """
    merged: dict[str, str] = {}
    capability = task.metadata.get("capability")
    if isinstance(capability, dict):
        capability_display = capability.get("display")
        if isinstance(capability_display, dict):
            for key, value in capability_display.items():
                if isinstance(key, str) and isinstance(value, str) and value.strip():
                    merged[key.strip()] = value.strip()
    display = task.metadata.get("display")
    if isinstance(display, dict):
        for key, value in display.items():
            if isinstance(key, str) and isinstance(value, str) and value.strip():
                merged[key.strip()] = value.strip()
    return merged


def _common_task_display_map(tasks: list[TaskSpec] | tuple[TaskSpec, ...]) -> dict[str, str]:
    """Intersect display maps across a batch, keeping only keys with one shared value."""
    if not tasks:
        return {}
    maps = [_task_display_map(task) for task in tasks]
    if not maps:
        return {}
    shared_keys: set[str] = set(maps[0].keys())
    for other in maps[1:]:
        shared_keys &= other.keys()
    result: dict[str, str] = {}
    for key in shared_keys:
        values = {m[key] for m in maps}
        if len(values) == 1:
            result[key] = next(iter(values))
    return result


def _common_run_display_value(runs: list[TaskRun], key: str) -> str:
    values = {_task_display_value(run.spec, key) for run in runs}
    values.discard("")
    return next(iter(values)) if len(values) == 1 else ""


def _environment_lines(task: TaskSpec) -> list[str]:
    if environment_label := _task_display_value(task, "environment_label"):
        return [f"Environment: {environment_label}"]
    if task.required_sandbox:
        return [f"Environment: {task.required_sandbox} sandbox"]
    return []


# ---------------------------------------------------------------------------
# Sandbox identity / lifecycle text builders
# ---------------------------------------------------------------------------


def _sandbox_display_name(sandbox: SandboxLeaseRef) -> str:
    identity = _sandbox_identity_label(sandbox)
    return f"{sandbox.type} sandbox ({identity})" if identity else f"{sandbox.type} sandbox"


def _sandbox_identity_label(sandbox: SandboxLeaseRef) -> str:
    if sandbox.device_id:
        return f"device {sandbox.device_id}"
    if sandbox.sandbox_id:
        return f"sandbox {sandbox.sandbox_id}"
    return ""


def _sandbox_ready_message(run: TaskRun) -> str:
    display_label = _task_display_value(run.spec, "sandbox_ready_label")
    if run.sandbox is None:
        if display_label:
            return display_label
        return _sandbox_message(run, "ready")
    identity = _sandbox_identity_label(run.sandbox)
    if display_label:
        return f"{display_label}: {identity}" if identity else display_label
    ready_message = _sandbox_message(run, "ready")
    return f"{ready_message}: {identity}" if identity else ready_message


def _sandbox_capacity_wait_message(run: TaskRun) -> str:
    return _sandbox_message(run, "Waiting for") + " capacity"


def _sandbox_allocate_message(run: TaskRun) -> str:
    return _sandbox_message(run, "Allocating")


def _sandbox_reset_message(run: TaskRun) -> str:
    return _sandbox_message(run, "Resetting")


def _sandbox_release_message(run: TaskRun) -> str:
    release_label = _task_display_value(run.spec, "sandbox_release_label")
    return release_label or _sandbox_message(run, "released")


def _sandbox_releasing_message(run: TaskRun) -> str:
    releasing_label = _task_display_value(run.spec, "sandbox_releasing_label")
    if releasing_label:
        return releasing_label
    sandbox_label = _task_display_value(run.spec, "sandbox_label") or f"{run.spec.required_sandbox or 'sandbox'} sandbox"
    return f"Releasing {sandbox_label}"


def _sandbox_message(run: TaskRun, action: str) -> str:
    sandbox_label = _task_display_value(run.spec, "sandbox_label")
    if not sandbox_label:
        sandbox_label = f"{run.spec.required_sandbox or 'sandbox'} sandbox"
    if action == "ready":
        return f"{sandbox_label} ready"
    if action == "released":
        return f"{sandbox_label} released"
    return f"{action} {sandbox_label}"


# ---------------------------------------------------------------------------
# Execution command / runner labels
# ---------------------------------------------------------------------------


def _execution_command_hint(run: TaskRun) -> str:
    if runner_label := _task_display_value(run.spec, "runner_label"):
        return runner_label
    return renderer_for(run.spec).command_hint(run.spec)


def _execution_runner_label(run: TaskRun) -> str:
    if runner_label := _task_display_value(run.spec, "runner_label"):
        return runner_label
    return ""


def _acquired_sandbox_deliverable_id(deliverable: ToolDeliverable) -> str:
    if deliverable.type != ToolDeliverableType.ACQUIRED_SANDBOX:
        return ""
    return deliverable.acquired_sandbox.sandbox_id or ""


def _execution_entrypoint_hint(run: TaskRun) -> str:
    raw_argv = run.spec.args.get("argv")
    if isinstance(raw_argv, list) and all(isinstance(item, str) for item in raw_argv):
        return _entrypoint_from_argv(raw_argv)
    return ""


def _entrypoint_from_argv(argv: list[str]) -> str:
    try:
        module_index = argv.index("-m")
    except ValueError:
        return ""
    if module_index + 1 >= len(argv):
        return ""
    return _python_module_entrypoint_label(argv[module_index + 1])


# ---------------------------------------------------------------------------
# Batch result counts
# ---------------------------------------------------------------------------


def _batch_result_counts(result: BatchResult) -> str:
    parts = []
    if result.completed_count:
        parts.append(f"{result.completed_count} completed")
    if result.failed_count:
        parts.append(f"{result.failed_count} failed")
    if result.blocked_count:
        parts.append(f"{result.blocked_count} blocked")
    if result.timed_out_count:
        parts.append(f"{result.timed_out_count} timed out")
    if result.cancelled_count:
        parts.append(f"{result.cancelled_count} cancelled")
    return ", ".join(parts) or "no results"


# ---------------------------------------------------------------------------
# Plural / count / label utilities
# ---------------------------------------------------------------------------


def _plural(word: str, count: int) -> str:
    if count == 1:
        return word
    irregular = {"sandbox": "sandboxes"}
    return irregular.get(word, f"{word}s")


def _plural_verb(singular: str, plural: str, count: int) -> str:
    return singular if count == 1 else plural


def _sandbox_pool_count_label(count: int, label: str) -> str:
    return f"{count} {label} in this agent pool"


def _plain_sandbox_label(sandbox_type: str, *, plural: bool) -> str:
    return f"{sandbox_type} sandboxes" if plural else f"{sandbox_type} sandbox"


def _batch_sandbox_label(sandbox_type: str | None, runs: list[TaskRun], *, plural: bool) -> str:
    display_key = "sandbox_label_plural" if plural else "sandbox_label"
    if label := _common_run_display_value(runs, display_key):
        return label
    if not sandbox_type:
        return "sandboxes" if plural else "sandbox"
    return _plain_sandbox_label(sandbox_type, plural=plural)


def _batch_subject_label(
    sandbox_type: str | None,
    sandbox_task_count: int,
    total_count: int,
    runs: list[TaskRun] | None = None,
) -> str:
    if runs:
        singular = _common_run_display_value(runs, "batch_subject_singular")
        plural = _common_run_display_value(runs, "batch_subject_plural")
        if total_count == 1 and singular:
            return singular
        if total_count != 1 and plural:
            return plural
    return "delegated task" if total_count == 1 else "delegated tasks"


def _batch_sandbox_type(prepared: PreparedTaskBatch) -> str | None:
    sandbox_types = {task.required_sandbox for task in prepared.batch.tasks if task.required_sandbox}
    if len(sandbox_types) == 1:
        return next(iter(sandbox_types))

    for sandbox_os in SANDBOX_OSES:
        if sandbox_os in sandbox_types:
            return sandbox_os

    return None


def _finished_progress_label(finished: int, total: int, completed: int, failed: int, cancelled: int) -> str:
    label = f"{finished}/{total} finished"
    details: list[str] = []
    if completed:
        details.append(f"{completed} passed")
    if failed:
        details.append(f"{failed} failed")
    if cancelled:
        details.append(f"{cancelled} cancelled")
    if not details:
        return label
    return f"{label} ({', '.join(details)})"


def _case_range(start: int, end: int) -> str:
    if start == end:
        return f"case {start}"
    return f"cases {start}-{end}"


def _case_count(count: int) -> str:
    return f"{count} {_plural('case', count)}"
