"""Unit tests for the acceptance checks.

These need no stack: they build transcripts by hand and assert what the checks
report. Without them the 250 lines of judgement in ``runner.py`` would only ever
execute on a machine with the whole system running, which is where the old
acceptance script rotted.
"""

from __future__ import annotations

import pytest

from .runner import (
    Transcript,
    check_batches,
    check_final_content,
    check_plan,
    check_stream,
    check_timing,
    parse_stream,
)
from .scenarios import ANDROID_TESTER, EXECUTION_TOOLS, Scenario


def _scenario(**overrides: object) -> Scenario:
    return Scenario(name="probe", agent_role=ANDROID_TESTER, message="probe", **overrides)  # type: ignore[arg-type]


def _plan(*tool_calls: dict[str, object]) -> dict[str, object]:
    return {"data": {"plan": {"steps": [{"toolCalls": list(tool_calls)}]}}}


def _event(payload: str, *, name: str = "message", elapsed: float = 0.1) -> tuple[str, str, float]:
    return (name, payload, elapsed)


# --- parse_stream -----------------------------------------------------------


def test_parse_stream_joins_content_and_takes_the_first_ids() -> None:
    content, turn_id, conversation_id = parse_stream(
        [
            _event('{"turnId": 7, "conversationId": 3, "content": "he"}'),
            _event('{"turnId": 9, "content": "llo"}'),
        ]
    )
    assert (content, turn_id, conversation_id) == ("hello", 7, 3)


def test_parse_stream_ignores_payloads_that_are_not_json() -> None:
    assert parse_stream([_event("not json"), _event(""), _event('{"content": "ok"}')]) == ("ok", None, None)


# --- check_stream -----------------------------------------------------------


def test_a_stream_without_events_is_a_finding() -> None:
    assert check_stream(Transcript()) == ["SSE returned no events"]


def test_a_stream_needs_a_done_event_and_no_error_event() -> None:
    findings = check_stream(Transcript(events=[_event("{}", name="error")]))
    assert findings == ["SSE missing done event", "SSE emitted error event"]


def test_a_complete_stream_reports_nothing() -> None:
    assert check_stream(Transcript(events=[_event("{}"), _event("{}", name="done")])) == []


# --- check_final_content ----------------------------------------------------


@pytest.mark.parametrize("content", ["", "   \n "])
def test_an_empty_answer_is_a_finding_on_its_own(content: str) -> None:
    # No scenario declares expected text for a greeting, so nothing else would catch this.
    assert check_final_content(Transcript(final_content=content), _scenario()) == ["final answer is empty"]


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("see Trajectory: /x", "final answer surfaces the trajectory instead of keeping it inside the execution summary"),
        ("the trajectory URL is /x", "final answer surfaces the trajectory instead of keeping it inside the execution summary"),
        ("Metrics report: /x", "final answer appends a separate metrics report link"),
        ("hit a StaleWorkerError", "final answer leaks task-runtime stale-worker internals"),
        ("classified as sandbox_unhealthy", "final answer leaks internal error classification labels"),
    ],
)
def test_internal_wording_never_reaches_the_user(content: str, expected: str) -> None:
    assert expected in check_final_content(Transcript(final_content=content), _scenario())


def test_one_rule_reports_once_even_when_several_of_its_triggers_match() -> None:
    transcript = Transcript(final_content="Trajectory: /a and the trajectory URL /b")
    assert len(check_final_content(transcript, _scenario())) == 1


def test_expected_text_is_matched_case_insensitively() -> None:
    transcript = Transcript(final_content="Acceptance Smoke OK")
    assert check_final_content(transcript, _scenario(expected_final_text=("acceptance smoke ok",))) == []


def test_missing_expected_text_is_a_finding() -> None:
    findings = check_final_content(Transcript(final_content="nope"), _scenario(expected_final_text=("GLB",)))
    assert findings == ["final answer missing expected text: GLB"]


def test_a_scenarios_forbidden_pattern_is_a_finding() -> None:
    transcript = Transcript(final_content="I used android_tester directly")
    findings = check_final_content(transcript, _scenario(forbidden_final_pattern=r"android_tester"))
    assert findings == ["final answer matched the scenario's forbidden pattern"]


def test_an_over_long_answer_is_a_finding() -> None:
    findings = check_final_content(Transcript(final_content="x" * 20), _scenario(max_final_chars=10))
    assert findings == ["final answer is 20 chars, expected at most 10"]


# --- check_plan -------------------------------------------------------------


def test_a_missing_plan_is_a_finding() -> None:
    assert check_plan(Transcript(turn_id=1), _scenario()) == ["plan endpoint returned no JSON"]


def test_a_forbidden_tool_is_reported_by_its_builtin_name() -> None:
    plan = _plan({"toolName": "adapter-42", "executionInfo": {"builtinToolName": "delegate"}})
    findings = check_plan(Transcript(turn_id=1, plan=plan), _scenario(forbidden_tool_names=EXECUTION_TOOLS))
    assert findings == ["plan called forbidden tool(s): delegate"]


def test_a_forbidden_tool_is_reported_when_only_the_raw_name_is_present() -> None:
    transcript = Transcript(turn_id=1, plan=_plan({"toolName": "delegate"}))
    assert check_plan(transcript, _scenario(forbidden_tool_names=EXECUTION_TOOLS)) == ["plan called forbidden tool(s): delegate"]


