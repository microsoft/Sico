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
import logging
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolExecutionInfo, ToolType
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_MAX_LINES = 200
_MAX_RESPONSE_BYTES = 20 * 1024  # 20 KB
_TRUNCATED_MARKER = "\n...TRUNCATED..."

class ReadInput(BaseModel):
    file_path: str = Field(description="Relative file path within the workspace directory.")
    offset: int = Field(default=0, description="0-based line offset to start reading from. Defaults to 0 (beginning of file).")
    lines: int = Field(default=_MAX_LINES, description=f"Number of lines to read. Defaults and caps at {_MAX_LINES}.")


async def _read_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context", "content": ""}

    file_path = str(kwargs.get("file_path", "")).strip()
    offset = max(0, int(kwargs.get("offset", 0)))
    lines = min(max(1, int(kwargs.get("lines", _MAX_LINES))), _MAX_LINES)

    if not file_path:
        return {"error_message": "file_path is required", "content": ""}

    _LOGGER.info(
        "Read tool start agent_instance_id=%s file_path=%s offset=%s lines=%s",
        ctx.agent_instance_id, file_path, offset, lines,
    )

    plan_editor = ctx.plan_editor
    tool_call_id = await plan_editor.create_tool_call(
        "Read", f"Reading file {file_path}",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="read",
        )
    )

    def _impl() -> dict[str, Any]:
        full_content = CHAT_FS.read_file(ctx.agent_instance_id, ctx.username, file_path)

        all_lines = full_content.splitlines(keepends=True)
        total_lines = len(all_lines)

        selected = all_lines[offset : offset + lines]
        content = "".join(selected)

        truncated = False
        if len(content.encode("utf-8")) > _MAX_RESPONSE_BYTES:
            encoded = content.encode("utf-8")[:_MAX_RESPONSE_BYTES].decode("utf-8", errors="ignore")
            content = encoded + _TRUNCATED_MARKER
            truncated = True

        return {
            "content": content,
            "total_lines": total_lines,
            "offset": offset,
            "lines_returned": len(selected),
            "truncated": truncated,
        }

    try:
        result = await asyncio.to_thread(_impl)

        offset = result.get("offset", offset)
        lines_returned = result.get("lines_returned", len(result.get("content", "").splitlines()))
        message = f"Read file {file_path}, line {offset} to {offset + lines_returned}."
        await plan_editor.update_tool_call_message(tool_call_id, message)

        return {
            "error_message": "",
            "tool_call_id": tool_call_id,
            "message": message,
            **result
        }
    except Exception as exc:  # pragma: no cover - defensive guard for unexpected filesystem errors
        _LOGGER.error("Read tool failed file_path=%s error=%s", file_path, exc)

        message = f"Failed to read file {file_path}"
        await plan_editor.update_tool_call_message(tool_call_id, message)

        return {
            "error_message": str(exc),
            "content": "",
            "tool_call_id": tool_call_id,
            "message": message,
        }


READ_TOOL = FunctionTool(
    name="read",
    description=(
        "Read a file from the workspace directory. "
        "Provide a relative file_path. "
        "Use 'offset' and 'lines' to read the document in chunks (max 200 lines per call). "
        "Returns total_lines so you can paginate through large documents."
    ),
    input_model=ReadInput,
    func=_read_func,
)
