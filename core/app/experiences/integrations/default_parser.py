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

"""Default digital-worker (DW) trajectory parser.

Builds one ``TrajectoryData`` from a run's captured stdout (``result.output``)
for **any** DW skill, without assuming the DW's event names or field schema. It
is registered as the registry default, so every skill run learns unless a skill
opts into a custom parser.

Two routes, chosen automatically:

- **Structured** — when stdout carries recognizable agent-loop events (a step
  with thought/action, and/or a terminal result event), each step is mapped into
  the renderer's slots (thought / action / outcome / ...). This is the shape the
  Reflector reads best.
- **Text** — when stdout has no recognizable structure (or is not JSONL), the
  cleaned stdout is kept verbatim as ``raw_trace`` so the Reflector still learns.
  A DW therefore does not have to emit any particular field/slot to be learnable.

Events are classified by **field presence**, not by an ``event`` label, so a DW
is free to name its events anything. Scalars (task / success / final output /
duration) come from the terminal result event when present, falling back to the
operator text and finally the runtime ``run`` / ``result``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.experiences.runner import TrajectoryData, TrajectoryStep

from .dw_registry import register_default_parser

if TYPE_CHECKING:
    from app.biz.task_runtime.models import TaskResult, TaskRun


logger = logging.getLogger(__name__)

_STEP_KEYS = ("step", "step_number")
_TASK_ID_KEYS = ("task_id",)
_SUCCESS_STATUSES = {"completed", "complete", "success", "succeeded", "pass", "passed", "done"}

# Classification by field presence, in order. Image is last so a step line with
# an inline url keeps its real role. Duration is not a terminal signal.
_TERMINAL_KEYS = ("status", "verdict", "success", "reason", "instruction")
_REFLECTOR_KEYS = ("outcome", "what_happened", "progress", "next_goal", "observation")
_OPERATOR_KEYS = ("thought", "thinking", "action", "action_type", "args", "parameters", "conclusion")
_IMAGE_KEYS = ("image", "image_url", "image_path", "screenshot_url")

_MAX_RAW_TRACE_CHARS = 50_000

# When fewer than half the event lines are recognized the schema is treated as
# foreign and the run learns from its raw log rather than a degenerate skeleton.
_MIN_RECOGNITION_RATIO = 0.5


def parse_trajectory(
    run_dir: "Path",
    run: "TaskRun",
    result: "TaskResult",
) -> list[TrajectoryData]:
    """Build one ``TrajectoryData`` from the run's captured stdout.

    The task runtime streams a skill's stdout into ``TaskResult.output`` (one
    JSONL event per line). Missing, empty, malformed, or unrelated lines are
    tolerated. Returns an empty list only when there is nothing to learn from.
    """
    stdout = result.output or ""
    objects = _parse_dict_lines(stdout)
    text = stdout
    if not any(_role(obj) is not None for obj in objects):
        file_objects, file_text = _read_event_files(run_dir)
        if file_objects or file_text:
            objects, text = file_objects, file_text
    trajectory = _build_trajectory(objects, run, result, text)
    return [trajectory] if trajectory is not None else []


def _read_event_files(run_dir: "Path | None") -> tuple[list[dict[str, Any]], str]:
    if run_dir is None:
        return [], ""
    try:
        paths = sorted(run_dir.glob("**/events.jsonl"))
    except OSError:
        return [], ""
    objects: list[dict[str, Any]] = []
    chunks: list[str] = []
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        chunks.append(text)
        objects.extend(_parse_dict_lines(text))
    return objects, "\n".join(chunks)


def _parse_dict_lines(text: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            objects.append(payload)
    return objects


def _below_recognition_floor(events: list[dict[str, Any]], objects: list[dict[str, Any]]) -> bool:
    return bool(objects) and len(events) < len(objects) * _MIN_RECOGNITION_RATIO


def _role(event: dict[str, Any]) -> str | None:
    if _has_any(event, _TERMINAL_KEYS):
        return "task_result"
    if _has_any(event, _REFLECTOR_KEYS):
        return "reflector"
    if _has_any(event, _OPERATOR_KEYS):
        return "operator"
    if _has_any(event, _IMAGE_KEYS):
        return "screenshot"
    return None


def _has_any(event: dict[str, Any], keys: tuple[str, ...]) -> bool:
    return any(key in event and event[key] not in (None, "") for key in keys)


def _step(event: dict[str, Any]) -> int | None:
    for key in _STEP_KEYS:
        parsed = _int_value(event.get(key))
        if parsed is not None:
            return parsed
    return None


def _int_value(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _build_trajectory(
    objects: list[dict[str, Any]],
    run: "TaskRun",
    result: "TaskResult",
    stdout: str,
) -> TrajectoryData | None:
    skill_name = _skill_name(run)
    events = [obj for obj in objects if _role(obj) is not None]
    operator_events = _events(events, "operator")
    task_result_events = _events(events, "task_result")
    task_result_event = task_result_events[-1] if task_result_events else None
    step_groups = _group_step_events(events)

    # Foreign or unstructured schema -> TEXT ROUTE so the DW still learns.
    if _below_recognition_floor(events, objects) or (not step_groups and task_result_event is None):
        return _build_text_trajectory(stdout, run, result, skill_name)

    screenshots_by_step = _by_step(events, "screenshot")

    steps: list[TrajectoryStep] = []
    for index, (step_number, group) in enumerate(step_groups, start=1):
        operator = _pick(group, _OPERATOR_KEYS)
        reflector = _pick(group, _REFLECTOR_KEYS)
        screenshot = screenshots_by_step.get(step_number) if step_number is not None else None
        steps.append(_build_step(index, operator, reflector, screenshot))
    if not steps and task_result_event is not None:
        steps.append(_build_task_result_step(task_result_event))

    task_text, task_id = _resolve_task_text(operator_events, task_result_event, run)
    success = _resolve_success(task_result_event)
    final_output, error = _resolve_outcome_text(task_result_event)
    duration_seconds = _resolve_duration(task_result_event, result)

    # No terminal event -> outcome undeclared: judge_result stays None and
    # success False so the Curator does not tag cited strategies helpful.
    judge_result = (
        TrajectoryData.build_judge_result(success, final_output or error or "")
        if task_result_event is not None
        else None
    )

    metadata = _base_metadata(run, skill_name)
    status = _status(task_result_event)
    if status:
        metadata["status"] = status
    if task_id is not None:
        metadata["task_id"] = task_id

    return TrajectoryData(
        task=task_text,
        success=success,
        total_steps=len(steps),
        chronological_steps=steps,
        final_output=final_output,
        error=error,
        duration_seconds=duration_seconds,
        agent_type=skill_name or "dw",
        metadata=metadata,
        judge_result=judge_result,
    )


def _build_text_trajectory(
    stdout: str,
    run: "TaskRun",
    result: "TaskResult",
    skill_name: str,
) -> TrajectoryData | None:
    """Fallback for DWs with no recognizable structure: learn from raw text.

    The capped stdout becomes ``raw_trace``; pass/fail follows the task runtime's
    ``result.status`` (the signal the scheduler reports) rather than per-step parsing.
    """
    raw = stdout.strip()
    if not raw:
        return None
    if len(raw) > _MAX_RAW_TRACE_CHARS:
        raw = raw[:_MAX_RAW_TRACE_CHARS].rstrip() + "\n...[truncated]"

    status = _runtime_status(result)
    metadata = _base_metadata(run, skill_name)
    metadata["status"] = status
    return TrajectoryData(
        task=_run_instruction(run),
        success=status in _SUCCESS_STATUSES,
        total_steps=0,
        chronological_steps=[],
        raw_trace=raw,
        final_output="",
        error=None,
        duration_seconds=_resolve_duration(None, result),
        agent_type=skill_name or "dw",
        metadata=metadata,
        judge_result=None,
    )


def _runtime_status(result: "TaskResult") -> str:
    status = getattr(result, "status", None)
    value = getattr(status, "value", status)
    return str(value).strip().lower() if value else "unknown"


def _base_metadata(run: "TaskRun", skill_name: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "run_id": getattr(run, "run_id", ""),
        "batch_id": getattr(run, "batch_id", ""),
    }
    if skill_name:
        metadata["skill_name"] = skill_name
    return metadata


def _events(events: list[dict[str, Any]], role: str) -> list[dict[str, Any]]:
    return [event for event in events if _role(event) == role]


def _by_step(events: list[dict[str, Any]], role: str) -> dict[int, dict[str, Any]]:
    by_step: dict[int, dict[str, Any]] = {}
    for event in _events(events, role):
        step = _step(event)
        if step is not None:
            by_step.setdefault(step, event)
    return by_step


def _group_step_events(events: list[dict[str, Any]]) -> list[tuple[int | None, list[dict[str, Any]]]]:
    """Group operator/reflector events sharing a ``step`` number into one step.

    Events without a step number each form their own group, in first-seen order.
    """
    ordered: list[tuple[int | None, list[dict[str, Any]]]] = []
    by_number: dict[int, list[dict[str, Any]]] = {}
    for event in events:
        if _role(event) not in ("operator", "reflector"):
            continue
        number = _step(event)
        if number is None:
            ordered.append((None, [event]))
            continue
        bucket = by_number.get(number)
        if bucket is None:
            bucket = []
            by_number[number] = bucket
            ordered.append((number, bucket))
        bucket.append(event)
    return ordered


def _pick(group: list[dict[str, Any]], keys: tuple[str, ...]) -> dict[str, Any] | None:
    return next((event for event in group if _has_any(event, keys)), None)


def _build_step(
    step_number: int,
    operator: dict[str, Any] | None,
    reflector: dict[str, Any] | None,
    screenshot: dict[str, Any] | None,
) -> TrajectoryStep:
    operator = operator or {}
    state: dict[str, Any] = {}
    results = _build_results(reflector, state)
    _add_screenshot_state(state, screenshot or _first_with_image((operator, reflector)))

    return TrajectoryStep(
        step_number=step_number,
        thought=_build_thought(operator, reflector),
        actions=_build_actions(operator),
        results=results,
        state=state,
    )


def _first_with_image(events: tuple[dict[str, Any] | None, ...]) -> dict[str, Any] | None:
    return next((event for event in events if event and _has_any(event, _IMAGE_KEYS)), None)


def _build_task_result_step(task_result: dict[str, Any]) -> TrajectoryStep:
    result_payload: dict[str, Any] = {}
    outcome = _first_text(task_result, ("status", "result", "outcome"))
    if outcome is not None:
        result_payload["outcome"] = outcome
    what_happened = _first_text(task_result, ("reason", "message", "summary", "content"))
    if what_happened is not None:
        result_payload["what_happened"] = what_happened
    return TrajectoryStep(
        step_number=1,
        results=[result_payload] if result_payload else [],
    )


def _build_thought(
    operator: dict[str, Any],
    reflector: dict[str, Any] | None,
) -> dict[str, str] | None:
    thought: dict[str, str] = {}
    thought_text = _first_text(operator, ("thought", "thinking", "summary"))
    if thought_text:
        thought["thinking"] = thought_text

    if reflector is not None:
        next_goal = _first_text(reflector, ("next_goal", "next"))
        if next_goal:
            thought["next_goal"] = next_goal

    return thought or None


def _build_actions(operator: dict[str, Any]) -> list[dict[str, Any]]:
    action_payload: dict[str, Any] = {}
    action_name = _first_text(operator, ("action", "action_type", "type"))
    if action_name is not None:
        action_payload["action_type"] = action_name
    if (args := operator.get("args", operator.get("parameters"))) is not None:
        action_payload["parameters"] = args
    conclusion = _first_text(operator, ("conclusion", "description"))
    if conclusion is not None:
        action_payload["conclusion"] = conclusion
    return [action_payload] if action_payload else []


def _build_results(
    reflector: dict[str, Any] | None,
    state: dict[str, Any],
) -> list[dict[str, Any]]:
    if reflector is None:
        return []

    result_payload: dict[str, Any] = {}
    outcome = _first_text(reflector, ("outcome", "status", "result"))
    if outcome is not None:
        result_payload["outcome"] = outcome
    what_happened = _first_text(reflector, ("what_happened", "observation", "description"))
    if what_happened is not None:
        result_payload["what_happened"] = what_happened
    progress = _first_text(reflector, ("progress",))
    if progress is not None:
        state["progress"] = progress
    return [result_payload] if result_payload else []


def _add_screenshot_state(
    state: dict[str, Any],
    screenshot: dict[str, Any] | None,
) -> None:
    if screenshot is None:
        return
    screenshot_url = _first_text(screenshot, _IMAGE_KEYS)
    if screenshot_url:
        state["screenshot"] = screenshot_url
    screenshot_description = _first_text(screenshot, ("description", "caption"))
    if screenshot_description:
        state["screenshot_description"] = screenshot_description


def _resolve_task_text(
    operator_events: list[dict[str, Any]],
    task_result_event: dict[str, Any] | None,
    run: "TaskRun",
) -> tuple[str, str | None]:
    task_id: str | None = None
    if task_result_event is not None:
        instruction = _first_text(task_result_event, ("instruction", "task_name", "title", "task"))
        candidate_task_id = _first_text(task_result_event, _TASK_ID_KEYS)
        if candidate_task_id is not None:
            task_id = candidate_task_id
        if instruction:
            return instruction, task_id
    for operator in operator_events:
        candidate_task_id = _first_text(operator, _TASK_ID_KEYS)
        if candidate_task_id is not None and task_id is None:
            task_id = candidate_task_id
        thought = _first_text(operator, ("thought", "thinking", "summary"))
        if thought:
            return thought, task_id
    return _run_instruction(run), task_id


def _resolve_success(task_result_event: dict[str, Any] | None) -> bool:
    status = _status(task_result_event)
    if status in _SUCCESS_STATUSES:
        return True
    if task_result_event is None:
        return False
    verdict = task_result_event.get("verdict")
    if isinstance(verdict, bool):
        return verdict
    if isinstance(verdict, str):
        return verdict.strip().lower() in {"true", "pass", "passed", "success", "succeeded"}
    success = task_result_event.get("success")
    if isinstance(success, bool):
        return success
    return False


def _resolve_outcome_text(
    task_result_event: dict[str, Any] | None,
) -> tuple[str, str | None]:
    """Final output + error from the in-band terminal event only.

    ``result.error_message`` (a generic "exited with N") is process noise and is
    not used: a DW finishing nonzero on purpose must not have it leak into the
    learning signal.
    """
    if task_result_event is None:
        return "", None
    reason_text = _first_text(task_result_event, ("reason", "message", "summary", "content")) or ""
    error_text = _first_text(task_result_event, ("error", "error_message"))
    return reason_text, error_text


def _status(task_result_event: dict[str, Any] | None) -> str:
    if task_result_event is None:
        return ""
    return str(task_result_event.get("status", task_result_event.get("result", ""))).strip().lower()


def _resolve_duration(task_result_event: dict[str, Any] | None, result: "TaskResult") -> float:
    if task_result_event is not None:
        duration = task_result_event.get("duration", task_result_event.get("duration_seconds"))
        if isinstance(duration, (int, float)) and not isinstance(duration, bool):
            return float(duration)
        duration_ms = task_result_event.get("duration_ms")
        if isinstance(duration_ms, (int, float)) and not isinstance(duration_ms, bool):
            return float(duration_ms) / 1000.0
    result_ms = getattr(result, "duration_ms", None)
    if isinstance(result_ms, (int, float)) and not isinstance(result_ms, bool):
        return float(result_ms) / 1000.0
    return 0.0


def _first_text(event: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = event.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def _skill_name(run: "TaskRun") -> str:
    spec = getattr(run, "spec", None)
    dispatch = getattr(spec, "dispatch", None)
    return getattr(dispatch, "skill_name", None) or getattr(run, "skill_name", "") or ""


def _run_instruction(run: "TaskRun") -> str:
    spec = getattr(run, "spec", None)
    args = getattr(spec, "args", None)
    inner = args.get("instructions") if isinstance(args, dict) else None
    if isinstance(inner, str) and inner.strip():
        return inner
    return getattr(spec, "instructions", None) or getattr(spec, "title", None) or ""


register_default_parser(parse_trajectory)
