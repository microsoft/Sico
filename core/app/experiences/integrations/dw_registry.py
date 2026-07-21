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

"""Digital-worker trajectory parser registry.

A parser turns one run's captured stdout into ``TrajectoryData`` for the
experience-learning pipeline. There is a single field-agnostic **default
parser** (``default_parser.py``) that handles *any* digital worker (DW); a skill
only registers a custom parser in the rare case its output cannot be expressed
as the conventions below.

A parser is a pure function::

    parser(run_dir, run, result) -> Iterable[TrajectoryData]

``run_dir`` is the runtime's per-run results directory
(``workspace_path(agent_instance_id, username)/results/<batch_id>/<run_id>``).
The run's captured stdout (one JSONL event per line) is on ``result.output``.
The parser returns zero or more independent ``TrajectoryData`` and must not
perform I/O beyond ``run_dir`` or call ``add_playbook`` / any remote service.

Recommended stdout protocol (what the default parser reads best — all optional):

- **Per-step event(s)**, one or more JSON lines sharing a ``step`` number::

      {"step": <int>, "thought": "...", "action": "...", "args": {...},
       "conclusion": "...", "outcome": "...", "what_happened": "...",
       "progress": "...", "next_goal": "...", "screenshot_url": "..."}

  Operator fields (thought/action/args/conclusion) and reflector fields
  (outcome/what_happened/progress/next_goal) carrying the same ``step`` are merged
  into one step — whether emitted on a single combined line (above) or split
  across separate lines. A ``screenshot_url`` may ride on the step line or arrive
  as its own line for that ``step``.
- **Terminal event**, one JSON line at the end::

      {"status": "completed"|"failed"|"blocked"|..., "verdict": <bool>,
       "instruction": "...", "reason": "...", "duration": <seconds>}

  Declares the task outcome. To receive helpful/harmful crediting a run MUST
  declare a success signal (``status``/``verdict``/``success``); without one the
  outcome is treated as undeclared and cited strategies are not tagged helpful.

Design contract (kept by the default parser, required of any custom parser):

- **Field-agnostic & tolerant.** Events are classified by field presence, not by
  an ``event`` label, so a DW may name events anything. Malformed/missing/unknown
  lines must not raise. A DW that emits no recognizable structure (or non-JSONL)
  still learns: its stdout becomes a raw text trace.
- **Text in, text out.** Downstream is an LLM Reflector / Curator, not a schema
  validator. Pack meaningful text into ``task`` / ``chronological_steps`` /
  ``final_output`` / ``raw_trace``; stash identifiers (``run_id``, ``skill_name``,
  ``status``, ``task_id``) in ``metadata`` (``run_id`` is required so the dedup
  hash distinguishes runs). Empty strings / ``None`` beat fabricated placeholders.
- **One execution -> one trajectory unit.** Do not merge multiple cases into a
  synthetic super-trajectory.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.biz.task_runtime.models import TaskResult, TaskRun
    from app.experiences.runner import TrajectoryData


TrajectoryParser = Callable[[Path, "TaskRun", "TaskResult"], Iterable["TrajectoryData"]]


_REGISTRY: dict[str, TrajectoryParser] = {}
_DEFAULT_PARSER: TrajectoryParser | None = None


def register_dw_parser(skill_name: str, parser: TrajectoryParser) -> None:
    """Register ``parser`` as the trajectory builder for a specific ``skill_name``.

    Rare opt-in: only a skill whose stdout cannot be handled by the field-agnostic
    default parser needs this. Re-registering the same ``skill_name`` overwrites
    the previous parser; this keeps test fixtures simple and makes import-time
    registration idempotent.
    """
    if not skill_name:
        raise ValueError("skill_name must be a non-empty string")
    _REGISTRY[skill_name] = parser


def register_default_parser(parser: TrajectoryParser) -> None:
    """Register the fallback parser used for every skill without a custom one."""
    global _DEFAULT_PARSER
    _DEFAULT_PARSER = parser


def get_dw_parser(skill_name: str | None) -> TrajectoryParser | None:
    """Return the parser for ``skill_name``: its custom one, else the default.

    Returns ``None`` only for an empty skill name (a non-skill run), so callers
    can treat those as no-ops. Every skill run resolves to the default parser
    unless it registered a custom one — so any DW learns out of the box.
    """
    if not skill_name:
        return None
    return _REGISTRY.get(skill_name) or _DEFAULT_PARSER
