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

"""Per-turn identity + plan-editor envelope passed into TaskManager.

Used by ``TaskManager.submit_prepared`` as the narrow per-turn context for a
single chat turn. Trusted handoff — fields are validated upstream by the
request-builder layer and not re-validated by the manager.

Carries only what ``submit_prepared`` and its descendants reach for:

* identity fields (``username`` / ``agent_*`` / ``project_id`` /
  ``conversation_id`` / ``turn_id``)
* ``plan_editor`` — streaming channel for lifecycle / tool-call UI updates
* ``task_runtime_batch_ids`` — mutable list shared with the source
  ``ToolContext`` tracking the batches this turn created.

Excludes ``response_queue`` / ``all_tools`` — those are tool-execution
concerns owned by the outer chat-tool envelope (``ToolContext``)."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.tools.common import ToolContext
    from app.tools.plan import PlanEditor


@dataclass(frozen=True, slots=True)
class TurnContext:
    """Per-turn envelope for ``TaskManager.submit_prepared``.

    Trusted: every field is validated by the upstream request-builder before
    the pipeline is invoked. TaskManager treats these as authoritative and
    does not re-validate.
    """

    username: str
    agent_id: str
    agent_instance_id: int
    project_id: int
    conversation_id: int
    turn_id: int
    plan_editor: PlanEditor
    """Live channel for streaming task lifecycle updates to the frontend plan
    UI. Manager writes; tools/skills do not own this reference."""

    task_runtime_batch_ids: list[str] = field(default_factory=list)
    """Append-only list of batch ids submitted during this turn. Mutated by
    the orchestrator on every successful ``submit_prepared``. When constructed via
    :meth:`from_tool_context` the list reference is shared with the source
    ``ToolContext`` so mutations propagate."""

    @classmethod
    def from_tool_context(cls, tc: ToolContext) -> TurnContext:
        """Narrow the wide ``ToolContext`` used inside chat tools into the
        per-turn context required by ``TaskManager.submit_prepared``.

        Drops ``response_queue`` / ``all_tools`` — those belong to tool
        execution, not to task scheduling. ``task_runtime_batch_ids`` shares
        the list reference so mutations from inside the manager propagate
        back to the caller. Coerces ``agent_instance_id`` ``None`` to ``0``
        so downstream code does not need a null check on every read."""
        return cls(
            username=tc.username,
            agent_id=tc.agent_id,
            agent_instance_id=int(tc.agent_instance_id or 0),
            project_id=tc.project_id,
            conversation_id=tc.conversation_id,
            turn_id=tc.turn_id,
            plan_editor=tc.plan_editor,
            task_runtime_batch_ids=tc.task_runtime_batch_ids,
        )

    def with_plan_editor(self, plan_editor: PlanEditor) -> TurnContext:
        """Return a copy bound to a different plan editor — used by the stale
        reconciler when re-attaching to a quiescent turn."""
        return replace(self, plan_editor=plan_editor)
