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

"""Precondition manager: record once, replay thereafter.

On first encounter of a precondition label, runs the precondition
agent to establish the device state and records an action script
to disk.  On subsequent encounters, replays the cached script for
a fast, deterministic setup.

Each precondition is stored under ``<cache_dir>/<label>/`` — a
task-independent location so the cache is shared across tasks — with
``action_log.json`` (the recorded setup script) and ``description.txt``
(the natural-language precondition description).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from android_tester.action_script import ActionScript
from android_tester.actions import compute_action_key
from android_tester.android_controller import AndroidController
from android_tester.event_logger import EventLogger
from android_tester.image_store import ImageStore
from android_tester.llm_hub import LLMHubClient
from android_tester.models import RunState, TaskStatus
from android_tester.prompts import PreconditionPromptRenderer
from android_tester.runner import ScriptRecordingRunner, TestRunner
from android_tester.script_replayer import ScriptReplayer
from android_tester.telemetry import measure_time
from android_tester.utils import write_file_atomically

logger = logging.getLogger(__name__)


class PreconditionPlanError(RuntimeError):
    """Raised when the planner response can't be turned into a valid order."""


def parse_precondition_order(answer: str, labels: list[str]) -> list[str]:
    """Return *labels* in the order named by the planner's JSON *answer*.

    The answer must be a clean ``{"order": [...]}`` object naming every
    label exactly once (case-insensitive; duplicates are dropped). Raises
    :class:`PreconditionPlanError` on bad JSON, an unknown label, or a
    missing one, so a broken plan can never silently reorder the wrong set.
    """
    try:
        order = json.loads(answer.strip())["order"]
        if not isinstance(order, list):
            raise TypeError
    except (ValueError, TypeError, KeyError) as exc:
        raise PreconditionPlanError(
            f"planner response was not a clean {{'order': [...]}}: "
            f"{answer[:200]!r}"
        ) from exc

    unique_order = _deduplicate(order)

    if len(unique_order) != len(labels):
        raise PreconditionPlanError(
            f"planner response must name every label exactly once; "
            f"expected {labels}, got {order}",
        )

    return unique_order


