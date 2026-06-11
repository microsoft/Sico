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

"""Tests for :class:`android_tester.runner.TestRunner._run_loop`.

Focuses on how the loop reacts to the three failure modes raised by
``_run_step``:

* :class:`AnswerFormatError`  -> soft-fail, inject feedback reflection,
  bump no-progress, continue.
* :class:`LLMHubError`        -> soft-fail, log error, bump no-progress,
  continue (no reflection injection).
* :class:`ADBCommandError`    -> hard-fail, log error, re-raise.

The tests stub ``_run_step`` directly, so they don't need a device,
LLM, or filesystem — only the loop's branching is exercised.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from android_tester.actions import ParsedAction
from android_tester.android_controller import ADBCommandError
from android_tester.llm_hub import LLMHubError
from android_tester.models import (
    AnswerFormatError,
    Reflection,
    RunState,
    TaskStatus,
)
from android_tester.report import StepRecord, render_report
from android_tester.runner import ActionExecutionResult, TestRunner
from android_tester.stop_policies import (
    MaxStepsPolicy,
    NoProgressPolicy,
)


def _make_runner(stop_policies: list[Any]) -> TestRunner:
    """Build a TestRunner whose external collaborators are mocks.

    ``_run_loop`` only calls ``self._controller.ensure_connected`` /
    ``self._controller.reset`` and ``self._event_logger.record`` —
    everything else lives inside ``_run_step``, which the tests patch.
    """
    controller = MagicMock()
    controller.device_id = "fake:1"
    controller.ensure_connected = AsyncMock()
    controller.reset = AsyncMock()

    event_logger = MagicMock()
    event_logger.record = AsyncMock()

    return TestRunner(
        controller=controller,
        llm=MagicMock(),
        prompts=MagicMock(),
        event_logger=event_logger,
        image_store=MagicMock(),
        stop_policies=stop_policies,
        sleep_between_steps=0.0,
        first_step_sleep=0.0,
        reflector_enabled=False,
    )


def _new_state() -> RunState:
    return RunState(
        instruction="dummy task",
        progress_status="initial progress",
        current_step_goal="initial goal",
    )


# ---------------------------------------------------------------------------
# AnswerFormatError — soft-fail with feedback reflection
# ---------------------------------------------------------------------------


class TestInvalidActionResponse:
    async def test_does_not_abort_run(self) -> None:
        """One bad parse, then the next step finishes the task."""
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])

        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=[
                AnswerFormatError("Invalid action format: 'tap()'"),
                (TaskStatus.COMPLETED, "done"),
            ],
        )

        state = _new_state()
        status, reason = await runner._run_loop("task-1", state)

        assert status == TaskStatus.COMPLETED
        assert reason == "done"
        assert runner._run_step.await_count == 2

    async def test_injects_feedback_reflection(self) -> None:
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])

        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=[
                AnswerFormatError("Unsupported action: 'Foo'"),
                (TaskStatus.COMPLETED, "done"),
            ],
        )

        state = _new_state()
        await runner._run_loop("task-2", state)

        # The synthetic reflection injected after the parse error.
        assert isinstance(state.last_reflection_obj, Reflection)
        r = state.last_reflection_obj
        assert "could not be parsed" in r.what_happened
        assert "Unsupported action: 'Foo'" in r.what_happened
        assert r.outcome == "failure"
        # Progress fields are carried over unchanged.
        assert r.updated_state == "initial progress"
        assert r.next_step_goal == "initial goal"

    async def test_records_error_event(self) -> None:
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])
        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=[
                AnswerFormatError("Missing <action> tag in response"),
                (TaskStatus.COMPLETED, "done"),
            ],
        )

        await runner._run_loop("task-3", _new_state())

        record = runner._event_logger.record  # type: ignore[attr-defined]
        # Find the malformed-response error event.
        error_calls = [
            c for c in record.await_args_list
            if c.args and c.args[0] == "error"
        ]
        assert error_calls, "expected an error event to be recorded"
        msg = error_calls[0].kwargs.get("message", "")
        assert "Malformed operator response" in msg

    async def test_blocks_after_no_progress_threshold(self) -> None:
        """Repeated parse errors eventually trip NoProgressPolicy."""
        runner = _make_runner(
            [NoProgressPolicy(max_no_progress_steps=3)],
        )
        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=AnswerFormatError("Invalid action format"),
        )

        state = _new_state()
        status, reason = await runner._run_loop("task-4", state)

        assert status == TaskStatus.BLOCKED
        assert reason is not None
        assert "no progress" in reason
        # 3 failed _run_step calls before the policy fires on entry to
        # the 4th iteration.
        assert runner._run_step.await_count == 3


# ---------------------------------------------------------------------------
# LLMHubError — soft-fail without reflection injection
# ---------------------------------------------------------------------------


class TestLLMHubErrorResponse:
    async def test_continues_without_setting_reflection(self) -> None:
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])
        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=[
                LLMHubError("upstream 500"),
                (TaskStatus.COMPLETED, "done"),
            ],
        )

        state = _new_state()
        status, _ = await runner._run_loop("task-5", state)

        assert status == TaskStatus.COMPLETED
        # LLM errors do NOT inject a synthetic reflection.
        assert state.last_reflection_obj is None

    async def test_blocks_after_no_progress_threshold(self) -> None:
        runner = _make_runner(
            [NoProgressPolicy(max_no_progress_steps=2)],
        )
        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=LLMHubError("upstream timeout"),
        )

        status, reason = await runner._run_loop("task-6", _new_state())

        assert status == TaskStatus.BLOCKED
        assert reason is not None
        assert "no progress" in reason


# ---------------------------------------------------------------------------
# ADBCommandError — hard-fail, propagates out of the loop
# ---------------------------------------------------------------------------


class TestADBCommandErrorResponse:
    async def test_aborts_run(self) -> None:
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])
        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=ADBCommandError("shell input text", "boom"),
        )

        with pytest.raises(ADBCommandError):
            await runner._run_loop("task-7", _new_state())

        # The single failing step is the only one attempted.
        assert runner._run_step.await_count == 1

    async def test_records_error_event_before_reraising(self) -> None:
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])
        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            side_effect=ADBCommandError("shell input text", "boom"),
        )

        with pytest.raises(ADBCommandError):
            await runner._run_loop("task-8", _new_state())

        record = runner._event_logger.record  # type: ignore[attr-defined]
        error_calls = [
            c for c in record.await_args_list
            if c.args and c.args[0] == "error"
        ]
        assert error_calls, "expected an error event to be recorded"
        msg = error_calls[0].kwargs.get("message", "")
        assert "Running ADB command failed" in msg


# ---------------------------------------------------------------------------
# Happy path — sanity check the harness itself.
# ---------------------------------------------------------------------------


class TestHappyPath:
    async def test_completes_immediately(self) -> None:
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])
        runner._run_step = AsyncMock(  # type: ignore[method-assign]
            return_value=(TaskStatus.COMPLETED, "ok"),
        )

        status, reason = await runner._run_loop("task-9", _new_state())

        assert status == TaskStatus.COMPLETED
        assert reason == "ok"
        assert runner._run_step.await_count == 1


class TestActionExecutionResultLogging:
    async def test_run_step_records_action_result_event(self) -> None:
        runner = _make_runner([MaxStepsPolicy(max_steps=10)])

        before = MagicMock()
        before.original_size = (1080, 1920)
        before.drop_data_cache = MagicMock()

        runner._take_step_screenshot = AsyncMock(  # type: ignore[method-assign]
            return_value=before,
        )
        runner._operator_step = AsyncMock(  # type: ignore[method-assign]
            return_value=(
                ParsedAction(
                    name="ClipboardGet",
                    args={},
                    thought="",
                    conclusion="read clipboard",
                ),
                None,
            ),
        )
        runner._execute_action = AsyncMock(  # type: ignore[method-assign]
            return_value=ActionExecutionResult(
                clipboard_content="Hello world",
            ),
        )
        runner._wait_between_steps = AsyncMock()  # type: ignore[method-assign]

        state = _new_state()
        result = await runner._run_step("task-action-result", 1, state)

        assert result is None
        calls = runner._event_logger.record.await_args_list
        action_result_calls = [
            c for c in calls
            if c.args and c.args[0] == "action_result"
        ]
        assert action_result_calls
        payload = action_result_calls[0].kwargs["execution_result"]
        assert payload == {"clipboard_content": "Hello world"}
        assert "dispatch_result" not in payload

    async def test_render_report_shows_action_result(self) -> None:
        html = await render_report(
            steps={
                1: StepRecord(
                    step=1,
                    action_result=(
                        "ClipboardGet: "
                        '{"clipboard_content": "Hello world"}'
                    ),
                ),
            },
            task_id="task-1",
            duration=1.0,
            status="completed",
            start_ts="2026-06-08T00:00:00+00:00",
            instruction="line 1\nline 2",
        )

        assert "Action Result" in html
        assert "ClipboardGet" in html
        assert "Hello world" in html
        assert "line 1<br/>line 2" in html
