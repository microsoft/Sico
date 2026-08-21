"""Run one scenario against a live stack and report everything that looks wrong.

Checks come in two kinds: invariants that must hold for every turn (no internal
identifiers in user-visible text, no dangling lifecycle rows) and expectations
the scenario declares. Every check returns a list rather than raising, so a
failing scenario reports all of its problems at once instead of only the first.

Given a :class:`Transcript` the checks are pure, which is what ``test_checks.py``
exercises without a stack.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from .client import ChatClient, SseEvent
from .scenarios import Scenario

LeakRule = tuple[str, re.Pattern[str]]


def _literal(*values: str) -> re.Pattern[str]:
    """Match these strings exactly. Capitalisation in a UI label is part of the signal."""
    return re.compile("|".join(re.escape(value) for value in values))


@dataclass
class Transcript:
    """Everything one chat turn produced, as observed from outside the stack."""

    events: list[SseEvent] = field(default_factory=list)
    final_content: str = ""
    turn_id: int | None = None
    conversation_id: int | None = None
    duration_s: float = 0.0
    first_event_s: float | None = None
    plan: dict[str, Any] | None = None
    batches: list[dict[str, Any]] = field(default_factory=list)


# Text that must never reach the user, whatever the scenario asked for.
FINAL_CONTENT_LEAKS: tuple[LeakRule, ...] = (
    (
        "final answer surfaces the trajectory instead of keeping it inside the execution summary",
        _literal("Trajectory:", "trajectory URL"),
    ),
    ("final answer appends a separate metrics report link", _literal("Metrics report:")),
    (
        "final answer leaks task-runtime stale-worker internals",
        re.compile(r"\bStaleWorkerError\b|stale worker token", re.IGNORECASE),
    ),
    (
        "final answer leaks internal error classification labels",
        re.compile(r"\b(transient|skill_runtime|sandbox_unhealthy|sandbox_no_capacity)\b", re.IGNORECASE),
    ),
)

PLAN_LEAKS: tuple[LeakRule, ...] = (
    (
        "plan leaks low-level android_tester command details",
        _literal("android_tester.__main__", "python -m android_tester run"),
    ),
    ("plan leaks low-level Command/Entrypoint labels", _literal("Command:", "Entrypoint:")),
    ("plan leaks raw runner JSON event output as a case summary", _literal('Summary: {"event"', "Summary: {'event'")),
    ("plan labels the delegate execution summary as a batch report", re.compile("batch report:", re.IGNORECASE)),
    ("plan leaks task-runtime stale-worker internals", re.compile(r"\bStaleWorkerError\b|stale worker token", re.IGNORECASE)),
    ("workspace preparation row includes execution-running wording", re.compile(r"Prepare workspace[^\n\r)]*running")),
    (
        "sandbox preparation row includes execution-running wording",
        re.compile(r"(?:Prepare|Allocating|Resetting) [^\n\r)]*sandbox[^\n\r)]*Executing"),
    ),
    (
        "batch finalization row reports released sandboxes before completed cases",
        re.compile(r"Collect results and release [^\n\r)]*sandbox[^\n\r)]*released[^\n\r)]*0/\d+ .* finished"),
    ),
    ("plan uses ambiguous attempt count copy", re.compile(r"尝试次数：\d+/\d+")),
)

_ACTIVE_LIFECYCLE_STATUSES = {0, 1, 2}
_TERMINAL_TASK_PREFIXES = (
    "Android test completed:",
    "Android test failed:",
    "Skill task completed:",
    "Skill task failed:",
    "Skill task cancelled:",
    "Skill task timed out:",
    "Skill task blocked:",
    "Task completed:",
    "Task failed:",
    "Task cancelled:",
    "Task timed out:",
    "Task blocked:",
)
_TERMINAL_BATCH_STATUSES = {"completed", "partial", "failed", "blocked", "timed_out", "cancelled"}


def run_scenario(client: ChatClient, scenario: Scenario, agent_instance_id: int) -> list[str]:
    try:
        transcript = capture(client, scenario, agent_instance_id)
    except Exception as exc:  # noqa: BLE001 - a transport failure is a scenario finding, not a crash.
        return [f"exception: {type(exc).__name__}: {exc}"]

    findings = check_stream(transcript) + check_final_content(transcript, scenario)
    if transcript.turn_id is None:
        return [*findings, "SSE did not include a turnId"]
    return findings + check_plan(transcript, scenario) + check_batches(transcript, scenario) + check_timing(transcript, scenario)


def capture(client: ChatClient, scenario: Scenario, agent_instance_id: int) -> Transcript:
    started = time.perf_counter()
    events = client.stream_chat(scenario.message, agent_instance_id, timeout=int(scenario.max_seconds))
    content, turn_id, conversation_id = parse_stream(events)
    transcript = Transcript(
        events=events,
        final_content=content,
        turn_id=turn_id,
        conversation_id=conversation_id,
        duration_s=time.perf_counter() - started,
        first_event_s=next((elapsed for name, _data, elapsed in events if name != "keepalive"), None),
    )
    if turn_id is None:
        return transcript
    if conversation_id:
        transcript.batches = client.batch_summaries(conversation_id=conversation_id, turn_id=turn_id)
    transcript.plan = client.plan(agent_instance_id=agent_instance_id, turn_id=turn_id, conversation_id=conversation_id or 0)
    return transcript


def parse_stream(events: list[SseEvent]) -> tuple[str, int | None, int | None]:
    """Assembled answer text plus the turn and conversation ids the stream carried."""
    chunks: list[str] = []
    turn_id: int | None = None
    conversation_id: int | None = None
    for _name, data, _elapsed in events:
        if not data:
            continue
        try:
            item = json.loads(data)
        except json.JSONDecodeError:
            continue
        if turn_id is None and item.get("turnId"):
            turn_id = int(item["turnId"])
        if conversation_id is None and item.get("conversationId"):
            conversation_id = int(item["conversationId"])
        if isinstance(item.get("content"), str):
            chunks.append(item["content"])
    return "".join(chunks), turn_id, conversation_id


def check_stream(transcript: Transcript) -> list[str]:
    if not transcript.events:
        return ["SSE returned no events"]
    findings = []
    names = {name for name, _data, _elapsed in transcript.events}
    if "done" not in names:
        findings.append("SSE missing done event")
    if "error" in names:
        findings.append("SSE emitted error event")
    return findings


def check_final_content(transcript: Transcript, scenario: Scenario) -> list[str]:
    content = transcript.final_content
    if not content.strip():
        return ["final answer is empty"]
    lowered = content.lower()
    findings = _leak_findings(content, FINAL_CONTENT_LEAKS)
    findings += [
        f"final answer missing expected text: {marker}"
        for marker in scenario.expected_final_text
        if marker.lower() not in lowered
    ]
    if scenario.forbidden_final_pattern and re.search(scenario.forbidden_final_pattern, content, re.IGNORECASE | re.DOTALL):
        findings.append("final answer matched the scenario's forbidden pattern")
    if scenario.max_final_chars is not None and len(content) > scenario.max_final_chars:
        findings.append(f"final answer is {len(content)} chars, expected at most {scenario.max_final_chars}")
    return findings


def check_plan(transcript: Transcript, scenario: Scenario) -> list[str]:
    if not transcript.plan:
        return ["plan endpoint returned no JSON"]
    steps = transcript.plan.get("data", {}).get("plan", {}).get("steps") or []
    tool_calls = _flatten_tool_calls(steps)
    called = {_builtin_tool_name(tool_call) for tool_call in tool_calls}

    findings = []
    forbidden = sorted(called & set(scenario.forbidden_tool_names))
    if forbidden:
        findings.append(f"plan called forbidden tool(s): {', '.join(forbidden)}")
    # No scenario in this suite attaches a file, so any parse is unprompted work.
    if "parse_document" in called:
        findings.append("plan parsed a document although the scenario attached none")

    serialized = json.dumps(transcript.plan, ensure_ascii=False)
    lowered = serialized.lower()
    findings += _leak_findings(serialized, PLAN_LEAKS)
    findings += [
        f"plan missing expected text: {marker}"
        for marker in scenario.expected_plan_text
        if marker.lower() not in lowered
    ]
    findings += [
        f"plan includes forbidden text: {marker}"
        for marker in scenario.forbidden_plan_text
        if marker.lower() in lowered
    ]
    if scenario.expect_batch:
        if "run_task" not in serialized:
            findings.append("plan does not show run_task for a delegated scenario")
        if "Skipped source read for normal execution" in serialized:
            findings.append("normal task execution still attempted to read skill source")
    return findings + _lifecycle_findings(tool_calls)


def check_batches(transcript: Transcript, scenario: Scenario) -> list[str]:
    if scenario.expect_batch and not transcript.batches:
        return ["expected a delegated batch, but none was persisted"]
    findings = []
    max_batches = scenario.max_batches if scenario.max_batches is not None else (1 if scenario.expect_batch else None)
    if max_batches is not None and len(transcript.batches) > max_batches:
        findings.append(f"expected at most {max_batches} batch(es), got {len(transcript.batches)}")
    if scenario.min_batch_total is not None:
        largest = max((int(batch.get("totalCount") or 0) for batch in transcript.batches), default=0)
        if largest < scenario.min_batch_total:
            findings.append(f"expected a batch with at least {scenario.min_batch_total} task(s), largest had {largest}")
    for batch in transcript.batches:
        batch_id, status = batch.get("batchId"), batch.get("status")
        if status not in _TERMINAL_BATCH_STATUSES:
            findings.append(f"batch {batch_id} has non-terminal status {status}")
        elif scenario.expect_batch and status not in {"completed", "partial"}:
            findings.append(f"batch {batch_id} ended with {status}")
    return findings


def check_timing(transcript: Transcript, scenario: Scenario) -> list[str]:
    findings = []
    if transcript.duration_s > scenario.max_seconds:
        findings.append(f"scenario exceeded max_seconds={scenario.max_seconds:.0f}")
    # A delegated turn pays for an intent-check call plus a planner call before the
    # first persisted event, so it gets a looser budget than a plain reply.
    budget = 45.0 if scenario.expect_batch else 20.0
    if transcript.first_event_s is not None and transcript.first_event_s > budget and not scenario.slow_first_event_ok:
        findings.append(f"first SSE event is slow ({transcript.first_event_s:.2f}s, budget {budget:.0f}s)")
    return findings


def _leak_findings(text: str, rules: tuple[LeakRule, ...]) -> list[str]:
    return [message for message, pattern in rules if pattern.search(text)]


def _lifecycle_findings(tool_calls: list[dict[str, Any]]) -> list[str]:
    findings = []
    for tool_call in tool_calls:
        message = str(tool_call.get("message") or "")
        statuses = {item.get("status") for item in tool_call.get("runningList") or [] if isinstance(item, dict)}
        if not statuses & _ACTIVE_LIFECYCLE_STATUSES:
            continue
        if message.startswith("Finished "):
            findings.append("finished batch parent still has pending/running lifecycle rows")
        elif message.startswith(_TERMINAL_TASK_PREFIXES):
            findings.append("terminal child task still has active lifecycle rows")
    return findings


def _flatten_tool_calls(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []

    def walk(tool_call: dict[str, Any]) -> None:
        flattened.append(tool_call)
        for child in tool_call.get("batchCalls") or []:
            if isinstance(child, dict):
                walk(child)

    for step in steps:
        for tool_call in step.get("toolCalls") or []:
            if isinstance(tool_call, dict):
                walk(tool_call)
    return flattened


def _builtin_tool_name(tool_call: dict[str, Any]) -> str:
    execution_info = tool_call.get("executionInfo")
    if isinstance(execution_info, dict) and execution_info.get("builtinToolName"):
        return str(execution_info["builtinToolName"])
    return str(tool_call.get("toolName") or "")
