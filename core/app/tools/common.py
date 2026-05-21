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

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from agent_framework import ChatResponse, ChatResponseUpdate, FunctionTool
from agent_framework._middleware import FunctionInvocationContext, FunctionMiddleware
from pydantic import BaseModel, ConfigDict

from app.schemas.conversation.plan import ToolCallStatus

from .plan import PlanEditor, begin_tool_call_status_tracking, finish_tool_call_status_tracking

_TOOL_CONTEXT_KWARGS_KEY = "tool_context"
_LOGGER = logging.getLogger(__name__)


def get_tool_context(ctx: FunctionInvocationContext | None = None) -> "ToolContext | None":
    """Extract ToolContext from FunctionInvocationContext."""
    if ctx is not None:
        return ctx.kwargs.get(_TOOL_CONTEXT_KWARGS_KEY)
    return None

class ToolContext(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    username: str
    agent_id: str
    agent_instance_id: int | None
    turn_id: int
    project_id: int
    conversation_id: int
    response_queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None]
    plan_editor: PlanEditor
    all_tools: list[FunctionTool | dict[str, Any]] = []

    def replace_plan_editor(self, new_plan_editor: PlanEditor) -> "ToolContext":
        return ToolContext(
            username=self.username,
            agent_id=self.agent_id,
            agent_instance_id=self.agent_instance_id,
            turn_id=self.turn_id,
            project_id=self.project_id,
            conversation_id=self.conversation_id,
            response_queue=self.response_queue,
            plan_editor=new_plan_editor,
            all_tools=self.all_tools,
        )


class ToolCallStatusMiddleware(FunctionMiddleware):
    async def process(
        self,
        context: FunctionInvocationContext,
        call_next: Callable[[], Awaitable[None]],
    ) -> None:
        tool_context = get_tool_context(context)
        if tool_context is None:
            await call_next()
            return

        tracking_token = begin_tool_call_status_tracking()
        status: ToolCallStatus | None = None
        try:
            await call_next()
        except Exception:
            status = ToolCallStatus.FAILED
            raise
        else:
            status = ToolCallStatus.FAILED if _result_indicates_failure(context.result) else ToolCallStatus.SUCCESSFUL
        finally:
            tool_call_ids = finish_tool_call_status_tracking(tracking_token)
            if status is not None:
                await self._finalize(tool_context.plan_editor, tool_call_ids, status)

    async def _finalize(self, plan_editor: PlanEditor, tool_call_ids: list[int], status: ToolCallStatus) -> None:
        try:
            for tool_call_id in tool_call_ids:
                await plan_editor.update_tool_call_status_if_running(tool_call_id, status)
        except Exception:
            _LOGGER.warning("Failed to update tool call status from middleware", exc_info=True)


def _result_indicates_failure(result: Any) -> bool:
    if isinstance(result, list):
        return any(_result_indicates_failure(item) for item in result)
    if isinstance(result, dict):
        return _payload_indicates_failure(result)
    text = getattr(result, "text", None)
    if text is None:
        return False
    try:
        parsed = json.loads(str(text))
    except json.JSONDecodeError:
        return False
    return _result_indicates_failure(parsed)


def _payload_indicates_failure(payload: dict[str, Any]) -> bool:
    if payload.get("success") is False:
        return True
    for key in ("error_message", "errorMessage", "error"):
        value = payload.get(key)
        if value not in (None, "", [], {}):
            return True
    return False
