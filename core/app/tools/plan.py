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

import inspect
import json
import logging
import time
from collections.abc import Callable
from contextvars import ContextVar, Token
from typing import Any, Literal

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.conversation.plan import (
    Plan,
    PlanExtra,
    PlanStep,
    PlanStepStatus,
    ToolCall,
    ToolCallStatus,
    ToolDeliverable,
    ToolExecutionInfo,
)
from app.storage.fs import CHAT_FS

_LOGGER = logging.getLogger(__name__)

# TTL for the Redis-backed plan lock. Critical sections (plan read-modify-write,
# tool-call append, cancel-marker write) are sub-second; 30s is a comfortable
# safety margin while still recovering quickly from a crashed lock holder.
PLAN_LOCK_TTL_SECONDS = 30
_TRACKED_TOOL_CALL_IDS: ContextVar[list[int] | None] = ContextVar("tracked_tool_call_ids", default=None)


def begin_tool_call_status_tracking() -> Token[list[int] | None]:
    return _TRACKED_TOOL_CALL_IDS.set([])


def finish_tool_call_status_tracking(token: Token[list[int] | None]) -> list[int]:
    tool_call_ids = list(_TRACKED_TOOL_CALL_IDS.get() or [])
    _TRACKED_TOOL_CALL_IDS.reset(token)
    return tool_call_ids


def record_tool_call_for_status_tracking(tool_call_id: int, status: ToolCallStatus) -> None:
    tracked_tool_call_ids = _TRACKED_TOOL_CALL_IDS.get()
    if tracked_tool_call_ids is not None and tool_call_id and status == ToolCallStatus.RUNNING:
        tracked_tool_call_ids.append(tool_call_id)


class PlanItemWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(description="Short actionable task title.", min_length=1)
    status: Literal["pending", "in_progress", "completed", "failed", "require_human_input"] = Field(
        description="Task state. Must be one of: pending, in_progress, completed, failed, require_human_input."
    )

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("title must not be empty")
        return normalized


class PlanReadInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanWriteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field("", description="Overall plan title.")
    items: list[PlanItemWrite] = Field(
        default_factory=list,
        description="Complete plan item list to persist for this turn.",
    )

    @model_validator(mode="after")
    def _validate_items(self) -> "PlanWriteInput":
        in_progress_count = sum(1 for item in self.items if item.status == "in_progress")
        if in_progress_count > 1:
            raise ValueError("only one plan item can be in_progress")

        return self


def _normalize_read_plan(plan: Plan) -> dict[str, Any]:
    # hide tool execution info from the plan
    plan = plan.remove_tool_execution_info()

    # convert to json object
    json_obj = plan.to_dict_with_status_as_string()

    return json_obj


def _normalize_write_plan(plan: Plan) -> dict[str, Any]:
    plan = plan.remove_tool_calls()
    json_obj = plan.to_dict_with_status_as_string()
    return json_obj


def is_plan_cancelled(agent_instance_id: int, username: str, turn_id: int, conversation_id: int = 0) -> bool:
    return CHAT_FS.plan.is_cancelled(agent_instance_id, username, turn_id, conversation_id=conversation_id)


async def cancel_plan(agent_instance_id: int, username: str, turn_id: int, conversation_id: int = 0):
    # Hold the plan lock so the cancel marker doesn't appear mid-write in another
    # process; readers checking cancellation + plan content under the same lock
    # will see a consistent snapshot.
    async with _plan_lock(agent_instance_id, username, turn_id, conversation_id):
        CHAT_FS.plan.write_cancelled_marker(agent_instance_id, username, turn_id, conversation_id=conversation_id)


def _plan_lock(agent_instance_id: int, username: str, turn_id: int, conversation_id: int = 0):
    """Exclusive Redis-backed plan lock; meant to be used with ``async with``."""
    return CHAT_FS.plan.write_lock(
        agent_instance_id,
        username,
        turn_id,
        timeout=PLAN_LOCK_TTL_SECONDS,
        conversation_id=conversation_id,
    )


