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
import uuid
from typing import cast

from android_tester.actions import (
    ParsedAction,
    parse_operator_response,
    parse_reflector_response,
)
from android_tester.android_controller import (
    ADBCommandError,
    AndroidController,
    UnknownAppError,
)
from android_tester.image_store import Image, ImageStore
from android_tester.llm_hub import LLMHubClient, LLMHubError
from android_tester.models import (
    AnswerFormatError,
    Reflection,
    RunState,
    TaskStatus,
)
from android_tester.prompts import PromptRenderer
from android_tester.recorder import RunRecorder
from android_tester.stop_policies import (
    MaxStepsPolicy,
    NoProgressPolicy,
    RepetitiveActionPolicy,
    StopContext,
    StopPolicy,
    evaluate_policies,
)
from android_tester.telemetry import measure_time
from android_tester.utils import rescale_point

Point = tuple[int, int]

logger = logging.getLogger(__name__)


class TestRunner:
    def __init__(
        self,
        controller: AndroidController,
        llm: LLMHubClient,
        prompts: PromptRenderer,
        recorder: RunRecorder,
        image_store: ImageStore,
        stop_policies: list[StopPolicy] | None = None,
        max_steps: int = 35,
        max_no_progress_steps: int = 6,
        max_repetitive_actions: int = 5,
        sleep_between_steps: float = 2.,
        first_step_sleep: float = 6.,
        execution_timeout: float = 0.,
        model_image_size: tuple[int, int] | None = None,
        model_auto_resize_width: int = 0,
        reflector_enabled: bool = True,
        n_retries: int = 0,
        log_llm_inputs: bool = False,
        history_length: int = 0,
    ) -> None:
        self._controller = controller
        self._llm = llm
        self._prompts = prompts
        self._recorder = recorder
        self._image_store = image_store
        self._stop_policies = stop_policies
        self._max_steps = max_steps
        self._max_no_progress_steps = max_no_progress_steps
        self._max_repetitive_actions = max_repetitive_actions
        self._sleep_between_steps = sleep_between_steps
        self._first_step_sleep = first_step_sleep
        self._execution_timeout = execution_timeout or None  # 0 = no timeout
        self._model_image_size = model_image_size
        self._model_auto_resize_width = model_auto_resize_width
        self._reflector_enabled = reflector_enabled
        self._n_retries = n_retries
        self._log_llm_inputs = log_llm_inputs
        self._history_length = history_length

    async def run(
        self,
        instruction: str,
        task_id: str | None = None,
        task_name: str | None = None,
    ) -> TaskStatus:
        job_id = task_id or str(uuid.uuid4())
        max_attempts = max(1, self._n_retries + 1)
        status = TaskStatus.FAILED
        for attempt in range(1, max_attempts + 1):
            attempt_label = attempt if max_attempts > 1 else None
            status = await self._run_attempt(
                job_id, instruction, task_name, attempt_label,
            )
            if status == TaskStatus.COMPLETED:
                return status
            if attempt < max_attempts:
                logger.warning(
                    "attempt %d/%d failed (status=%s); retrying",
                    attempt, max_attempts, status.value,
                )
        return status

    async def _run_attempt(
        self,
        job_id: str,
        instruction: str,
        task_name: str | None,
        attempt: int | None,
    ) -> TaskStatus:
        state = RunState(
            instruction=instruction,
            task_name=task_name,
            attempt=attempt,
        )
        reason: str | None = None
        status = TaskStatus.FAILED
        timer = measure_time("total_duration")

        try:
            with timer:
                status, reason = await asyncio.wait_for(
                    self._run_loop(job_id, state),
                    timeout=self._execution_timeout,
                )
        except TimeoutError:
            reason = f"Execution exceeded {self._execution_timeout}s limit"
            status = TaskStatus.FAILED
        except Exception:
            reason = "Unexpected error during execution"
            status = TaskStatus.FAILED
            raise
        finally:
            await self._safe_cleanup()
            await self._recorder.record_completion(
                job_id, timer.elapsed, status.value,
                task_name=task_name,
                instruction=instruction,
                device_id=self._controller.device_id,
                reason=reason,
                attempt=attempt,
            )
        return status

    async def _run_loop(
        self,
        task_id: str,
        state: RunState,
    ) -> tuple[TaskStatus, str | None]:
        ctx = StopContext(
            step=0,
            consecutive_no_progress=0, action_keys=state.action_keys,
        )
        policies = self._stop_policies or [
            MaxStepsPolicy(max_steps=self._max_steps),
            NoProgressPolicy(
                max_no_progress_steps=self._max_no_progress_steps,
            ),
            RepetitiveActionPolicy(
                max_repetitions=self._max_repetitive_actions,
            ),
        ]

        await self._controller.ensure_connected()
        await self._controller.reset()

        for ctx.step in itertools.count(1):
            decision = evaluate_policies(policies, ctx)
            if decision is not None:
                return decision.status, decision.reason

            prev_progress = state.progress_status
            prev_goal = state.current_step_goal

            try:
                result = await self._run_step(task_id, ctx.step, state)
            except ADBCommandError:
                await self._recorder.record(
                    "error", task_id, ctx.step,
                    message="Running ADB command failed",
                )
                raise
            except LLMHubError as exc:
                await self._recorder.record(
                    "error", task_id, ctx.step,
                    message=f"LLM inference failed: {exc}. Retrying.",
                )
                ctx.consecutive_no_progress += 1
                continue
            except Exception as exc:
                await self._recorder.record(
                    "error", task_id, ctx.step,
                    message=f"Unexpected error: {exc}",
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

        return TaskStatus.FAILED, None  # unreachable

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

        if finished is not None:
            return finished

        self._cache_action(state, action)

        try:
            await self._execute_action(
                action.name, action.args, state, task_id, step,
            )
        except UnknownAppError as exc:
            feedback = (
                f"Launch failed: {exc}. The app could not be"
                " resolved to an installed package. Instead of"
                " using Launch, try opening the app visually:"
                " try to locate the app icon on the app drawer"
                " or home screen and tap the app icon directly."
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
        seq = 1 if tag == "before" else 2
        prefix = f"attempt-{attempt}/" if attempt is not None else ""
        name = f"{prefix}step-{step:03d}-{seq}-{tag}.jpg"

        image = (await self._controller.screenshot()).to_jpeg()

        with measure_time("screenshot_store_duration"):
            await self._image_store.put(image, name=name)

        await self._recorder.record(
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
        coordinates if needed, and log the result.

        Returns ``(action, finished)`` where *finished* is
        ``(status, reason)`` when the operator chose ``Finished``,
        otherwise ``None``.
        """
        operator_prompt = await self._prompts.render_operator(state)
        history = (
            state.operator_history[-self._history_length:]
            if self._history_length > 0
            else None
        )
        operator_raw = await self._llm.ask(
            operator_prompt, screenshot, history=history,
        )
        action = parse_operator_response(operator_raw)

        state.operator_history.append(
            (operator_prompt, screenshot, operator_raw),
        )

        raw_args = dict(action.args)
        self._rescale_coordinates(action, screenshot.size)

        rescaled_args = (
            action.args if raw_args != action.args else None
        )
        await self._recorder.record(
            "operator", task_id, step, attempt=state.attempt,
            thought=action.thought,
            action=action.name,
            args=raw_args,
            rescaled_args=rescaled_args,
            conclusion=action.conclusion,
            prompt=operator_prompt if self._log_llm_inputs else None,
            history_turns=len(history) if history else 0,
        )

        if action.name == "Finished":
            summary = str(action.args.get("content", ""))
            return action, (TaskStatus.COMPLETED, summary or None)

        return action, None

    def _rescale_coordinates(
        self,
        action: ParsedAction,
        screenshot_size: tuple[int, int],
    ) -> None:
        model_size = self._model_image_size
        target_w = self._model_auto_resize_width
        if model_size is None and target_w and screenshot_size[0] > target_w:
            sw, sh = screenshot_size
            model_size = (target_w, round(sh * target_w / sw))
        if model_size is not None:
            for key in ("point", "start", "end"):
                if key in action.args and isinstance(action.args[key], tuple):
                    action.args[key] = rescale_point(
                        cast(Point, action.args[key]),
                        model_size,
                        screenshot_size,
                    )

    def _cache_action(self, state: RunState, action: ParsedAction) -> None:
        state.action_keys.append(
            self._compute_action_key(action.name, action.args),
        )

    @staticmethod
    def _compute_action_key(name: str, args: dict[str, object]) -> str:
        """Build a hashable key from an action for repetition detection."""
        parts = [name]
        for k, v in sorted(args.items()):
            parts.append(f"{k}-{v}")
        return "-".join(parts)

    @measure_time("action_execution_duration")
    async def _execute_action(
        self,
        name: str,
        args: dict[str, object],
        state: RunState,
        task_id: str,
        step: int,
    ) -> None:
        match name.lower():
            case "click":
                self._require_args(name, args, "point")
                await self._controller.click(cast(Point, args["point"]))
            case "longpress":
                self._require_args(name, args, "point")
                await self._controller.long_press(
                    cast(Point, args["point"]),
                )
            case "drag":
                self._require_args(name, args, "start", "end")
                await self._controller.drag(
                    cast(Point, args["start"]),
                    cast(Point, args["end"]),
                )
            case "scroll":
                self._require_args(name, args, "start", "end")
                await self._controller.scroll(
                    cast(Point, args["start"]),
                    cast(Point, args["end"]),
                )
            case "type":
                self._require_args(name, args, "content")
                await self._controller.type_text(str(args["content"]))
            case "launch":
                self._require_args(name, args, "app")
                package = await self._resolve_launch_package(
                    state, task_id, step, str(args["app"]),
                )
                await self._controller.launch(package)
            case "wait":
                await self._controller.wait(1.0)
            case "pressback":
                await self._controller.press_back()
            case "presshome":
                await self._controller.press_home()
            case "pressenter":
                await self._controller.press_enter()
            case "pressrecentapps":
                await self._controller.press_recent_apps()
            case _:
                raise AnswerFormatError(f"Unsupported action: {name}")

    @staticmethod
    def _require_args(name: str, args: dict[str, object], *keys: str) -> None:
        missing = {k for k in keys if k not in args}
        if missing:
            keys_str = ", ".join(sorted(missing))
            raise AnswerFormatError(
                f"Action {name!r} missing required"
                f" args: {keys_str}",
            )

    async def _resolve_launch_package(
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
        await self._recorder.record(
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
    ) -> Reflection:
        reflector_prompt = await self._prompts.render_reflector(
            state, last_action, last_summary,
        )
        reflector_raw = await self._llm.ask(reflector_prompt, before, after)
        (
            what_happened,
            outcome,
            updated_state,
            next_step_goal,
        ) = parse_reflector_response(reflector_raw)

        await self._recorder.record(
            "reflector", task_id, step, attempt=state.attempt,
            outcome=outcome,
            what_happened=what_happened,
            progress=updated_state,
            next_goal=next_step_goal,
            prompt=reflector_prompt if self._log_llm_inputs else None,
        )

        return Reflection(
            what_happened=what_happened,
            outcome=outcome,
            updated_state=updated_state,
            next_step_goal=next_step_goal,
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
            state.last_reflection_obj = reflection

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
        try:
            await self._controller.clear_running_apps()
        except Exception:
            pass
