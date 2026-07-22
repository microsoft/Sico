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

"""Tests for the field-agnostic default DW trajectory parser.

The android-tester-shaped cases double as the regression that android-tester
keeps producing the exact same trajectory after moving to the default parser
(its events classify into the same roles by field presence). The remaining cases
exercise generality: a DW with different event names, foreign field names, and
plain (non-JSONL) stdout.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.experiences.integrations.default_parser import parse_trajectory


def _make_run(run_id: str = "run-1", batch_id: str = "batch-1", skill_name: str = "android-tester") -> SimpleNamespace:
    return SimpleNamespace(run_id=run_id, batch_id=batch_id, skill_name=skill_name)


def _result(events: list[dict[str, Any]]) -> SimpleNamespace:
    """Build a result whose ``output`` carries the run's JSONL trajectory stdout."""
    return SimpleNamespace(output="\n".join(json.dumps(event) for event in events) + "\n")


# ---------------------------------------------------------------------------
# android-tester equivalence (regression: same trajectory as the old parser)
# ---------------------------------------------------------------------------


def test_single_attempt_full_events(tmp_path: Path) -> None:
    result = _result(
        [
            {
                "event": "operator",
                "attempt": 1,
                "step": 1,
                "task_id": "task-A",
                "thought": "tap the login button",
                "action": "tap",
                "args": {"x": 100, "y": 200},
                "conclusion": "expect login dialog",
            },
            {
                "event": "reflector",
                "attempt": 1,
                "step": 1,
                "outcome": "success",
                "what_happened": "login dialog appeared",
                "progress": "1 of 2 steps complete",
                "next_goal": "enter password",
            },
            {
                "event": "operator",
                "attempt": 1,
                "step": 2,
                "task_id": "task-A",
                "thought": "type the password",
                "action": "type",
                "args": {"text": "secret"},
                "conclusion": "ready to submit",
            },
            {
                "event": "reflector",
                "attempt": 1,
                "step": 2,
                "outcome": "success",
                "what_happened": "password entered",
                "progress": "done",
                "next_goal": "",
            },
            {
                "event": "task_result",
                "attempt": 1,
                "task_id": "task-A",
                "status": "completed",
                "instruction": "log into the app",
                "duration": 12.5,
                "reason": "all steps succeeded",
            },
        ]
    )

    trajectories = parse_trajectory(tmp_path, _make_run(), result=result)

    assert len(trajectories) == 1
    trajectory = trajectories[0]
    assert trajectory.task == "log into the app"
    assert trajectory.success is True
    assert trajectory.total_steps == 2
    assert trajectory.duration_seconds == pytest.approx(12.5)
    assert trajectory.final_output == "all steps succeeded"
    assert trajectory.error is None
    assert trajectory.judge_result == {"verdict": True, "reasoning": "all steps succeeded"}
    assert trajectory.agent_type == "android-tester"
    assert trajectory.metadata == {
        "skill_name": "android-tester",
        "run_id": "run-1",
        "batch_id": "batch-1",
        "status": "completed",
        "task_id": "task-A",
    }
    first = trajectory.chronological_steps[0]
    assert first.step_number == 1
    assert first.thought == {
        "thinking": "tap the login button",
        "next_goal": "enter password",
    }
    assert first.actions == [
        {
            "action_type": "tap",
            "parameters": {"x": 100, "y": 200},
            "conclusion": "expect login dialog",
        }
    ]
    assert first.results == [{"outcome": "success", "what_happened": "login dialog appeared"}]
    assert first.state == {"progress": "1 of 2 steps complete"}


def test_task_result_missing_keeps_operator_content(tmp_path: Path) -> None:
    result = _result(
        [
            {
                "event": "operator",
                "attempt": 1,
                "step": 1,
                "task_id": "task-B",
                "thought": "explore",
                "action": "scroll",
                "args": {"direction": "down"},
            },
            {
                "event": "reflector",
                "attempt": 1,
                "step": 1,
                "outcome": "partial",
                "what_happened": "scrolled halfway",
                "progress": "interrupted",
                "next_goal": "continue scrolling",
            },
        ]
    )

    trajectories = parse_trajectory(tmp_path, _make_run(), result=result)

    assert len(trajectories) == 1
    trajectory = trajectories[0]
    assert trajectory.success is False
    assert trajectory.error is None
    assert trajectory.final_output == ""
    assert trajectory.judge_result is None
    assert trajectory.duration_seconds == 0.0
    assert trajectory.task == "explore"
    assert trajectory.metadata["task_id"] == "task-B"
    assert trajectory.total_steps == 1