def _read_plan_unlocked(agent_instance_id: int, username: str, turn_id: int, conversation_id: int = 0) -> Plan | None:
    """Read the plan without acquiring the inter-process lock.

    Caller MUST hold ``CHAT_FS.plan.read_lock`` or ``CHAT_FS.plan.write_lock``
    for the same turn.
    """
    cancelled = is_plan_cancelled(agent_instance_id, username, turn_id, conversation_id)

    if not CHAT_FS.plan.exists(agent_instance_id, username, turn_id, conversation_id=conversation_id):
        return None

    raw_content = CHAT_FS.plan.read(agent_instance_id, username, turn_id, conversation_id=conversation_id)
    if not raw_content.strip():
        return None

    plan = Plan.model_validate(json.loads(raw_content))
    return plan.to_cancelled() if cancelled else plan


def _write_plan_unlocked(plan: Plan) -> None:
    """Write the plan to disk without acquiring the inter-process lock.

    Caller MUST hold ``CHAT_FS.plan.write_lock`` for the same turn.
    """
    plan.extra.updated_at = int(time.time() * 1000)
    CHAT_FS.plan.write(
        plan.extra.agent_instance_id,
        plan.extra.username,
        plan.extra.turn_id,
        plan.model_dump_json(indent=2),
        conversation_id=plan.extra.conversation_id,
    )


def _iter_tool_call_tree(tool_call: ToolCall):
    yield tool_call
    for sub_call in tool_call.sub_calls:
        yield from _iter_tool_call_tree(sub_call)


def _iter_tool_calls(plan: Plan):
    for step in plan.steps:
        for tool_call in step.tool_calls:
            yield from _iter_tool_call_tree(tool_call)


def _mark_failed_analyzing_tool_calls_as_analyzed(plan: Plan) -> None:
    for existing_tool_call in _iter_tool_calls(plan):
        if existing_tool_call.tool_call_status == ToolCallStatus.FAILED_ANALYZING:
            existing_tool_call.tool_call_status = ToolCallStatus.FAILED_ANALYZED


def _propagate_updated_at(plan: Plan, tool_call_id: int, now_ms: int) -> None:
    """Set ``updated_at`` on the tool call and all its ancestors up to the owning step."""

    def _find_and_mark(tc: ToolCall, target_id: int) -> bool:
        """Recursively search for *target_id* inside *tc*'s sub-call tree.

        Returns True if found (so callers can mark themselves as ancestors).
        """
        if tc.tool_call_id == target_id:
            tc.updated_at = now_ms
            return True
        for sub in tc.sub_calls:
            if _find_and_mark(sub, target_id):
                tc.updated_at = now_ms
                return True
        return False

    for step in plan.steps:
        for tc in step.tool_calls:
            if _find_and_mark(tc, tool_call_id):
                step.updated_at = now_ms
                return


async def read_plan(agent_instance_id: int, username: str, turn_id: int, conversation_id: int = 0) -> Plan | None:
    """Read the plan under the plan lock.

    Acquires ``CHAT_FS.plan.read_lock`` (Redis), then performs the read while holding
    the lock. The lock acquire/release is async; the file-read body is synchronous.
    """
    async with CHAT_FS.plan.read_lock(
        agent_instance_id,
        username,
        turn_id,
        timeout=PLAN_LOCK_TTL_SECONDS,
        conversation_id=conversation_id,
    ):
        return _read_plan_unlocked(agent_instance_id, username, turn_id, conversation_id)


