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

from __future__ import annotations

import asyncio
import itertools
import logging
import time
import traceback
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from android_tester.a11y import find_focused_node, resolve_click
from android_tester.action_script import ActionScript, ActionStep
from android_tester.actions import (
    ParsedAction,
    compute_action_key,
    parse_operator_response,
    parse_reflector_response,
)
from android_tester.android_controller import (
    ADBCommandError,
    AndroidController,
    UnknownAppError,
)
from android_tester.event_logger import EventLogger
from android_tester.image_store import Image, ImageStore
from android_tester.llm_hub import LLMHubClient, LLMHubError
from android_tester.models import (
    AnswerFormatError,
    PreconditionRecord,
    Reflection,
    RunState,
    TaskStatus,
)
from android_tester.prompts import PromptRenderer
from android_tester.stop_policies import (
    NoProgressPolicy,
    RepetitiveActionPolicy,
    StopContext,
    StopPolicy,
    evaluate_policies,
)
from android_tester.telemetry import measure_time
from android_tester.utils import rescale_point

if TYPE_CHECKING:
    from android_tester.precondition_manager import PreconditionManager

Point = tuple[int, int]

logger = logging.getLogger(__name__)

_FINISHED_VERDICT_STATUS: dict[str, TaskStatus] = {
    "pass": TaskStatus.COMPLETED,
    "bug": TaskStatus.FAILED,
    "blocker": TaskStatus.BLOCKED,
}

# Action argument keys that carry (x, y) coordinates.
_COORDINATE_ARG_KEYS: tuple[str, ...] = ("point", "start", "end")


@dataclass(slots=True)
class ActionExecutionResult:
    """Side-channel outputs produced while executing an action."""

    resolved_package: str | None = None
    clipboard_content: str | None = None
    listing: str | None = None

    def __bool__(self) -> bool:
        return (self.resolved_package is not None
                or self.clipboard_content is not None
                or self.listing is not None)

    def to_dict(self):
        return {
            k: v for k, v in {
                "resolved_package": self.resolved_package,
                "clipboard_content": self.clipboard_content,
                "listing": self.listing,
            }.items() if v is not None
        }