def test_step_with_missing_reflector_preserves_operator(tmp_path: Path) -> None:
    result = _result(
        [
            {
                "event": "operator",
                "attempt": 1,
                "step": 1,
                "thought": "first step",
                "action": "tap",
                "args": {"x": 10, "y": 10},
            },
            {
                "event": "reflector",
                "attempt": 1,
                "step": 1,
                "outcome": "success",
                "what_happened": "tapped",
                "progress": "1/2",
                "next_goal": "second action",
            },
            {
                "event": "operator",
                "attempt": 1,
                "step": 2,
                "thought": "second step",
                "action": "tap",
                "args": {"x": 20, "y": 20},
            },
            {
                "event": "task_result",
                "attempt": 1,
                "task_id": "task-C",
                "status": "failed",
                "instruction": "two-step flow",
                "duration": 5.0,
                "reason": "interrupted before reflector",
            },
        ]
    )

    trajectories = parse_trajectory(tmp_path, _make_run(), result=result)

    assert len(trajectories) == 1
    steps = trajectories[0].chronological_steps
    assert len(steps) == 2

    first = steps[0]
    assert first.thought == {"thinking": "first step", "next_goal": "second action"}
    assert first.results == [{"outcome": "success", "what_happened": "tapped"}]
    assert first.state == {"progress": "1/2"}

    second = steps[1]
    assert second.thought == {"thinking": "second step"}
    assert second.actions == [{"action_type": "tap", "parameters": {"x": 20, "y": 20}}]
    assert second.results == []
    assert second.state == {}
    assert trajectories[0].metadata["status"] == "failed"
    assert trajectories[0].final_output == "interrupted before reflector"
    assert trajectories[0].error is None


def test_missing_output_returns_empty(tmp_path: Path) -> None:
    assert parse_trajectory(tmp_path, _make_run(), result=SimpleNamespace(output=None)) == []


def test_empty_output_returns_empty(tmp_path: Path) -> None:
    assert parse_trajectory(tmp_path, _make_run(), result=SimpleNamespace(output="")) == []


def test_malformed_and_unrelated_lines_are_skipped(tmp_path: Path) -> None:
    payload = json.dumps(
        {
            "event": "operator",
            "attempt": 1,
            "step": 1,
            "thought": "ok",
            "action": "tap",
            "args": {},
        }
    )
    output = "\n".join(["not json at all", "{not valid", json.dumps({"unrelated": "payload"}), payload, ""]) + "\n"

    trajectories = parse_trajectory(tmp_path, _make_run(), result=SimpleNamespace(output=output))
    assert len(trajectories) == 1
    assert trajectories[0].total_steps == 1


def test_screenshot_state_is_attached_by_step(tmp_path: Path) -> None:
    result = _result(
        [
            {
                "event": "screenshot",
                "step": 1,
                "task_id": "task-shot",
                "image": "http://localhost:8080/storage/before.jpg",
                "description": "before-action",
            },
            {
                "event": "operator",
                "step": 1,
                "task_id": "task-shot",
                "thought": "launch edge",
                "action": "Launch",
                "args": {"app": "Microsoft Edge"},
                "conclusion": "browser launching",
            },
            {
                "event": "operator",
                "step": 2,
                "task_id": "task-shot",
                "thought": "submit search",
                "action": "PressEnter",
                "args": {},
                "conclusion": "search submitted",
            },
            {
                "event": "task_result",
                "task_id": "task-shot",
                "status": "completed",
                "instruction": "search for Suzhou",
                "duration": 76.9,
                "reason": "result page showed Suzhou content",
            },
        ]
    )

    trajectories = parse_trajectory(tmp_path, _make_run(), result=result)

    assert len(trajectories) == 1
    trajectory = trajectories[0]
    assert trajectory.task == "search for Suzhou"
    assert trajectory.success is True
    assert trajectory.total_steps == 2
    assert trajectory.duration_seconds == pytest.approx(76.9)
    assert trajectory.final_output == "result page showed Suzhou content"
    assert trajectory.metadata["task_id"] == "task-shot"
    assert trajectory.chronological_steps[0].state == {
        "screenshot": "http://localhost:8080/storage/before.jpg",
        "screenshot_description": "before-action",
    }