async def write_plan(wplan: PlanWriteInput, plan_extra: PlanExtra) -> Plan:
    """Read-modify-write the plan from a ``plan_write`` tool invocation, atomically."""
    aid = plan_extra.agent_instance_id
    user = plan_extra.username
    turn = plan_extra.turn_id
    conversation_id = plan_extra.conversation_id

    async with _plan_lock(aid, user, turn, conversation_id):
        # Read existing plan so we preserve tool calls (the write tool only owns
        # step titles/statuses).
        existing = _read_plan_unlocked(aid, user, turn, conversation_id)
        if existing is None:
            plan = Plan(
                title=wplan.title,
                steps=[PlanStep(title=item.title, status=PlanStepStatus.from_string(item.status)) for item in wplan.items],
                extra=plan_extra,
            )
        elif existing.is_cancelled():
            return existing
        else:
            plan = existing
            plan.extra.username = plan_extra.username
            plan.extra.agent_instance_id = plan_extra.agent_instance_id
            plan.extra.agent_id = plan_extra.agent_id
            plan.extra.turn_id = plan_extra.turn_id
            plan.extra.project_id = plan_extra.project_id
            plan.extra.conversation_id = plan_extra.conversation_id
            plan.title = wplan.title
            for i, item in enumerate(wplan.items):
                if i < len(plan.steps):
                    plan.steps[i].title = item.title
                    plan.steps[i].status = PlanStepStatus.from_string(item.status)
                else:
                    plan.steps.append(PlanStep(title=item.title, status=PlanStepStatus.from_string(item.status)))

        plan.extra.updated_at = int(time.time() * 1000)
        CHAT_FS.plan.write(
            aid,
            user,
            turn,
            plan.model_dump_json(indent=2, exclude_none=True, exclude_unset=True, exclude_defaults=True),
            conversation_id=conversation_id,
        )
    return plan


async def _plan_read_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    from app.tools.common import ToolContext, get_tool_context

    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context", "plan": None}

    agent_instance_id = ctx.agent_instance_id
    username = ctx.username
    turn_id = ctx.turn_id
    conversation_id = ctx.conversation_id

    _LOGGER.info("Plan read tool start agent_instance_id=%s username=%s turn_id=%s", agent_instance_id, username, turn_id)

    try:
        plan = await read_plan(agent_instance_id, username, turn_id, conversation_id)
        return {
            "error_message": "",
            "plan": _normalize_read_plan(plan) if plan else None,
        }
    except Exception as exc:  # pragma: no cover - defensive guard for unexpected filesystem errors
        _LOGGER.error("Plan read tool failed turn_id=%s error=%s", turn_id, exc)
        return {"error_message": str(exc), "plan": None}


async def _plan_write_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    from app.tools.common import ToolContext, get_tool_context

    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context", "plan": None}

    plan_extra = PlanExtra(
        username=ctx.username,
        agent_instance_id=ctx.agent_instance_id,
        agent_id=ctx.agent_id or "",
        turn_id=ctx.turn_id,
        project_id=ctx.project_id,
        conversation_id=ctx.conversation_id,
    )

    # _LOGGER.info("Plan write tool raw input: %s", kwargs)

    try:
        payload = PlanWriteInput.model_validate(kwargs, extra="ignore")
        plan = await write_plan(payload, plan_extra)
        await ctx.plan_editor.notify_plan_updated(plan)
        return {
            "error_message": "",
            "plan": _normalize_write_plan(plan) if plan else None,
        }
    except Exception as exc:  # pragma: no cover - defensive guard for unexpected filesystem errors
        _LOGGER.error("Plan write tool failed turn_id=%s error=%s", ctx.turn_id, exc)
        return {
            "error_message": str(exc),
            "plan": None,
        }