def test_forbidden_tools_nested_under_a_batch_are_still_seen() -> None:
    plan = _plan({"toolName": "plan_write", "batchCalls": [{"toolName": "delegate"}]})
    findings = check_plan(Transcript(turn_id=1, plan=plan), _scenario(forbidden_tool_names=EXECUTION_TOOLS))
    assert findings == ["plan called forbidden tool(s): delegate"]


def test_parsing_a_document_is_a_finding_because_no_scenario_attaches_one() -> None:
    findings = check_plan(Transcript(turn_id=1, plan=_plan({"toolName": "parse_document"})), _scenario())
    assert "plan parsed a document although the scenario attached none" in findings


def test_ui_labels_are_matched_with_their_capitalisation() -> None:
    """`command:` appears in ordinary prose; the leaked label is `Command:`."""
    leaked = check_plan(Transcript(turn_id=1, plan=_plan({"message": "Command: adb shell"})), _scenario())
    assert "plan leaks low-level Command/Entrypoint labels" in leaked

    prose = check_plan(Transcript(turn_id=1, plan=_plan({"message": "summarize the startup command: see README"})), _scenario())
    assert prose == []


def test_a_delegated_scenario_expects_run_task_in_the_plan() -> None:
    findings = check_plan(Transcript(turn_id=1, plan=_plan({"toolName": "delegate"})), _scenario(expect_batch=True))
    assert "plan does not show run_task for a delegated scenario" in findings


def test_reading_skill_source_before_a_normal_run_is_a_finding() -> None:
    plan = _plan({"message": "run_task Skipped source read for normal execution"})
    findings = check_plan(Transcript(turn_id=1, plan=plan), _scenario(expect_batch=True))
    assert "normal task execution still attempted to read skill source" in findings


def test_a_finished_parent_may_not_keep_running_lifecycle_rows() -> None:
    plan = _plan({"message": "Finished 3 cases", "runningList": [{"status": 1}]})
    findings = check_plan(Transcript(turn_id=1, plan=plan), _scenario())
    assert findings == ["finished batch parent still has pending/running lifecycle rows"]


def test_a_terminal_child_may_not_keep_active_lifecycle_rows() -> None:
    plan = _plan({"message": "Task completed: echo", "runningList": [{"status": 2}]})
    findings = check_plan(Transcript(turn_id=1, plan=plan), _scenario())
    assert findings == ["terminal child task still has active lifecycle rows"]


def test_a_settled_lifecycle_row_reports_nothing() -> None:
    plan = _plan({"message": "Task completed: echo", "runningList": [{"status": 3}]})
    assert check_plan(Transcript(turn_id=1, plan=plan), _scenario()) == []


# --- check_batches ----------------------------------------------------------


def test_a_delegated_scenario_needs_a_persisted_batch() -> None:
    findings = check_batches(Transcript(turn_id=1), _scenario(expect_batch=True))
    assert findings == ["expected a delegated batch, but none was persisted"]


def test_a_delegated_scenario_defaults_to_one_batch() -> None:
    batches = [{"batchId": "a", "status": "completed"}, {"batchId": "b", "status": "completed"}]
    findings = check_batches(Transcript(turn_id=1, batches=batches), _scenario(expect_batch=True))
    assert findings == ["expected at most 1 batch(es), got 2"]


def test_a_batch_smaller_than_the_scenario_asked_for_is_a_finding() -> None:
    batches = [{"batchId": "a", "status": "completed", "totalCount": 2}]
    findings = check_batches(Transcript(turn_id=1, batches=batches), _scenario(expect_batch=True, min_batch_total=3))
    assert findings == ["expected a batch with at least 3 task(s), largest had 2"]


def test_a_non_terminal_batch_is_a_finding() -> None:
    batches = [{"batchId": "a", "status": "running"}]
    findings = check_batches(Transcript(turn_id=1, batches=batches), _scenario(expect_batch=True))
    assert findings == ["batch a has non-terminal status running"]


def test_a_failed_batch_is_a_finding_when_the_scenario_expected_work_to_land() -> None:
    batches = [{"batchId": "a", "status": "failed"}]
    findings = check_batches(Transcript(turn_id=1, batches=batches), _scenario(expect_batch=True))
    assert findings == ["batch a ended with failed"]


def test_a_partial_batch_is_accepted() -> None:
    batches = [{"batchId": "a", "status": "partial", "totalCount": 3}]
    assert check_batches(Transcript(turn_id=1, batches=batches), _scenario(expect_batch=True, min_batch_total=3)) == []


# --- check_timing -----------------------------------------------------------


def test_running_past_the_scenario_budget_is_a_finding() -> None:
    findings = check_timing(Transcript(duration_s=200.0), _scenario(max_seconds=180.0))
    assert findings == ["scenario exceeded max_seconds=180"]


def test_a_delegated_turn_gets_a_looser_first_event_budget() -> None:
    slow = Transcript(first_event_s=30.0)
    assert check_timing(slow, _scenario(expect_batch=True)) == []
    assert check_timing(slow, _scenario()) == ["first SSE event is slow (30.00s, budget 20s)"]


def test_a_scenario_may_opt_out_of_the_first_event_budget() -> None:
    assert check_timing(Transcript(first_event_s=90.0), _scenario(slow_first_event_ok=True)) == []