def test_task_result_without_operator_still_yields_minimal_trajectory(tmp_path: Path) -> None:
    result = _result(
        [
            {
                "event": "task_result",
                "attempt": 1,
                "status": "failed",
                "instruction": "no operator",
                "duration": 0.0,
                "reason": "nothing happened",
            },
        ]
    )

    trajectories = parse_trajectory(tmp_path, _make_run(), result=result)

    assert len(trajectories) == 1
    trajectory = trajectories[0]
    assert trajectory.task == "no operator"
    assert trajectory.success is False
    assert trajectory.total_steps == 1
    assert trajectory.metadata["status"] == "failed"
    assert trajectory.final_output == "nothing happened"
    assert trajectory.error is None
    assert trajectory.judge_result == {"verdict": False, "reasoning": "nothing happened"}
    assert trajectory.chronological_steps[0].results == [{"outcome": "failed", "what_happened": "nothing happened"}]


def test_blocked_status_is_not_converted_to_error(tmp_path: Path) -> None:
    result = _result(
        [
            {
                "event": "task_result",
                "status": "blocked",
                "instruction": "paste URL",
                "reason": "clipboard precondition failed",
            },
        ]
    )

    trajectories = parse_trajectory(tmp_path, _make_run(), result=result)

    assert len(trajectories) == 1
    trajectory = trajectories[0]
    assert trajectory.success is False
    assert trajectory.metadata["status"] == "blocked"
    assert trajectory.final_output == "clipboard precondition failed"
    assert trajectory.error is None
    assert trajectory.judge_result == {"verdict": False, "reasoning": "clipboard precondition failed"}


def test_verdict_field_drives_success(tmp_path: Path) -> None:
    result = _result(
        [
            {"event": "operator", "step": 1, "thought": "t", "action": "a"},
            {"event": "operator", "step": 2, "thought": "t", "action": "a"},
            {"event": "operator", "step": 3, "thought": "t", "action": "a"},
            {"event": "task_result", "verdict": True, "instruction": "do it", "reason": "ok"},
        ]
    )

    trajectory = parse_trajectory(tmp_path, _make_run(), result=result)[0]
    assert trajectory.success is True
    assert trajectory.judge_result == {"verdict": True, "reasoning": "ok"}


# ---------------------------------------------------------------------------
# Generality: any DW, no required field/slot schema
# ---------------------------------------------------------------------------


def test_generic_dw_with_different_event_names_parses_structurally(tmp_path: Path) -> None:
    # A non-android DW that names its events differently but uses common
    # agent-loop field names. Field-presence classification handles it.
    result = _result(
        [
            {"event": "act", "step": 1, "thought": "open file", "action": "open", "args": {"path": "a.csv"}},
            {"event": "obs", "step": 1, "outcome": "ok", "what_happened": "file opened"},
            {"event": "act", "step": 2, "thought": "read rows", "action": "read"},
            {"event": "obs", "step": 2, "outcome": "ok", "what_happened": "read 10 rows"},
            {"event": "act", "step": 3, "thought": "finish", "action": "done"},
            {
                "event": "done",
                "status": "success",
                "instruction": "analyze a.csv",
                "reason": "analysis complete",
                "duration": 3.0,
            },
        ]
    )

    trajectory = parse_trajectory(tmp_path, _make_run(skill_name="data-analyst"), result=result)[0]
    assert trajectory.task == "analyze a.csv"
    assert trajectory.success is True
    assert trajectory.total_steps == 3
    assert trajectory.agent_type == "data-analyst"
    assert trajectory.metadata["skill_name"] == "data-analyst"
    first = trajectory.chronological_steps[0]
    assert first.thought == {"thinking": "open file"}
    assert first.actions == [{"action_type": "open", "parameters": {"path": "a.csv"}}]
    assert first.results == [{"outcome": "ok", "what_happened": "file opened"}]


