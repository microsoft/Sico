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

"""Experience-learning trigger (EPE).

The *learning* half of EPE: after a delegated skill run finishes we look up the
registered ``TrajectoryParser`` for the run's skill, build ``TrajectoryData``
from the run's captured stdout, and feed each meaningful trajectory to
``add_playbook`` on a background task.

The per-run trigger is **inline**: the skill executor calls
:func:`on_run_terminal` right after a run produces its result, with the
in-memory ``(run, result)`` in hand. This fires for every finished skill run
regardless of which ``RunStore`` the deployment uses. (The run-completion event
bus is not a reliable trigger: the backend-backed store performs its run state
transition out-of-process and never publishes ``RunStateTransition`` in-process,
so a bus subscription would silently never fire in production.)

Trigger policy via ``EPE_TRIGGER_MODE``:

- ``per_run`` (default): dispatch immediately after each run finishes.
- ``per_batch``: buffer finished ``(run, result)`` pairs until the batch reaches
  a terminal status, then dispatch each independently — no trajectory merging.
  The batch transition (``BatchStateTransition``) is published in-process for
  every store, so the drain in :func:`_handle_batch_transition` stays reliable.
- ``disabled``: no learning is triggered.

``EXPERIENCES_ENABLED`` continues to gate the actual write inside
``ExperienceService``; this layer never duplicates that check.

Because dispatch is fire-and-forget, the actual store round-trip and LLM-backed
curation run on a background task; the chat turn never blocks on them.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

from ..event_bus import BatchStateTransition, RuntimeEvent
from ..models import SkillDispatch, TaskRun
from ..state_machine import is_terminal_batch_status

if TYPE_CHECKING:
    from ..event_bus import RuntimeEventBus, Unsubscribe
    from ..models import TaskResult

__all__ = ["on_run_terminal", "register"]


_LOGGER = logging.getLogger(__name__)

_VALID_MODES = ("per_run", "per_batch", "disabled")
_DEFAULT_MODE = "per_run"

# Learnability thresholds: a trajectory clears the gate with more than this many
# structured steps, a declared verdict, or a raw trace longer than this.
_MIN_MEANINGFUL_STEPS = 2
_MIN_RAW_TRACE_CHARS = 200

# Strong references to in-flight tasks. asyncio.create_task only holds a weak
# reference, so without this set a task can be garbage-collected mid-run. Tasks
# remove themselves via the done-callback below.
_BACKGROUND_TASKS: set[asyncio.Task] = set()

# In-flight dispatch tasks grouped by batch, so the batch finalizer can await a
# batch's learning before clearing its "generating experience" placeholder.
_BATCH_TASKS: dict[str, set[asyncio.Task]] = {}

# batch_id -> (conversation_id, turn_id, agent_instance_id), stashed for the
# finalizer even when learning does not run so the placeholder still clears.
_BATCH_META: dict[str, tuple[int, int, int]] = {}

# Per-batch staging area for ``per_batch`` mode. Maps batch_id -> finished
# (run, result) pairs, drained when the matching batch transition fires.
_PENDING_BATCH_RUNS: dict[str, list[tuple[TaskRun, "TaskResult"]]] = {}


def _read_trigger_mode() -> str:
    """Read ``EPE_TRIGGER_MODE`` with a sane default and one-line warning on bad values."""
    raw = os.getenv("EPE_TRIGGER_MODE", "").strip().lower()
    if not raw:
        return _DEFAULT_MODE
    if raw not in _VALID_MODES:
        _LOGGER.warning(
            "EPE_TRIGGER_MODE=%r is not one of %s; falling back to %r",
            raw,
            _VALID_MODES,
            _DEFAULT_MODE,
        )
        return _DEFAULT_MODE
    return raw


def _experiences_enabled() -> bool:
    return os.getenv("EXPERIENCES_ENABLED", "false").lower() in ("true", "1", "yes")


def _skill_name(run: TaskRun) -> str:
    dispatch = run.spec.dispatch
    return dispatch.skill_name if isinstance(dispatch, SkillDispatch) else ""


def _has_meaningful_evidence(trajectory) -> bool:
    """True if the trajectory carries a learnable signal.

    A runtime-crash / 0-step fallback collapses to a single synthetic step, and
    feeding those to the LLM pipeline only produces self-referential meta-bullets
    while burning Reflector/Curator calls. A trajectory is worth dispatching when
    it has more than two real steps, OR it carries a declared verdict (a short
    but confirmed pass/fail run), OR it has a substantial raw text trace (a DW
    that does not emit per-step events). This stays parser-agnostic.
    """
    steps = getattr(trajectory, "chronological_steps", None) or []
    if len(steps) > _MIN_MEANINGFUL_STEPS:
        return True
    if getattr(trajectory, "judge_result", None):
        return True
    raw_trace = getattr(trajectory, "raw_trace", "") or ""
    return len(raw_trace.strip()) > _MIN_RAW_TRACE_CHARS


def on_run_terminal(run: TaskRun, result: "TaskResult") -> None:
    """Trigger experience learning for a finished skill run (inline, fire-and-forget).

    Called by the skill executor right after a run produces its result, so
    learning fires per run regardless of the active ``RunStore``. Honors
    ``EPE_TRIGGER_MODE``: ``per_run`` schedules the dispatch immediately;
    ``per_batch`` buffers ``(run, result)`` until :func:`_handle_batch_transition`
    drains it on the batch terminal; ``disabled`` is a no-op. Non-skill runs and
    skills without a registered parser are filtered out (early here and again in
    :func:`_dispatch`).

    Never raises and never blocks the caller.
    """
    if not _skill_name(run):
        return
    _BATCH_META.setdefault(
        run.batch_id,
        (run.parent_conversation_id, run.parent_turn_id, run.agent_instance_id),
    )
    if not _experiences_enabled():
        return
    mode = _read_trigger_mode()
    if mode == "disabled":
        return
    if mode == "per_batch":
        _PENDING_BATCH_RUNS.setdefault(run.batch_id, []).append((run, result))
        return
    _LOGGER.info(
        "EPE learning scheduled: mode=per_run run=%s batch=%s status=%s",
        run.run_id,
        run.batch_id,
        result.status.value,
    )
    _schedule_dispatch(run, result)


def _schedule_dispatch(run: TaskRun, result: "TaskResult") -> None:
    """Fire-and-forget: spin a background task and return without awaiting.

    No-ops when there is no running event loop (e.g. a synchronous test that
    drives ``_dispatch`` directly).
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        _LOGGER.debug("EPE dispatch skipped: no running event loop (run=%s)", run.run_id)
        return
    task = loop.create_task(_dispatch(run, result))
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    bucket = _BATCH_TASKS.setdefault(run.batch_id, set())
    bucket.add(task)
    task.add_done_callback(bucket.discard)