class PlanEditor:
    """Editor for the plan associated with a single (agent_instance, user, turn).

    All persistence happens under the Redis-backed plan write lock. Async methods
    offload their entire critical section to a worker thread via ``asyncio.to_thread``;
    user-facing notifications run on the event loop *after* the lock is released so a
    slow subscriber cannot extend the critical section past ``PLAN_LOCK_TTL_SECONDS``.
    """

    def __init__(
        self,
        agent_instance_id: int,
        username: str,
        turn_id: int,
        conversation_id: int = 0,
        notify_plan_updated_callback: Callable[[Plan], Any] | None = None,
    ):
        self.agent_instance_id = agent_instance_id
        self.username = username
        self.turn_id = turn_id
        self.conversation_id = conversation_id
        self.tool_call_id = 0
        self._notify_cb = notify_plan_updated_callback
        self._has_plan_updates = False

    @property
    def has_plan_updates(self) -> bool:
        return getattr(self, "_has_plan_updates", False)

    def _ensure_plan_scope(self, plan: Plan) -> Plan:
        scoped = plan.model_copy(deep=True)
        scoped.extra.username = self.username
        scoped.extra.agent_instance_id = self.agent_instance_id
        scoped.extra.turn_id = self.turn_id
        scoped.extra.conversation_id = self.conversation_id
        return scoped

    def _alloc_tool_call_id(self, plan: Plan) -> int:
        # Re-sync from the locked plan every time. Multiple Core pods/editors may append
        # tool calls to the same turn, so a cached max can drift and allocate duplicates.
        def visit(tool_call: ToolCall) -> None:
            if tool_call.tool_call_id > self.tool_call_id:
                self.tool_call_id = tool_call.tool_call_id
            for sub_call in tool_call.sub_calls:
                visit(sub_call)

        for step in plan.steps:
            for tool_call in step.tool_calls:
                visit(tool_call)
        self.tool_call_id += 1
        return self.tool_call_id

    # ---- locked helpers (hold the write lock around the critical section) ---------- #

    async def _replace_plan_locked(self, plan: Plan) -> None:
        scoped_plan = self._ensure_plan_scope(plan)
        async with _plan_lock(self.agent_instance_id, self.username, self.turn_id, self.conversation_id):
            _write_plan_unlocked(scoped_plan)

    async def _create_tool_call_locked(
        self,
        name: str,
        initial_message: str,
        execution_info: ToolExecutionInfo | None,
        parent_tool_call_id: int | None,
        sub_call_index: int,
        display: dict[str, str] | None,
        tool_call_status: ToolCallStatus,
    ) -> tuple[Plan | None, int]:
        async with _plan_lock(self.agent_instance_id, self.username, self.turn_id, self.conversation_id):
            plan = _read_plan_unlocked(self.agent_instance_id, self.username, self.turn_id, self.conversation_id)
            if plan is None:
                return None, 0

            tool_call_id = self._alloc_tool_call_id(plan)
            now_ms = int(time.time() * 1000)
            tool_call = ToolCall(
                tool_name=name,
                message=initial_message,
                execution_info=execution_info or ToolExecutionInfo(),
                tool_call_id=tool_call_id,
                sub_call_index=sub_call_index,
                display=dict(display) if display else {},
                tool_call_status=tool_call_status,
                updated_at=now_ms,
            )

            if tool_call_status == ToolCallStatus.RETRY_RUNNING:
                _mark_failed_analyzing_tool_calls_as_analyzed(plan)

            if parent_tool_call_id is None:
                # Attach to the first step that is not "completed" nor "failed".
                for step in plan.steps:
                    if step.status not in (PlanStepStatus.COMPLETED, PlanStepStatus.FAILED):
                        step.tool_calls.append(tool_call)
                        step.updated_at = now_ms
                        break
                else:
                    if plan.steps:
                        plan.steps[-1].tool_calls.append(tool_call)
                        plan.steps[-1].updated_at = now_ms
                    else:
                        plan.steps.append(
                            PlanStep(
                                title="Initial Step",
                                status=PlanStepStatus.PENDING,
                                tool_calls=[tool_call],
                                updated_at=now_ms,
                            )
                        )
            else:
                parent = plan.get_tool_call(parent_tool_call_id)
                if parent is None:
                    return None, 0
                parent.sub_calls.append(tool_call)
                # Propagate updated_at up through all ancestors to the owning step
                _propagate_updated_at(plan, parent_tool_call_id, now_ms)

            scoped_plan = self._ensure_plan_scope(plan)
            _write_plan_unlocked(scoped_plan)
            return scoped_plan, tool_call.tool_call_id

    async def _update_tool_call_locked(
        self,
        tool_call_id: int,
        updater: Callable[[ToolCall], None],
    ) -> tuple[Plan | None, ToolCall | None]:
        async with _plan_lock(self.agent_instance_id, self.username, self.turn_id, self.conversation_id):
            plan = _read_plan_unlocked(self.agent_instance_id, self.username, self.turn_id, self.conversation_id)
            if plan is None:
                return None, None
            tool_call = plan.get_tool_call(tool_call_id)
            if tool_call is None:
                return None, None
            updater(tool_call)
            tool_call.updated_at = int(time.time() * 1000)
            _propagate_updated_at(plan, tool_call_id, tool_call.updated_at)
            scoped_plan = self._ensure_plan_scope(plan)
            _write_plan_unlocked(scoped_plan)
            return scoped_plan, tool_call

    # ---- async API ---------------------------------------------------------- #

    async def get_plan(self) -> Plan | None:
        return await read_plan(self.agent_instance_id, self.username, self.turn_id, self.conversation_id)

    async def is_plan_cancelled(self) -> bool:
        plan = await self.get_plan()
        return plan.is_cancelled() if plan else False

    async def update_plan(self, plan: Plan) -> None:
        """Replace the entire plan, then notify (after releasing the lock)."""
        scoped_plan = self._ensure_plan_scope(plan)
        await self._replace_plan_locked(scoped_plan)
        await self.notify_plan_updated(scoped_plan)

    async def create_tool_call(
        self,
        name: str,
        initial_message: str,
        execution_info: ToolExecutionInfo | None = None,
        parent_tool_call_id: int | None = None,
        sub_call_index: int = 0,
        display: dict[str, str] | None = None,
        tool_call_status: ToolCallStatus = ToolCallStatus.RUNNING,
    ) -> int:
        """Append a new tool call to the current plan; returns its id (0 if no plan)."""
        tool_call_status = ToolCallStatus.RUNNING if tool_call_status == ToolCallStatus.UNKNOWN else tool_call_status
        plan, new_id = await self._create_tool_call_locked(
            name,
            initial_message,
            execution_info,
            parent_tool_call_id,
            sub_call_index,
            display,
            tool_call_status,
        )
        if plan is not None and new_id != 0:
            record_tool_call_for_status_tracking(new_id, tool_call_status)
            await self.notify_plan_updated(plan)
        return new_id

    async def update_tool_call(
        self,
        tool_call_id: int,
        updater: Callable[[ToolCall], None],
    ) -> ToolCall | None:
        """Apply ``updater`` to the targeted tool call in place and persist.

        ``updater`` must be a synchronous callable; it runs inside the worker thread
        that holds the plan write lock.
        """
        if tool_call_id == 0:
            return None
        plan, tool_call = await self._update_tool_call_locked(tool_call_id, updater)
        if plan is not None and tool_call is not None:
            await self.notify_plan_updated(plan)
        return tool_call

    async def update_tool_call_message(self, tool_call_id: int, message: str) -> ToolCall | None:
        def updater(tool_call: ToolCall) -> None:
            tool_call.message = message

        return await self.update_tool_call(tool_call_id, updater)

    async def update_tool_call_status(self, tool_call_id: int, status: ToolCallStatus) -> ToolCall | None:
        def updater(tool_call: ToolCall) -> None:
            tool_call.tool_call_status = status
        return await self.update_tool_call(tool_call_id, updater)

    async def update_tool_call_status_if_running(self, tool_call_id: int, status: ToolCallStatus) -> ToolCall | None:
        def updater(tool_call: ToolCall) -> None:
            if tool_call.tool_call_status == ToolCallStatus.RUNNING:
                tool_call.tool_call_status = status
        return await self.update_tool_call(tool_call_id, updater)

    async def update_tool_call_deliverable(
        self,
        tool_call_id: int,
        deliverables: ToolDeliverable | list[ToolDeliverable],
        append: bool = True,
    ) -> ToolCall | None:
        items = deliverables if isinstance(deliverables, list) else [deliverables]

        def updater(tool_call: ToolCall) -> None:
            if append:
                tool_call.deliverables.extend(items)
            else:
                tool_call.deliverables = items

        return await self.update_tool_call(tool_call_id, updater)

    async def notify_plan_updated(self, plan: Plan) -> None:
        """Publish a plan-updated event. Runs on the event loop, *outside* the lock."""
        self._has_plan_updates = True
        cb = self._notify_cb
        if cb is None:
            return
        if inspect.iscoroutinefunction(cb):
            await cb(plan)
        else:
            cb(plan)


class PlanToolCallMessageUpdateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_call_id: int = Field(description="The ID of the tool call to update the message for.")
    message: str = Field(description="The new message to set for the tool call.")


async def _plan_tool_call_message_update_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    from app.tools.common import ToolContext, get_tool_context

    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context", "plan": None}

    _LOGGER.info(
        "Plan tool call message update tool start agent_instance_id=%s username=%s turn_id=%s",
        ctx.agent_instance_id,
        ctx.username,
        ctx.turn_id,
    )

    plan_editor = ctx.plan_editor
    try:
        payload = PlanToolCallMessageUpdateInput.model_validate(kwargs, extra="ignore")
        await plan_editor.update_tool_call_message(payload.tool_call_id, payload.message)
        plan = await plan_editor.get_plan()
        return {
            "error_message": "",
            "plan": _normalize_write_plan(plan) if plan else None,
        }

    except Exception as exc:  # pragma: no cover - defensive guard for unexpected filesystem errors
        _LOGGER.error("Plan write tool failed turn_id=%s error=%s", ctx.turn_id, exc)
        return {
            "error_message": str(exc),
            "plan": None,
        }


PLAN_READ_DESC = """Use this tool to read the current plan list for the session.
This tool should be used proactively and frequently to ensure that you are aware of
the status of the current plan list. You should make use of this tool as often as
possible, especially in the following situations:
- Before starting new tasks to prioritize work
- When the user asks about previous tasks or plans
- Whenever you're uncertain about what to do next
- After completing tasks to update your understanding of remaining work
- After every few messages to ensure you're on track

Usage:
- Returns a list of plan items with their status, title, and tool calls
- Use this information to track progress and plan next steps
- If no plan items exist yet, an empty list will be returned
- The user may cancel the execution of plan at any time. Whenever you see a plan
item with "cancelled" status, stop generation and execution immediately and don't
output any further texts.
"""

