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
import os
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)


class RemoveInput(BaseModel):
    file_path: str = Field(description="Relative file path or directory within the workspace to remove.")


async def _remove_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}

    file_path = str(kwargs.get("file_path", "")).strip()
    if not file_path:
        return {"error_message": "file_path is required"}

    normalized = os.path.normpath(file_path)
    if normalized.startswith("..") or os.path.isabs(normalized):
        return {"error_message": "file_path must be relative and within the workspace directory"}

    def _impl() -> dict[str, Any]:
        CHAT_FS.delete_file(ctx.agent_instance_id, ctx.username, file_path, conversation_id=ctx.conversation_id)
        return {"error_message": "", "message": f"Removed {file_path}"}

    try:
        return await asyncio.to_thread(_impl)
    except Exception as exc:
        _LOGGER.error("Remove tool failed file_path=%s error=%s", file_path, exc)
        return {"error_message": str(exc)}


REMOVE_TOOL = FunctionTool(
    name="remove",
    description=(
        "Remove a file or directory from the workspace. "
        "Provide a relative path within the workspace directory. "
        "Use this to clean up files that are no longer needed."
    ),
    input_model=RemoveInput,
    func=_remove_func,
)
