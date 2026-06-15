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

"""Replay an action script as a setup prefix.

For each recorded step, tries two matching tiers:
1. A11y tree match — poll for the recorded DOM node within the recorded
   time window, execute at the live node's center.
2. Pixel match — compare screenshot crops around the recorded click
   coordinates, execute at the original coordinates if they match.

If neither tier succeeds for a step, the replayer stops and returns
the partially-built RunState. The caller hands this state to TestRunner
which continues with LLM-driven execution.
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
from dataclasses import dataclass

from android_tester.a11y import (
    UINode,
    find_focused_node,
    find_node_by_xpath,
    match_node,
)
from android_tester.action_script import ActionScript, ActionStep
from android_tester.actions import compute_action_key
from android_tester.android_controller import AndroidController
from android_tester.event_logger import EventLogger
from android_tester.image_store import Image, ImageStore
from android_tester.models import RunState
from android_tester.telemetry import measure_time

logger = logging.getLogger(__name__)


def _fmt_args(args: dict[str, object]) -> str:
    """Format action args for display in logs and reports."""
    parts = []
    for k, v in sorted(args.items()):
        if isinstance(v, (list, tuple)):
            parts.append(f"{k}={tuple(v)}")
        elif isinstance(v, str):
            parts.append(f"{k}={v!r}")
        else:
            parts.append(f"{k}={v}")
    return ", ".join(parts)


# Actions that use screen coordinates.
_COORD_ACTIONS = frozenset({"Click", "LongPress", "Drag", "Scroll"})

# Actions where dump_stable_ui_tree is pointless (e.g. the home
# screen tree keeps changing due to clock widgets / animations).
_SKIP_STABLE_DUMP = frozenset({
    "PressHome",
    "ResourceList",
    "FileList",
    "FilePut",
    "FileDelete",
})

_A11Y_POLL_TIMEOUT_S = 10.0
"""Default deadline for polling the a11y tree for a matching node."""

_A11Y_POLL_INTERVAL_S = 2.0
"""Gap between a11y-tree polls when waiting for a node to appear."""

_PIXEL_CROP_RADIUS_PX = 50
"""Half-size of the crop region for pixel comparison (pixels)."""

_PIXEL_TOLERANCE = 20
"""Max per-channel difference (0–255) to treat two pixels as equal."""

_MIN_STEP_DELAY_S = 1.0
"""Floor for the inter-step delay derived from the recording."""

_FALLBACK_STEP_DELAY_S = 2.0
"""Delay used for the last step when no next-step timestamp exists."""


@dataclass(slots=True)
class ReplayResult:
    """What the replayer hands off to TestRunner."""

    state: RunState
    steps_completed: int


class ScriptReplayer:
    """Replays a recorded action script as a fast-forward setup prefix."""

    def __init__(
        self,
        controller: AndroidController,
        event_logger: EventLogger,
        image_store: ImageStore,
    ) -> None:
        self._controller = controller
        self._event_logger = event_logger
        self._image_store = image_store

    @measure_time("replay_total_duration")
    async def replay(
        self,
        script: ActionScript,
        *,
        task_id: str,
        step_offset: int = 0,
        reset: bool = True,
    ) -> ReplayResult:
        state = RunState(instruction=script.instruction)

        await self._controller.ensure_connected()
        if reset:
            await self._controller.reset()

        for i, step in enumerate(script.steps):
            step_num = step_offset + i + 1

            if step.action_name == "Finished":
                state.actions.append(step.action_name)
                state.summaries.append(step.conclusion)
                state.action_keys.append(
                    compute_action_key(
                        step.action_name, step.action_args,
                    ),
                )
                await self._log(task_id, step_num, "skip",
                                action=step.action_name,
                                args=_fmt_args(step.action_args),
                                detail="Finished marker")
                break

            delay = _get_recorded_delay(script.steps, i)

            execute_fn = (self._execute_coord_action
                          if step.action_name in _COORD_ACTIONS
                          else self._execute_direct)
            success = await execute_fn(task_id, step_num, step, delay)

            if not success:
                await self._log(task_id, step_num, "abort",
                                action=step.action_name,
                                args=_fmt_args(step.action_args),
                                detail="No match — handing off to LLM")
                return ReplayResult(state=state, steps_completed=i)

            state.actions.append(step.action_name)
            state.summaries.append(step.conclusion)
            state.action_keys.append(
                compute_action_key(
                    step.action_name, step.action_args,
                ),
            )

        return ReplayResult(
            state=state, steps_completed=len(script.steps),
        )

    # ------------------------------------------------------------------
    # Action execution
    # ------------------------------------------------------------------

    async def _execute_direct(
        self, task_id: str, step_num: int,
        step: ActionStep, delay: float,
    ) -> bool:
        """Execute a non-coordinate action directly."""
        if step.action_name == "Type" and step.target_node:
            node = await _poll_a11y_match(
                self._controller, step, timeout=delay,
            )
            if node is None:
                await self._log(task_id, step_num, "type-no-focus",
                                action=step.action_name,
                                args=_fmt_args(step.action_args),
                                detail="Target input field not found")
                return False
            await self._log(task_id, step_num, "type-ready",
                            action=step.action_name,
                            args=_fmt_args(step.action_args),
                            detail=f"Input field ready: {node.label!r}")
        try:
            await self._controller.dispatch_action(
                step.action_name, step.action_args,
            )
            await self._log(task_id, step_num, "direct",
                            action=step.action_name,
                            args=_fmt_args(step.action_args),
                            detail="Executed directly")
            if step.action_name not in _SKIP_STABLE_DUMP:
                await self._controller.dump_stable_ui_tree(
                    max_polls=max(1, int(delay)),
                )
            return True
        except Exception as exc:
            await self._log(task_id, step_num, "error",
                            action=step.action_name,
                            args=_fmt_args(step.action_args),
                            detail=f"Execution failed: {exc}")
            return False

    async def _execute_coord_action(
        self, task_id: str, step_num: int,
        step: ActionStep, delay: float,
    ) -> bool:
        """Try a11y match, then pixel match for coordinate actions."""

        # Tier 1: a11y tree match
        node = await _poll_a11y_match(
            self._controller, step, timeout=delay,
        )
        if node is not None:
            try:
                await self._controller.dispatch_action(
                    step.action_name, {"point": node.center},
                )
                await self._log(
                    task_id, step_num, "a11y",
                    action=step.action_name,
                    args=_fmt_args(step.action_args),
                    detail=f"Matched {node.label!r} [{node.cls}] "
                           f"at {node.center}",
                )
                return True
            except Exception as exc:
                await self._log(
                    task_id, step_num, "a11y-fail",
                    action=step.action_name,
                    args=_fmt_args(step.action_args),
                    detail=f"A11y match found but execution "
                           f"failed: {exc}",
                )

        # Tier 2: pixel match.
        coord = (
            step.action_args.get("start")
            if step.action_name in ("Scroll", "Drag")
            else step.action_args.get("point")
        )
        if (isinstance(coord, (tuple, list))
                and len(coord) == 2
                and await self._match_pixel_area(step, coord)):
            try:
                await self._controller.dispatch_action(
                    step.action_name, step.action_args,
                )
                await self._log(
                    task_id, step_num, "pixel",
                    action=step.action_name,
                    args=_fmt_args(step.action_args),
                    detail=f"Pixel match at {coord}",
                )
                return True
            except Exception as exc:
                await self._log(
                    task_id, step_num, "pixel-fail",
                    action=step.action_name,
                    args=_fmt_args(step.action_args),
                    detail=f"Pixel match found but execution failed: {exc}",
                )

        return False

    # ------------------------------------------------------------------
    # Pixel matching
    # ------------------------------------------------------------------

    @measure_time("pixel_match_duration")
    async def _match_pixel_area(
        self,
        step: ActionStep,
        point: tuple[int, int] | list[int],
    ) -> bool:
        """Check that the area around *point* matches the recording."""
        if not step.screenshot_uri:
            return False
        x, y = int(point[0]), int(point[1])
        try:
            recorded = Image(data=b"", mime="image/jpeg",
                             size=(0, 0), uri=step.screenshot_uri)
            recorded_bytes = await recorded.read()
            if not recorded_bytes:
                return False
            current_img = await self._controller.screenshot()
            current_bytes = await current_img.read()
            return _compare_crops(
                recorded_bytes, current_bytes, x, y,
            )
        except Exception:
            logger.debug("pixel match failed", exc_info=True)
            return False

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------

    async def _log(
        self, task_id: str, step: int, matched_by: str, *,
        action: str, args: str = "", detail: str,
    ) -> None:
        logger.info(
            "replay step %d [%s] %s(%s): %s",
            step, matched_by, action, args, detail,
        )
        await self._event_logger.record(
            "replay", task_id, step,
            action=action, matched_by=matched_by,
            args=args, detail=detail,
        )


# ---------------------------------------------------------------------------
# A11y polling
# ---------------------------------------------------------------------------


@measure_time("poll_a11y_node_duration")
async def _poll_a11y_match(
    controller: AndroidController,
    step: ActionStep,
    *,
    timeout: float = _A11Y_POLL_TIMEOUT_S,
    poll_interval: float = _A11Y_POLL_INTERVAL_S,
) -> UINode | None:
    if not step.target_node:
        return None

    # Type steps match by focused element; coord steps match by xpath.
    use_focused = step.action_name == "Type"
    if not use_focused and not step.target_node.get("xpath"):
        return None

    deadline = time.monotonic() + timeout
    while True:
        try:
            xml = await controller.dump_ui_tree()
            if use_focused:
                node = find_focused_node(xml)
            else:
                node = find_node_by_xpath(xml, step.target_node["xpath"])
            if node and match_node(step.target_node, node):
                return node
        except Exception:
            pass

        if time.monotonic() >= deadline:
            return None
        wait = min(poll_interval, deadline - time.monotonic())
        if wait > 0:
            await asyncio.sleep(wait)


# ---------------------------------------------------------------------------
# Pixel comparison
# ---------------------------------------------------------------------------


def _compare_crops(
    recorded_bytes: bytes, current_bytes: bytes,
    x: int, y: int,
) -> bool:
    import numpy as np
    from PIL import Image as PILImage

    recorded = PILImage.open(io.BytesIO(recorded_bytes)).convert("RGB")
    current = PILImage.open(io.BytesIO(current_bytes)).convert("RGB")
    radius = _PIXEL_CROP_RADIUS_PX
    box = (
        max(0, x - radius), max(0, y - radius),
        min(recorded.width, x + radius),
        min(recorded.height, y + radius),
    )
    rec_arr = np.array(recorded.crop(box), dtype=np.int16)
    cur_arr = np.array(current.crop(box), dtype=np.int16)
    return (rec_arr.shape == cur_arr.shape
            and bool(np.abs(rec_arr - cur_arr).max() <= _PIXEL_TOLERANCE))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_recorded_delay(steps: list[ActionStep], idx: int) -> float:
    """Time gap between this step and the next in the original run."""
    if idx + 1 < len(steps):
        return max(
            steps[idx + 1].elapsed_s - steps[idx].elapsed_s,
            _MIN_STEP_DELAY_S,
        )
    return _FALLBACK_STEP_DELAY_S