PLAN_WRITE_DESC = """Use this tool to create and manage a structured plan list
for your current chat session. This helps you track progress, organize complex tasks,
and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of
their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Tasks that requires execution - When a task requires action tools besides knowledge
   retrieval, such as calling APIs, running code, or performing multi-step operations.
    - NOTE that you should use this tool even if there is only one trivial task to do.
2. User explicitly requests plan list - When the user directly asks you to use the plan list
3. User provides multiple tasks - When users provide a list of things to be done
   (numbered or comma-separated)
4. After receiving new instructions - Immediately capture user requirements as plan items.
    - Feel free to edit the pending items on plan list based on new information.
    - Keep the completed steps as is.
5. After completing a task - Mark it complete and add any new follow-up tasks
6. When you start working on a new task, mark the plan item as in_progress (if it
   is directly actionable) or require_human_input (if it requires user input before
   you can start working on it).
    - Ideally you should only have one plan item as in_progress/require_human_input at a time.
      Complete existing tasks before starting new ones.
7. Before finishing the conversation, make sure either (1) the status of all tasks are
   completed or failed (2) or there is a require_human_input in the tasks.

## When NOT to Use This Tool

Skip using this tool when:
1. The task is purely conversational or informational

## Examples of When to Use the Plan Tool

<example>
User: Help me run test case in the ADO link: https://dev.azure.com/xxx/yyy/_testManagement/runs?runId=12345&_a=runCharts
*Creates plan list with the following items:*
1. Load the context and skills needed to run test cases in ADO
2. Parse the ADO link to extract the runId and other relevant parameters
3. Fetch project and agent details
4. Apply for a sandbox environment to run the test cases
5. Execute test cases using pre-defined workflows
6. Summarize test results and provide feedback to the user
*Begins working on the first task*

<reasoning>
The assistant used the plan list because:
1. First, the assistant searched to understand the scope of the task
2. Running test cases in ADO is a multi-step feature requiring parsing the link,
   fetching project and agent details, applying for a sandbox environment, executing
   scripts, and summarizing results
3. Upon finding multiple test cases in the ADO link, it determined this was a
   complex task with multiple steps
4. This approach prevents missing any test cases and ensures a systematic execution of
   the entire process
</reasoning>
</example>


## Examples of When NOT to Use the Plan Tool

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

python
print("Hello World")

This will output the text "Hello World" to the console when executed.

<reasoning>
The assistant did not use the plan list because this is a single, trivial task that
can be completed in one step. There's no need to track multiple tasks or steps for such
a straightforward request.
</reasoning>
</example>

<example>
User: What are the last test cases execution result?
Assistant: Last time the user executed 5 test cases, and 4 of them passed while 1 failed. The details are as follows:
1. Test Case 1: Passed
2. Test Case 2: Passed
3. Test Case 3: Passed
4. Test Case 4: Failed
5. Test Case 5: Passed

<reasoning>
The assistant did not use the plan list because this is an informational request with no actual actions to run.
The user is simply asking for a summary, not for the assistant to perform multiple steps or tasks.
</reasoning>
</example>

## Example requiring human input

<example>
User: Help me run the test case in the ADO link: https://dev.azure.com/xxx/yyy/_testManagement/runs?runId=12345&_a=runCharts.
Get the test case details first, and let me confirm before you run the test case.
*Creates plan list with the following items:*
1. Load the context and skills needed to run test cases in ADO
2. Parse the ADO link to extract the runId and other relevant parameters
3. Fetch project and agent details
4. Require human input to confirm the test case details before execution
5. Apply for a sandbox environment to run the test cases
6. Execute test cases using pre-defined workflows
7. Summarize test results and provide feedback to the user
<reasoning>
The assistant used the plan list to structure the tasks and explicitly
marked the step requiring human input. At first all steps are marked as pending.
When it reaches step 4, mark the status as "require_human_input", and wait for the user input to proceed.
</reasoning>
</example>

## Task States and Management

1. **Plan Title**:
   - Use the plan title to provide a high-level summary of the overall goal or project.
   - Be concise but descriptive enough to understand the main objective at a glance.
   - Follow this format:  <Verb> + <Object/Skill> + <Scenario> (optional)

2. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on this task
   - require_human_input: Task is waiting for user input to proceed
   - completed: Task finished successfully
   - failed: Task attempted but failed

3. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Only have at most ONE task in_progress at any time
   - Complete current tasks before starting new ones
   - Remove tasks that become irrelevant
   - Do not include outputting text replies as part of the plan items.
   - Stop execution immediately if a task is marked as "cancelled".
   - When no "cancelled" tasks are present, before finishing output, MAKE SURE there is no "in_progress" task.
   - When you mark a task as "require_human_input", you should stop executions
     (do no further modifications to the plan, and call no more tools) but output a message to ask for user input.

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness
and ensures you complete all requirements successfully.
"""