class TestRunner:
    def __init__(
        self,
        controller: AndroidController,
        llm: LLMHubClient,
        prompts: PromptRenderer,
        event_logger: EventLogger,
        image_store: ImageStore,
        stop_policies: list[StopPolicy] | None = None,
        sleep_between_steps: float = 2.,
        first_step_sleep: float = 6.,
        execution_timeout: float = 0.,
        max_screenshot_size: tuple[int, int] | None = None,
        coordinate_space: tuple[int, int] | None = None,
        reflector_enabled: bool = True,
        n_retries: int = 0,
        log_llm_inputs: bool = False,
        history_length: int = 0,
        precondition_manager: PreconditionManager | None = None,
        reset_after_execution: bool = True,
    ) -> None:
        self._controller = controller
        self._llm = llm
        self._prompts = prompts
        self._event_logger = event_logger
        self._image_store = image_store
        self._stop_policies = stop_policies if stop_policies is not None else [
            NoProgressPolicy(max_no_progress_steps=6),
            RepetitiveActionPolicy(max_repetitions=5),
        ]
        self._sleep_between_steps = sleep_between_steps
        self._first_step_sleep = first_step_sleep
        self._execution_timeout = execution_timeout or None  # 0 = no timeout
        self._max_screenshot_size = max_screenshot_size
        self._coordinate_space = coordinate_space
        self._reflector_enabled = reflector_enabled
        self._n_retries = n_retries
        self._log_llm_inputs = log_llm_inputs
        self._history_length = history_length
        self._precondition_manager = precondition_manager
        self._reset_after_execution = reset_after_execution

    async def run(
        self,
        instruction: str,
        task_id: str | None = None,
        task_name: str | None = None,
        *,
        preconditions: list[tuple[str, str]] | None = None,
        warm_state: RunState | None = None,
        step_offset: int = 0,
        finalize: bool = True,
    ) -> TaskStatus:
        job_id = task_id or str(uuid.uuid4())
        max_attempts = max(1, self._n_retries + 1)
        status = TaskStatus.BLOCKED

        # Establish preconditions (if any) before first attempt
        if (
            warm_state is None
            and preconditions
            and self._precondition_manager
        ):
            precondition_timer = measure_time("precondition_total_duration")
            with precondition_timer:
                warm_state, failed_label, precondition_records = (
                    await self._establish_preconditions(preconditions, job_id)
                )
            if failed_label is None and warm_state is not None:
                warm_state.precondition_duration_s = (
                    precondition_timer.elapsed
                )
            else:
                reason = (
                    f"precondition {failed_label!r} could not be "
                    f"established; aborting before any attempt"
                )
                logger.warning(reason)
                await self._event_logger.record_completion(
                    job_id, 0.0, TaskStatus.BLOCKED.value,
                    task_name=task_name,
                    instruction=instruction,
                    device_id=self._controller.device_id,
                    reason=reason,
                    preconditions=(
                        precondition_records
                        if precondition_records
                        else [
                            PreconditionRecord(label, text, 0)
                            for label, text in preconditions
                        ]
                    ),
                    precondition_duration=precondition_timer.elapsed,
                    total_duration=precondition_timer.elapsed,
                    precondition_step_boundary=(
                        self._event_logger.recorded_step_count
                    ),
                )
                return TaskStatus.BLOCKED

        for attempt in range(1, max_attempts + 1):
            attempt_label = attempt if max_attempts > 1 else None
            status = await self._run_attempt(
                job_id, instruction, task_name, attempt_label,
                warm_state=warm_state,
                step_offset=step_offset,
                finalize=finalize,
            )
            if status == TaskStatus.COMPLETED:
                return status
            if attempt < max_attempts:
                logger.warning(
                    "attempt %d/%d failed (status=%s); retrying",
                    attempt, max_attempts, status.value,
                )
        return status

    async def _establish_preconditions(
        self,
        preconditions: list[tuple[str, str]],
        job_id: str,
    ) -> tuple[RunState | None, str | None, list[PreconditionRecord]]:
        """Establish each precondition in order, chaining their recorded
        setup steps into one cumulative warm state. The order is chosen
        up front by the precondition planner.
        Returns ``(warm_state, None, records)`` on success, or
        ``(warm_state_or_none, failed_label, partial_records)`` if any
        precondition cannot be established."""
        if not self._precondition_manager:
            return None, None, []

        ordered = await self._precondition_manager.order_preconditions(
            preconditions, job_id,
        )
        warm_state: RunState | None = None
        records: list[PreconditionRecord] = []
        step_offset = 0
        for label, text in ordered:
            state = await self._precondition_manager.establish(
                label=label, text=text, task_id=job_id,
                step_offset=step_offset,
            )
            if state is None:
                failed_step_count = max(
                    0,
                    self._event_logger.recorded_step_count - step_offset,
                )
                records.append(
                    PreconditionRecord(label, text, failed_step_count),
                )
                if warm_state is not None:
                    warm_state.preconditions = records
                return warm_state, label, records
            records.append(
                PreconditionRecord(label, text, state.step_count),
            )
            step_offset += state.step_count
            warm_state = (
                state if warm_state is None
                else self._merge_warm_state(warm_state, state)
            )
        if warm_state is not None:
            warm_state.preconditions = records
        return warm_state, None, records

    @staticmethod
    def _merge_warm_state(base: RunState, extra: RunState) -> RunState:
        """Append *extra*'s recorded history onto *base* so multiple
        preconditions form a single setup prefix."""
        base.actions.extend(extra.actions)
        base.summaries.extend(extra.summaries)
        base.action_keys.extend(extra.action_keys)
        base.operator_history.extend(extra.operator_history)
        return base

    async def _run_attempt(
        self,
        job_id: str,
        instruction: str,
        task_name: str | None,
        attempt: int | None,
        *,
        warm_state: RunState | None = None,
        step_offset: int = 0,
        finalize: bool = True,
    ) -> TaskStatus:
        precondition_step_boundary = (
            warm_state.step_count if warm_state is not None else 0
        )
        if warm_state is not None:
            state = warm_state
            state.instruction = instruction
            state.task_name = task_name
            state.attempt = attempt
        else:
            state = RunState(
                instruction=instruction,
                task_name=task_name,
                attempt=attempt,
            )
        reason: str | None = None
        status = TaskStatus.BLOCKED
        timer = measure_time("total_duration")

        try:
            with timer:
                status, reason = await asyncio.wait_for(
                    self._run_loop(job_id, state, step_offset),
                    timeout=self._execution_timeout,
                )
        except TimeoutError:
            reason = f"Execution exceeded {self._execution_timeout}s limit"
            status = TaskStatus.BLOCKED
        except Exception as exc:
            reason = f"Unexpected error during execution: {_format_exception_summary(exc)}"
            status = TaskStatus.BLOCKED
            raise
        finally:
            await self._safe_cleanup()
            if finalize:
                await self._event_logger.record_completion(
                    job_id, timer.elapsed, status.value,
                    task_name=task_name,
                    instruction=instruction,
                    device_id=self._controller.device_id,
                    reason=reason,
                    attempt=attempt,
                    preconditions=state.preconditions,
                    precondition_duration=state.precondition_duration_s,
                    total_duration=(
                        state.precondition_duration_s + timer.elapsed
                    ),
                    precondition_step_boundary=precondition_step_boundary,
                )
        return status

    async def _run_loop(
        self,
        task_id: str,
        state: RunState,
        step_offset: int = 0,
    ) -> tuple[TaskStatus, str | None]:
        start_step = step_offset + state.step_count
        ctx = StopContext(
            step=start_step,
            consecutive_no_progress=0, action_keys=state.action_keys,
        )

        await self._controller.ensure_connected()
        if start_step == 0:
            await self._controller.reset()

        for ctx.step in itertools.count(start_step + 1):
            decision = evaluate_policies(self._stop_policies, ctx)
            if decision is not None:
                reason = decision.reason
                if state.progress_status:
                    reason = (
                        f"{reason}; last known state: "
                        f"{state.progress_status}"
                    )
                return decision.status, reason

            prev_progress = state.progress_status
            prev_goal = state.current_step_goal

            try:
                result = await self._run_step(task_id, ctx.step, state)
            except ADBCommandError:
                await self._event_logger.record(
                    "error", task_id, ctx.step,
                    message="Running ADB command failed",
                )
                raise
            except LLMHubError as exc:
                await self._event_logger.record(
                    "error", task_id, ctx.step,
                    message=(
                        "LLM inference failed: "
                        f"{self._format_error(exc)}. Retrying."
                    ),
                )
                ctx.consecutive_no_progress += 1
                continue
            except AnswerFormatError as exc:
                feedback = (
                    f"Your previous response could not be parsed: {exc}."
                    " Re-read the action-format requirements and respond"
                    " with exactly one well-formed action."
                )
                await self._event_logger.record(
                    "error", task_id, ctx.step,
                    message=f"Malformed operator response: {exc}",
                )
                state.last_reflection_obj = Reflection(
                    what_happened=feedback,
                    outcome="failure",
                    updated_state=state.progress_status,
                    next_step_goal=state.current_step_goal,
                )
                ctx.consecutive_no_progress += 1
                continue
            except Exception as exc:
                await self._event_logger.record(
                    "error", task_id, ctx.step,
                    traceback="".join(traceback.format_exception(exc)),
                    message=f"Unexpected error: {self._format_error(exc)}",
                )
                raise

            if result is not None:
                return result

            if state.last_reflection_obj is not None:
                progress_made = self._has_progress(
                    prev_progress,
                    prev_goal,
                    state.last_reflection_obj,
                )
                if progress_made:
                    ctx.consecutive_no_progress = 0
                else:
                    ctx.consecutive_no_progress += 1

        return TaskStatus.BLOCKED, None  # unreachable

    @staticmethod
    def _format_error(exc: Exception) -> str:
        error_cls = type(exc).__name__
        detail = str(exc).strip()
        return f"{error_cls}: {detail}" if detail else error_cls

    @measure_time("round_duration")
    async def _run_step(
        self,
        task_id: str,
        step: int,
        state: RunState,
    ) -> tuple[TaskStatus, str | None] | None:
        """Execute a single operator->action->reflector
        step. Returns (status, reason) if task is done."""
        before = await self._take_step_screenshot(
            task_id, step, "before", state.attempt,
        )
        try:
            action, finished = await self._operator_step(
                task_id, step, state, before,
            )
        finally:
            if self._history_length <= 0:
                before.drop_data_cache()
            self._drop_stale_history_images(state)
            state.operator_data.clear()

        if finished is not None:
            return finished

        oob_feedback = self._check_action_bounds(action, before.original_size)
        if oob_feedback is not None:
            await self._event_logger.record(
                "sanity_check", task_id, step, attempt=state.attempt,
                action=action.name, args=action.args,
                screenshot_size=list(before.original_size),
                reason=oob_feedback,
            )
            self._cache_action(state, action)
            self._update_state(
                state,
                action,
                Reflection(
                    what_happened=oob_feedback,
                    outcome="failure",
                    updated_state=state.progress_status,
                    next_step_goal=state.current_step_goal,
                ),
            )
            return None

        self._cache_action(state, action)

        try:
            exec_result = await self._execute_action(
                action.name, action.args, state, task_id, step,
            )
        except UnknownAppError as exc:
            feedback = (
                f"{action.name} failed: {exc}. The app could not be"
                " resolved to an installed package. Instead of"
                f" using {action.name}, try interacting with the app"
                " visually: locate the app icon on the app drawer or"
                " home screen and tap it directly."
            )
            self._update_state(
                state,
                action,
                Reflection(
                    what_happened=feedback,
                    outcome="failure",
                    updated_state=state.progress_status,
                    next_step_goal=state.current_step_goal,
                ),
            )
            return None

        if exec_result:
            await self._event_logger.record(
                "action_result", task_id, step, attempt=state.attempt,
                action=action.name,
                execution_result=exec_result.to_dict(),
            )

        if exec_result.clipboard_content is not None:
            state.operator_data["Clipboard content"] = (
                exec_result.clipboard_content
            )
            await self._event_logger.record(
                "clipboard", task_id, step, attempt=state.attempt,
                content=exec_result.clipboard_content,
            )

        if exec_result.listing is not None:
            key = (
                "Available resources"
                if action.name.lower() == "resourcelist"
                else "Device files"
            )
            state.operator_data[key] = exec_result.listing
            await self._event_logger.record(
                "file_listing", task_id, step, attempt=state.attempt,
                action=action.name,
                listing=exec_result.listing,
            )

        await self._wait_between_steps(step)

        if self._reflector_enabled:
            after = await self._take_step_screenshot(
                task_id, step, "after", state.attempt,
            )

            try:
                reflection = await self._reflect_step(
                    task_id,
                    step,
                    state,
                    action.name,
                    action.conclusion,
                    before,
                    after,
                )
            finally:
                after.drop_data_cache()
        else:
            reflection = None

        self._update_state(state, action, reflection)

        task_complete = "task is complete."
        if (
            reflection is not None
            and reflection.next_step_goal.strip().lower()
            == task_complete
        ):
            return TaskStatus.COMPLETED, None

        return None

    @measure_time("screenshot_total_duration")
    async def _take_step_screenshot(
        self, task_id: str, step: int, tag: str,
        attempt: int | None,
    ) -> Image:
        """Capture a screenshot, optionally downscaled for the LLM.

        The returned :class:`Image` may be downscaled to fit
        :attr:`_max_screenshot_size` (what the LLM sees). Its
        :attr:`Image.original_size` carries the raw device pixel
        dimensions - that is the coordinate space ADB expects.
        """
        seq = 1 if tag == "before" else 2
        prefix = f"attempt-{attempt}/" if attempt is not None else ""
        name = f"{prefix}step-{step:03d}-{seq}-{tag}.jpg"

        raw = await self._controller.screenshot()
        image = raw.to_jpeg(max_size=self._max_screenshot_size)

        with measure_time("screenshot_store_duration"):
            await self._image_store.put(image, name=name)

        await self._event_logger.record(
            "screenshot", task_id, step, attempt=attempt,
            image=image, description=f"{tag}-action",
        )
        return image

    @measure_time("operator_duration")
    async def _operator_step(
        self,
        task_id: str,
        step: int,
        state: RunState,
        screenshot: Image,
    ) -> tuple[ParsedAction, tuple[TaskStatus, str | None] | None]:
        """Run the operator LLM, parse its action, rescale
        coordinates from perceived to device space, and log the result.

        Returns ``(action, finished)`` where *finished* is
        ``(status, reason)`` when the operator chose ``Finished``,
        otherwise ``None``.
        """
        perceived_size = self._coordinate_space or screenshot.size
        operator_prompt = await self._prompts.render_operator(
            state,
            image_size=perceived_size,
        )
        message_history = (
            state.operator_history[-self._history_length:]
            if self._history_length > 0
            else None
        )
        operator_raw = await self._llm.ask(
            operator_prompt, screenshot, history=message_history,
        )
        action = parse_operator_response(operator_raw)

        self._apply_step_transition(state, action.current_step)

        state.operator_history.append(
            (operator_prompt, screenshot, operator_raw),
        )

        raw_args = dict(action.args)
        self._rescale_coordinates(
            action, perceived_size, screenshot.original_size,
        )

        rescaled_args = (
            action.args if raw_args != action.args else None
        )
        await self._event_logger.record(
            "operator", task_id, step, attempt=state.attempt,
            thought=action.thought,
            action=action.name,
            args=raw_args,
            rescaled_args=rescaled_args,
            conclusion=action.conclusion,
            current_step=state.current_step or None,
            current_step_id=state.current_step_id or None,
            prompt=operator_prompt if self._log_llm_inputs else None,
            history_turns=len(message_history) if message_history else 0,
        )

        if action.name == "Finished":
            return action, self._translate_finished_status(action)

        return action, None

    @staticmethod
    def _translate_finished_status(
        action: ParsedAction,
    ) -> tuple[TaskStatus, str | None]:
        """Resolve a parsed ``Finished`` action to ``(status, summary)``.

        The verdict is validated by :func:`parse_operator_response`, so
        the lookup is total.
        """
        verdict = str(action.args["verdict"])
        summary = str(action.args.get("content", "")) or None
        return _FINISHED_VERDICT_STATUS[verdict], summary

    @staticmethod
    def _rescale_coordinates(
        action: ParsedAction,
        perceived_size: tuple[int, int],
        device_size: tuple[int, int],
    ) -> None:
        """Rescale ``action`` coords from *perceived_size* (the space
        the model emitted in) to *device_size* (the space ADB expects).

        No-op when the two sizes are equal.
        """
        if perceived_size == device_size:
            return
        for key in _COORDINATE_ARG_KEYS:
            value = action.args.get(key)
            if isinstance(value, tuple):
                action.args[key] = rescale_point(
                    cast(Point, value),
                    perceived_size,
                    device_size,
                )

    @staticmethod
    def _check_action_bounds(
        action: ParsedAction,
        screenshot_size: tuple[int, int],
    ) -> str | None:
        """Return a quantitatively descriptive failure message if any
        coordinate in *action* falls outside *screenshot_size*; otherwise
        ``None``."""
        sw, sh = screenshot_size
        violations: list[str] = []
        for key in _COORDINATE_ARG_KEYS:
            value = action.args.get(key)
            if not isinstance(value, tuple):
                continue
            x, y = cast(Point, value)
            if not (0 <= x < sw and 0 <= y < sh):
                violations.append(f"{key}=({x}, {y})")

        feedback = None
        if violations:
            feedback = (
                f"{action.name} was rejected and NOT executed: coordinate(s) "
                f"{', '.join(violations)} fall outside the screen bounds "
                f"{sw}x{sh} (valid x: 0..{sw - 1}, valid y: 0..{sh - 1}). "
                "Re-examine the screenshot and pick coordinates that lie "
                "inside the visible image."
            )
        return feedback

    def _cache_action(self, state: RunState, action: ParsedAction) -> None:
        state.action_keys.append(
            compute_action_key(action.name, action.args),
        )

    @measure_time("action_execution_duration")
    async def _execute_action(
        self,
        name: str,
        args: dict[str, object],
        state: RunState,
        task_id: str,
        step: int,
    ) -> ActionExecutionResult:
        """
        Execute *name* with *args* and return structured execution output.
        """
        result = ActionExecutionResult()
        if name.lower() in ("launch", "forcestop", "uninstall"):
            package = await self._resolve_app_package(
                state, task_id, step, str(args["app"]),
            )
            args = {
                **args,
                "app": package,
            }
            result.resolved_package = package

        try:
            dispatch_result = await self._controller.dispatch_action(
                name, args,
            )
        except ValueError as exc:
            raise AnswerFormatError(str(exc)) from exc

        if name.lower() == "clipboardget" and isinstance(dispatch_result, str):
            result.clipboard_content = dispatch_result

        if (name.lower() in ("resourcelist", "filelist")
                and isinstance(dispatch_result, str)):
            result.listing = dispatch_result

        return result

    async def _resolve_app_package(
        self,
        state: RunState,
        task_id: str,
        step: int,
        app: str,
    ) -> str:
        """Resolve *app* to an installed package name.

        Tries the controller's app map first. If the resolved
        package is not installed (or *app* couldn't be resolved at
        all), asks the LLM to pick one from the device's installed
        packages.
        """
        installed = await self._controller.list_installed_packages()
        resolved = self._controller.try_resolve_package(app)
        if resolved is not None and resolved in installed:
            return resolved

        sorted_installed = sorted(installed)
        prompt = await self._prompts.render_launch_picker(
            state,
            requested_app=app,
            installed_packages=sorted_installed,
        )
        answer = (await self._llm.ask(prompt)).strip()
        chosen_app = answer.splitlines()[0].strip() if answer else ""
        await self._event_logger.record(
            "launch_picker", task_id, step, attempt=state.attempt,
            requested_app=app,
            resolved=resolved,
            llm_answer=answer,
        )
        if chosen_app and chosen_app != "NONE" and chosen_app in installed:
            return chosen_app

        raise UnknownAppError(
            f"Could not resolve app {app!r} to an installed package"
            f" (LLM answer: {answer!r})"
        )

    @measure_time("sleep_duration")
    async def _wait_between_steps(self, step: int) -> None:
        delay = (
            self._first_step_sleep
            if step == 1
            else self._sleep_between_steps
        )
        await asyncio.sleep(delay)

    @measure_time("reflector_duration")
    async def _reflect_step(
        self,
        task_id: str,
        step: int,
        state: RunState,
        last_action: str,
        last_summary: str,
        before: Image,
        after: Image,
    ) -> Reflection | None:
        """Run the reflector LLM and parse its response.

        Returns ``None`` if the reflector's response is malformed.
        """
        reflector_prompt = await self._prompts.render_reflector(
            state, last_action, last_summary,
        )
        reflector_raw = await self._llm.ask(reflector_prompt, before, after)
        try:
            (
                what_happened,
                outcome,
                updated_state,
                next_step_goal,
                current_step,
            ) = parse_reflector_response(reflector_raw)
        except AnswerFormatError as exc:
            await self._event_logger.record(
                "error", task_id, step, attempt=state.attempt,
                message=(
                    f"Malformed reflector response, skipping: {exc}"
                ),
            )
            return None

        await self._event_logger.record(
            "reflector", task_id, step, attempt=state.attempt,
            outcome=outcome,
            what_happened=what_happened,
            progress=updated_state,
            next_goal=next_step_goal,
            current_step=current_step,
            prompt=reflector_prompt if self._log_llm_inputs else None,
        )

        return Reflection(
            what_happened=what_happened,
            outcome=outcome,
            updated_state=updated_state,
            next_step_goal=next_step_goal,
            current_step=current_step,
        )

    def _drop_stale_history_images(self, state: RunState) -> None:
        """Drop image data for history entries that have fallen
        outside the history window."""
        if self._history_length <= 0:
            return
        stale = len(state.operator_history) - self._history_length
        for i in range(max(0, stale - 1)):
            _, img, _ = state.operator_history[i]
            img.drop_data_cache()

    def _update_state(
        self,
        state: RunState,
        action: ParsedAction,
        reflection: Reflection | None,
    ) -> None:
        state.actions.append(action.name)
        state.summaries.append(action.conclusion)
        if reflection is not None:
            state.progress_status = reflection.updated_state
            state.current_step_goal = reflection.next_step_goal
            self._apply_step_transition(state, reflection.current_step)
            state.last_reflection_obj = reflection

    @staticmethod
    def _apply_step_transition(
        state: RunState,
        new_step: str | None,
    ) -> None:
        """Advance the user-task step pointer when *new_step* names a
        new step. Step IDs are programmatic ascending ints starting at 1.
        """
        if not new_step:
            return
        if new_step == state.current_step:
            return
        state.current_step = new_step
        state.current_step_id += 1

    def _has_progress(
        self,
        prev_progress: str,
        prev_goal: str,
        reflection: Reflection,
    ) -> bool:
        updated_state = reflection.updated_state.strip()
        next_goal = reflection.next_step_goal.strip()
        outcome = reflection.outcome.strip().lower()
        if outcome in {"success", "partial"}:
            return True
        if updated_state and updated_state != prev_progress.strip():
            return True
        if next_goal and next_goal != prev_goal.strip():
            return True
        return False

    async def _safe_cleanup(self) -> None:
        if self._reset_after_execution:
            try:
                await self._controller.reset()
            except Exception:
                pass