def test_foreign_field_names_fall_back_to_text_route(tmp_path: Path) -> None:
    # A DW whose JSONL uses field names the canonical slots do not recognize.
    # Nothing is lost: the raw lines become the text trace.
    result = _result(
        [
            {"event": "log", "tool": "run_python", "code": "df.describe()", "stdout": "mean 4.2"},
            {"event": "log", "tool": "write_file", "path": "out.csv", "stdout": "ok"},
        ]
    )

    trajectory = parse_trajectory(tmp_path, _make_run(skill_name="coder"), result=result)[0]
    assert trajectory.total_steps == 0
    assert trajectory.chronological_steps == []
    assert "run_python" in trajectory.raw_trace
    assert "write_file" in trajectory.raw_trace
    assert trajectory.metadata["status"] == "unknown"
    assert trajectory.success is False
    assert trajectory.judge_result is None
    # The raw log renders into the Reflector trace verbatim.
    feedback = trajectory.build_feedback_string()
    assert "Execution Log (raw)" in feedback
    assert "run_python" in feedback


def test_plain_text_stdout_falls_back_to_text_route(tmp_path: Path) -> None:
    output = "Starting task\nDid step A\nDid step B\nTask complete\n"
    trajectory = parse_trajectory(tmp_path, _make_run(skill_name="shell-skill"), result=SimpleNamespace(output=output))[0]
    assert trajectory.total_steps == 0
    assert "Did step A" in trajectory.raw_trace
    assert "Did step B" in trajectory.raw_trace
    feedback = trajectory.build_feedback_string()
    assert "Execution Log (raw)" in feedback


def test_text_route_excludes_stderr_error_message_from_learning_signal(tmp_path: Path) -> None:
    # error_message is process stderr (setup/INFO noise), not the agent outcome.
    result = SimpleNamespace(
        output="\n".join(
            json.dumps(event)
            for event in [
                {"event": "log", "tool": "run_python", "stdout": "hi"},
                {"event": "log", "tool": "write_file", "stdout": "ok"},
            ]
        )
        + "\n",
        error_message="warning: VIRTUAL_ENV ... Installed 11 packages ... noise",
        status="failed",
    )
    trajectory = parse_trajectory(tmp_path, _make_run(skill_name="coder"), result=result)[0]
    assert trajectory.final_output == ""
    assert "Installed 11 packages" not in trajectory.build_feedback_string()
    assert "Installed 11 packages" not in trajectory.format_model_prediction()
    assert trajectory.metadata["status"] == "failed"
    assert trajectory.success is False
    assert "run_python" in trajectory.raw_trace


def test_desktop_short_run_flip_to_structured_keeps_pass_via_terminal_status(tmp_path: Path) -> None:
    # A short desktop run whose planner events carry status crosses the
    # recognition floor into the structured route; the terminal completed event
    # carries status so a genuine PASS is not mislabeled as FAIL.
    result = _result(
        [
            {"event": "run_started", "instruction": "open bing", "task_id": "t"},
            {"event": "screenshot", "step": 1, "path": "s1.png"},
            {
                "event": "planner",
                "step": 1,
                "summary": "Confirm forecast.",
                "reasoning": "visible",
                "status": "completed",
                "actions": [],
            },
            {"event": "completed", "step": 1, "status": "completed", "reason": "forecast shown"},
        ]
    )
    trajectory = parse_trajectory(tmp_path, _make_run(skill_name="desktop-tester"), result=result)[0]
    assert trajectory.success is True
    assert trajectory.metadata["status"] == "completed"
    assert trajectory.final_output == "forecast shown"


def test_run_instruction_used_as_task_fallback(tmp_path: Path) -> None:
    run = SimpleNamespace(
        run_id="r", batch_id="b", skill_name="coder",
        spec=SimpleNamespace(instructions="my task instruction", title="t"),
    )
    trajectory = parse_trajectory(tmp_path, run, result=SimpleNamespace(output="raw log line\nanother line\n"))[0]
    assert trajectory.task == "my task instruction"


def test_task_prefers_structured_skill_arg_over_dispatch_wrapper(tmp_path: Path) -> None:
    # spec.instructions is the verbose "Use skill ..." dispatch wrapper; the
    # clean task in the structured skill arg must win as the learning Question.
    run = SimpleNamespace(
        run_id="r", batch_id="b", skill_name="desktop-tester",
        spec=SimpleNamespace(
            instructions="Use skill desktop-tester action run_desktop_tester with instructions 'x'",
            title="t",
            args={"sandbox_url": "http://x", "instructions": "open bing and verify the forecast"},
        ),
    )
    trajectory = parse_trajectory(tmp_path, run, result=SimpleNamespace(output="raw log\nmore\n"))[0]
    assert trajectory.task == "open bing and verify the forecast"