def _deduplicate(labels: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for label in labels:
        if label not in seen:
            seen.add(label)
            deduped.append(label)
    return deduped


class PreconditionManager:
    """Record-once / replay-thereafter precondition handler."""

    def __init__(
        self,
        controller: AndroidController,
        llm: LLMHubClient,
        data_root: Path,
        cache_dir: Path,
        event_logger: EventLogger,
        image_store: ImageStore,
        runner_kwargs: dict[str, Any] | None = None,
        resources_available: bool = False,
    ) -> None:
        self._controller = controller
        self._llm = llm
        self._prompts = PreconditionPromptRenderer(
            data_root, resources_available=resources_available,
        )
        self._cache_dir = cache_dir
        self._event_logger = event_logger
        self._image_store = image_store
        self._runner_kwargs = runner_kwargs or {}
        # reset would undo the precondition established
        self._runner_kwargs["reset_after_execution"] = False

    @measure_time("precondition_establish_duration")
    async def establish(
        self,
        label: str,
        text: str,
        task_id: str,
        step_offset: int = 0,
    ) -> RunState | None:
        """Establish the precondition. Its setup steps are numbered
        starting after *step_offset* so multiple preconditions occupy
        distinct ranges in the shared event log; only the first
        precondition (``step_offset == 0``) resets the device.

        Any foreground app is force-stopped first so every precondition
        starts from a clean home screen, independent of where the
        previous precondition's UI happened to end.
        """
        await self._controller.close_running_apps()

        script_path = self._get_script_path(label)
        script = self._try_load_script(script_path)

        if script is not None:
            state = await self._replay(
                label, script, task_id, step_offset,
            )
            if state is not None:
                if state.step_count >= len(script.steps):
                    return state
                # Partial replay — let the precondition LLM
                # continue from where the replay stopped.
                return await self._continue(
                    label, text, task_id, state, step_offset,
                )

        if not text:
            logger.warning("no text for %r and no cached script", label)
            return None

        return await self._record(label, text, task_id, step_offset)

    @staticmethod
    def _try_load_script(path: Path) -> ActionScript | None:
        """Load *path* as an ActionScript, or return ``None`` if the file
        is missing, unreadable, or malformed. A failed load is treated
        as if no cached script exists, so the caller falls back to
        recording a new one.
        """
        if not path.exists():
            return None
        try:
            return ActionScript.load(path)
        except Exception as exc:
            logger.warning(
                "cached script %s could not be loaded (%s); ignore it.",
                path, exc,
            )
            return None

    def _get_script_path(self, label: str) -> Path:
        return self._cache_dir / label / "action_log.json"

    async def order_preconditions(
        self,
        preconditions: list[tuple[str, str]],
        task_id: str,
    ) -> list[tuple[str, str]]:
        """Order *preconditions* up front with a single planner LLM call.

        Duplicate input labels are dropped (first wins). Returns the same
        ``(label, description)`` pairs in the chosen order, skipping the
        call when there are < 2 unique items. Any planner failure raises
        :class:`PreconditionPlanError` and fails the run rather than
        silently proceeding in the wrong order.
        """
        # dict keeps first-seen order and drops duplicate labels.
        by_label: dict[str, str] = {}
        for label, text in preconditions:
            by_label.setdefault(label, text)
        deduped = list(by_label.items())
        if len(deduped) < 2:
            return deduped

        labels = [label for label, _ in deduped]
        prompt = await self._prompts.render_precondition_planner(deduped)
        answer = (await self._llm.ask(prompt)).strip()

        ordered_labels = parse_precondition_order(answer, labels)
        await self._event_logger.record(
            "precondition_plan", task_id,
            input_order=labels,
            chosen_order=ordered_labels,
            llm_answer=answer,
        )
        return [(label, by_label[label]) for label in ordered_labels]

    @measure_time("precondition_record_duration")
    async def _record(
        self, label: str, text: str, task_id: str, step_offset: int,
    ) -> RunState | None:
        script_path = self._get_script_path(label)

        runner = ScriptRecordingRunner(
            controller=self._controller, llm=self._llm,
            prompts=self._prompts, event_logger=self._event_logger,
            image_store=self._image_store, **self._runner_kwargs,
        )
        runner.script.instruction = text
        status = await runner.run(
            instruction=text,
            task_id=f"{task_id}-precondition-{label}",
            task_name=f"Precondition: {label}",
            step_offset=step_offset,
            finalize=False,
        )

        if not runner.script.steps or status != TaskStatus.COMPLETED:
            logger.warning(
                "precondition %r failed (status=%s)",
                label, status.value,
            )
            return None

        runner.script.status = status.value
        runner.script.elapsed_s = runner.script.steps[-1].elapsed_s
        runner.script.save(script_path)
        self._save_description(label, text)
        logger.info(
            "precondition %r recorded (%d steps)",
            label, len(runner.script.steps),
        )

        state = RunState(instruction=text)
        for step in runner.script.steps:
            state.actions.append(step.action_name)
            state.summaries.append(step.conclusion)
            state.action_keys.append(
                compute_action_key(
                    step.action_name, step.action_args,
                ),
            )
        return state

    def _save_description(self, label: str, text: str) -> None:
        write_file_atomically(
            self._cache_dir / label / "description.txt", text,
        )

    async def _continue(
        self,
        label: str,
        text: str,
        task_id: str,
        warm_state: RunState,
        step_offset: int,
    ) -> RunState | None:
        """Continue establishing a precondition with the LLM
        after a partial script replay."""
        runner = TestRunner(
            controller=self._controller,
            llm=self._llm,
            prompts=self._prompts,
            event_logger=self._event_logger,
            image_store=self._image_store,
            **self._runner_kwargs,
        )
        status = await runner.run(
            instruction=text,
            task_id=f"{task_id}-precondition-{label}",
            task_name=f"Precondition: {label} (continued)",
            warm_state=warm_state,
            step_offset=step_offset,
            finalize=False,
        )
        if status != TaskStatus.COMPLETED:
            logger.warning(
                "precondition %r continuation failed",
                label,
            )
            return None
        return warm_state

    @measure_time("precondition_replay_duration")
    async def _replay(
        self,
        label: str,
        script: ActionScript,
        task_id: str,
        step_offset: int,
    ) -> RunState | None:
        replayer = ScriptReplayer(
            self._controller, self._event_logger, self._image_store,
        )
        result = await replayer.replay(
            script,
            task_id=f"{task_id}-precondition-{label}",
            step_offset=step_offset,
            reset=step_offset == 0,
        )
        if result.steps_completed == 0 and len(script.steps) > 0:
            return None
        return result.state
