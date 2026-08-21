import asyncio
import logging
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context, normalize_workspace_relative_path

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

    try:
        file_path = normalize_workspace_relative_path(file_path)
    except ValueError as exc:
        return {"error_message": str(exc)}

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