class ScriptRecordingRunner(TestRunner):
    """Captures every executed action + a11y target into an ActionScript."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.script = ActionScript(instruction="")
        self._start_time: float = 0.0

    async def _operator_step(
        self,
        task_id: str,
        step: int,
        state: RunState,
        screenshot: Image,
    ) -> tuple[ParsedAction, tuple[TaskStatus, str | None] | None]:
        if not self._start_time:
            self._start_time = time.monotonic()

        action, finished = await super()._operator_step(
            task_id, step, state, screenshot,
        )

        target_node = await self._resolve_target(action)

        self.script.steps.append(ActionStep(
            elapsed_s=time.monotonic() - self._start_time,
            action_name=action.name,
            action_args=dict(action.args),
            conclusion=action.conclusion,
            target_node=target_node,
            screenshot_uri=screenshot.uri or "",
        ))

        return action, finished

    async def _execute_action(
        self,
        name: str,
        args: dict[str, object],
        state: RunState,
        task_id: str,
        step: int,
    ) -> ActionExecutionResult:
        result = await super()._execute_action(
            name, args, state, task_id, step,
        )
        if result.resolved_package and self.script.steps:
            self.script.steps[-1].action_args["app"] = (
                result.resolved_package
            )
        return result

    @measure_time("resolve_target_duration")
    async def _resolve_target(
        self, action: ParsedAction,
    ) -> dict[str, object] | None:
        if action.name == "Type":
            return await self._resolve_focused_target()
        if action.name not in ("Click", "LongPress"):
            return None
        point = action.args.get("point")
        if not isinstance(point, tuple):
            return None
        try:
            xml = await self._controller.dump_stable_ui_tree()
            hits = resolve_click(xml, point[0], point[1])
            if hits:
                return hits[0].to_dict()
        except Exception:
            logger.debug("a11y tree dump failed", exc_info=True)
        return None

    async def _resolve_focused_target(
        self,
    ) -> dict[str, object] | None:
        try:
            xml = await self._controller.dump_stable_ui_tree()
            node = find_focused_node(xml)
            if node:
                return node.to_dict()
        except Exception:
            logger.debug("focused node lookup failed", exc_info=True)
        return None


def _format_exception_summary(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc!r}"