def test_combined_line_step_keeps_all_fields(tmp_path: Path) -> None:
    # A DW that emits ONE line per step carrying both action and observation
    # fields (the common ReAct shape). No field is dropped.
    result = _result(
        [
            {
                "event": "step", "step": 1, "thought": "open page", "action": "navigate",
                "args": {"url": "x"}, "outcome": "ok", "what_happened": "page loaded", "next_goal": "read",
            },
            {"event": "step", "step": 2, "thought": "read", "action": "extract", "outcome": "ok", "what_happened": "got text"},
            {"event": "step", "step": 3, "thought": "done", "action": "finish", "outcome": "ok", "what_happened": "complete"},
            {"event": "done", "status": "completed", "instruction": "scrape x", "reason": "scraped", "duration": 2.0},
        ]
    )

    trajectory = parse_trajectory(tmp_path, _make_run(skill_name="scraper"), result=result)[0]
    assert trajectory.total_steps == 3
    assert trajectory.success is True
    first = trajectory.chronological_steps[0]
    assert first.thought == {"thinking": "open page", "next_goal": "read"}
    assert first.actions == [{"action_type": "navigate", "parameters": {"url": "x"}}]
    assert first.results == [{"outcome": "ok", "what_happened": "page loaded"}]


def test_inline_screenshot_on_step_is_attached(tmp_path: Path) -> None:
    # A screenshot url riding on the step line keeps both the action and the url.
    result = _result(
        [
            {"event": "step", "step": 1, "thought": "tap", "action": "tap", "screenshot_url": "http://x/1.png"},
            {"event": "step", "step": 2, "thought": "type", "action": "type"},
            {"event": "step", "step": 3, "thought": "done", "action": "done"},
            {"event": "task_result", "status": "completed", "instruction": "flow", "reason": "ok"},
        ]
    )

    trajectory = parse_trajectory(tmp_path, _make_run(skill_name="ui-dw"), result=result)[0]
    first = trajectory.chronological_steps[0]
    assert first.actions == [{"action_type": "tap"}]
    assert first.state["screenshot"] == "http://x/1.png"


def test_telemetry_after_terminal_does_not_override_outcome(tmp_path: Path) -> None:
    # A telemetry line carrying only durations must not be mistaken for the
    # terminal event and overwrite the real success/reason/status.
    result = _result(
        [
            {"event": "operator", "step": 1, "thought": "t", "action": "a"},
            {"event": "operator", "step": 2, "thought": "t", "action": "a"},
            {"event": "operator", "step": 3, "thought": "t", "action": "a"},
            {"event": "task_result", "status": "completed", "instruction": "do it", "reason": "all good", "duration": 5.0},
            {"event": "telemetry", "duration_ms": 1234, "step_duration_ms": 40},
        ]
    )

    trajectory = parse_trajectory(tmp_path, _make_run(), result=result)[0]
    assert trajectory.success is True
    assert trajectory.final_output == "all good"
    assert trajectory.metadata["status"] == "completed"
    assert trajectory.duration_seconds == pytest.approx(5.0)


def test_in_band_failure_ignores_runtime_error_message(tmp_path: Path) -> None:
    # A failed case exits nonzero, so result.error_message is a generic
    # "exited with 1"; the in-band reason is authoritative and the process error
    # must not leak into the learning signal.
    events = [
        {"event": "operator", "step": 1, "thought": "t", "action": "a"},
        {"event": "operator", "step": 2, "thought": "t", "action": "a"},
        {"event": "operator", "step": 3, "thought": "t", "action": "a"},
        {"event": "task_result", "status": "failed", "instruction": "find bug", "reason": "found a crash"},
    ]
    result = SimpleNamespace(
        output="\n".join(json.dumps(event) for event in events) + "\n",
        error_message="android_tester exited with 1",
    )

    trajectory = parse_trajectory(tmp_path, _make_run(), result=result)[0]
    assert trajectory.error is None
    assert trajectory.final_output == "found a crash"
    assert "exited with 1" not in trajectory.build_feedback_string()