PLAN_TOOL_CALL_MESSAGE_UPDATE_DESC = """
This tool allows you to update the message of an existing tool call
to inform the user about the progress or result of that tool call.
If a tool call returns a "tool_call_id" and an existing "message",
you should use this tool to update the message of that tool call with the "tool_call_id".
Prefer concise but informative messages less than 20 words.
This is useful for providing real-time updates on the progress of a tool call,
such as when fetching data or performing an action that takes time.

Typical use cases:
- The original message is too long, too vague (e.g. "Tool finished") or too technical (e.g. "id=123, status=0").
- The original message is outdated and needs to reflect the current status.
"""


PLAN_READ_TOOL = FunctionTool(
    name="plan_read",
    description=PLAN_READ_DESC,
    input_model=PlanReadInput,
    func=_plan_read_func,
)


PLAN_WRITE_TOOL = FunctionTool(
    name="plan_write",
    description=PLAN_WRITE_DESC,
    input_model=PlanWriteInput,
    func=_plan_write_func,
)

PLAN_TOOL_CALL_MESSAGE_UPDATE_TOOL = FunctionTool(
    name="plan_tool_call_message_update",
    description=PLAN_TOOL_CALL_MESSAGE_UPDATE_DESC,
    input_model=PlanToolCallMessageUpdateInput,
    func=_plan_tool_call_message_update_func,
)