def _run_dir(run: TaskRun) -> Path:
    """Replicate the skill executor's per-run working directory layout."""
    from ..workspace import workspace_layout

    workspace = workspace_layout().workspace_path(run.agent_instance_id, run.username)
    return workspace / "results" / run.batch_id / run.run_id


async def _dispatch(run: TaskRun, result: "TaskResult") -> None:
    """Parse trajectories for ``run`` and feed each meaningful one to ``add_playbook``.

    Works purely with the in-memory ``(run, result)`` (``spec.dispatch.skill_name``
    + ``result.output``-backed parsing); no store round-trip. A single trajectory
    failure does not block the rest.
    """
    skill_name = _skill_name(run)
    if not skill_name:
        return
    from app.experiences.integrations.dw_registry import get_dw_parser

    parser = get_dw_parser(skill_name)
    if parser is None:
        return

    run_dir = _run_dir(run)
    try:
        trajectories = list(parser(run_dir, run, result))
    except Exception:
        _LOGGER.exception("EPE parser failed for run=%s skill=%s", run.run_id, skill_name)
        return

    if not trajectories:
        _LOGGER.info(
            "EPE learning skipped (no trajectories): run=%s skill=%s conv=%s turn=%s",
            run.run_id,
            skill_name,
            run.parent_conversation_id,
            run.parent_turn_id,
        )
        return

    meaningful = [t for t in trajectories if _has_meaningful_evidence(t)]
    if not meaningful:
        _LOGGER.info(
            "EPE learning skipped (too few steps): run=%s skill=%s trajectories=%d conv=%s turn=%s",
            run.run_id,
            skill_name,
            len(trajectories),
            run.parent_conversation_id,
            run.parent_turn_id,
        )
        return

    # Local import: ``add_playbook`` pulls in LLM clients and runner state.
    from app.experiences.service import add_playbook

    succeeded = 0
    for trajectory in meaningful:
        try:
            await add_playbook(
                trajectory_data=trajectory,
                project_id=run.project_id,
                agent_instance_id=run.agent_instance_id,
                conversation_id=run.parent_conversation_id,
                turn_id=run.parent_turn_id,
            )
            succeeded += 1
        except Exception:
            _LOGGER.warning(
                "EPE add_playbook failed for run=%s skill=%s; continuing",
                run.run_id,
                skill_name,
                exc_info=True,
            )

    _LOGGER.info(
        "EPE learning fired: run=%s skill=%s trajectories=%d succeeded=%d conv=%s turn=%s",
        run.run_id,
        skill_name,
        len(meaningful),
        succeeded,
        run.parent_conversation_id,
        run.parent_turn_id,
    )


def _handle_batch_transition(event: BatchStateTransition) -> None:
    if not is_terminal_batch_status(event.to_status):
        return
    pending = _PENDING_BATCH_RUNS.pop(event.batch_id, [])
    if _read_trigger_mode() == "per_batch":
        for run, result in pending:
            _LOGGER.info(
                "EPE learning scheduled: mode=per_batch run=%s batch=%s",
                run.run_id,
                event.batch_id,
            )
            _schedule_dispatch(run, result)
    _finalize_batch(event.batch_id)


def _finalize_batch(batch_id: str) -> None:
    """Clear a skill batch's "generating experience" placeholder once its learning drains."""
    meta = _BATCH_META.pop(batch_id, None)
    if meta is None:
        return
    tasks = _BATCH_TASKS.pop(batch_id, set())
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    finalizer = loop.create_task(_clear_generating(meta, tasks))
    _BACKGROUND_TASKS.add(finalizer)
    finalizer.add_done_callback(_BACKGROUND_TASKS.discard)


async def _clear_generating(meta: tuple[int, int, int], tasks: set[asyncio.Task]) -> None:
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    conversation_id, turn_id, agent_instance_id = meta
    from app.experiences.service import emit_playbook_ingestion

    emit_playbook_ingestion(conversation_id, turn_id, 0, agent_instance_id)


def _handle(event: RuntimeEvent) -> None:
    if isinstance(event, BatchStateTransition):
        _handle_batch_transition(event)


def register(bus: "RuntimeEventBus") -> "Unsubscribe":
    """Wire the per-batch drain handler onto ``bus`` and return its unsubscribe.

    Only ``BatchStateTransition`` is handled — it drains the ``per_batch`` buffer.
    The per-run trigger is inline via :func:`on_run_terminal` from the skill
    executor, not the bus.
    """

    return bus.subscribe(_handle)
