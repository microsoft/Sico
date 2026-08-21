"""Per-submission identity + plan-editor envelope passed into TaskManager.

Used by ``TaskManager.submit_prepared`` as the narrow per-turn context for a
single chat turn. Trusted handoff — fields are validated upstream by the
request-builder layer and not re-validated by the manager.

Carries only what ``submit_prepared`` and its descendants reach for:

* identity fields (``username`` / ``agent_*`` / ``project_id`` /
  ``conversation_id`` / ``turn_id``)
* ``plan_editor`` — streaming channel for lifecycle / tool-call UI updates
* ``submission_id`` — stable identity for one logical task submission
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

    submission_id: str = ""
    """Stable identity for one logical task submission across transport retries."""

    submission_source: str = ""
    """Stable producer identity included in replay fingerprint validation."""

    task_runtime_batch_ids: list[str] = field(default_factory=list)
    """Append-only list of batch ids submitted during this turn. Mutated by
    the orchestrator on every successful ``submit_prepared``. When constructed via
    :meth:`from_tool_context` the list reference is shared with the source
    ``ToolContext`` so mutations propagate."""

    @classmethod
    def from_tool_context(
        cls,
        tc: ToolContext,
        *,
        submission_id: str = "",
        submission_source: str = "",
    ) -> TurnContext:
        """Narrow the wide ``ToolContext`` used inside chat tools into the
        per-turn context required by ``TaskManager.submit_prepared``.

        Drops ``response_queue`` / ``all_tools`` — those belong to tool
        execution, not to task scheduling. ``task_runtime_batch_ids`` shares
        the list reference so mutations from inside the manager propagate
        back to the caller. ``submission_id`` can be narrowed to one delegate
        invocation. Coerces ``agent_instance_id`` ``None`` to ``0`` so downstream
        code does not need a null check on every read."""
        return cls(
            username=tc.username,
            agent_id=tc.agent_id,
            agent_instance_id=int(tc.agent_instance_id or 0),
            project_id=tc.project_id,
            conversation_id=tc.conversation_id,
            turn_id=tc.turn_id,
            plan_editor=tc.plan_editor,
            submission_id=submission_id or tc.submission_id,
            submission_source=submission_source,
            task_runtime_batch_ids=tc.task_runtime_batch_ids,
        )

    def with_plan_editor(self, plan_editor: PlanEditor) -> TurnContext:
        """Return a copy bound to a different plan editor — used by the stale
        reconciler when re-attaching to a quiescent turn."""
        return replace(self, plan_editor=plan_editor)
