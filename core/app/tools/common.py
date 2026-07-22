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
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from agent_framework import ChatResponse, ChatResponseUpdate, FunctionTool
from agent_framework._middleware import FunctionInvocationContext, FunctionMiddleware
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.conversation.plan import ToolCallStatus
from app.storage.fs import CHAT_FS

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
    all_tools: list[FunctionTool | dict[str, Any]] = Field(default_factory=list)
    raw_user_message: str = ""
    task_runtime_batch_ids: list[str] = Field(default_factory=list)
    skill_loader: Any | None = None

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
            raw_user_message=self.raw_user_message,
            task_runtime_batch_ids=self.task_runtime_batch_ids,
            skill_loader=self.skill_loader,
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


# ---------------------------------------------------------------------------
# Tool output truncation middleware
# ---------------------------------------------------------------------------

_MAX_TOOL_OUTPUT_LENGTH = 20_000  # characters before truncation
_PREVIEW_LENGTH = 2_000  # characters of preview in truncated output


class ToolOutputTruncationMiddleware(FunctionMiddleware):
    """Middleware that truncates oversized tool results.

    When the serialized tool result exceeds ``_MAX_TOOL_OUTPUT_LENGTH`` characters,
    the full output is saved to ``.tmp/<uuid>.txt`` in the workspace and the result
    is replaced with a preview plus the file path.

    Per-tool ``additional_properties`` recognised by this middleware:

    * ``summarize_on_truncate`` (bool) – generate an LLM summary when truncated.
    * ``max_output_length`` (int) – override the default truncation threshold.
    * ``skip_truncation`` (bool) – bypass truncation entirely.
    """

    async def process(
        self,
        context: FunctionInvocationContext,
        call_next: Callable[[], Awaitable[None]],
    ) -> None:
        await call_next()

        _LOGGER.info("Tool output truncation middleware processing tool=%s", context.function.name)

        props = getattr(context.function, "additional_properties", None) or {}
        if props.get("skip_truncation"):
            return

        tool_context = get_tool_context(context)
        if tool_context is None or tool_context.agent_instance_id is None:
            return

        result = context.result
        if result is None:
            return

        # Serialize the result to measure length
        try:
            serialized = result if isinstance(result, str) else json.dumps(result, default=str)
        except (TypeError, ValueError) as e:
            _LOGGER.warning(
                "Failed to serialize tool result for truncation check, skipping truncation tool=%s error=%s",
                context.function.name,
                e,
            )
            return

        max_length = props.get("max_output_length", _MAX_TOOL_OUTPUT_LENGTH)

        if len(serialized) <= max_length:
            return

        # Save full output to .tmp/
        tmp_filename = f".tmp/{uuid.uuid4().hex[:12]}.txt"
        try:
            CHAT_FS.write_file(
                tool_context.agent_instance_id,
                tool_context.username,
                tmp_filename,
                serialized,
                conversation_id=tool_context.conversation_id,
            )
        except Exception:
            _LOGGER.warning("Failed to save truncated tool output to %s", tmp_filename, exc_info=True)
            return

        total_chars = len(serialized)
        preview = serialized[:_PREVIEW_LENGTH]

        # Check if the tool opts in to summarization
        summary = ""
        if props.get("summarize_on_truncate"):
            try:
                from app.document.markitdown import _generate_summary_via_llm

                summary = await _generate_summary_via_llm(serialized)
            except Exception:
                _LOGGER.warning("Failed to generate summary for truncated tool output", exc_info=True)

        truncation_notice = (
            f"\n\n... [Output truncated. Full output ({total_chars} chars) "
            f"saved to: {tmp_filename} — use the read or grep tool to inspect it.]"
        )

        _LOGGER.info(
            "tool_output_truncated tool=%s total_chars=%s preview_chars=%s full_output_path=%s",
            context.function.name,
            total_chars,
            len(preview),
            tmp_filename,
        )

        failure_hint: dict[str, Any] = {}
        if isinstance(result, dict):
            for key in ("success", "error_message", "errorMessage", "error"):
                if key in result:
                    failure_hint[key] = result.get(key)

        context.result = {
            "preview": preview + truncation_notice,
            "full_output_path": tmp_filename,
            "total_chars": total_chars,
            **failure_hint,
        }

        if summary:
            context.result["summary"] = summary
