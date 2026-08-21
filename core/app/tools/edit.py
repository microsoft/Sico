import asyncio
import logging
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context, normalize_workspace_relative_path

_LOGGER = logging.getLogger(__name__)


class EditInput(BaseModel):
    file_path: str = Field(description="Relative file path within the workspace directory.")
    old_string: str = Field(description="The exact string to find in the file.")
    new_string: str = Field(description="The string to replace old_string with.")
    replace_all: bool = Field(default=False, description="If true, replace all occurrences. Otherwise replace only the first.")


async def _edit_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}

    file_path = str(kwargs.get("file_path", "")).strip()
    old_string = str(kwargs.get("old_string", ""))
    new_string = str(kwargs.get("new_string", ""))
    replace_all = bool(kwargs.get("replace_all", False))

    if not file_path:
        return {"error_message": "file_path is required"}
    if not old_string:
        return {"error_message": "old_string is required"}

    try:
        file_path = normalize_workspace_relative_path(file_path)
    except ValueError as exc:
        return {"error_message": str(exc)}

    def _impl() -> dict[str, Any]:
        content = CHAT_FS.read_file(ctx.agent_instance_id, ctx.username, file_path, conversation_id=ctx.conversation_id)

        if old_string not in content:
            return {"error_message": f"old_string not found in {file_path}"}

        if replace_all:
            new_content = content.replace(old_string, new_string)
        else:
            new_content = content.replace(old_string, new_string, 1)

        CHAT_FS.write_file(ctx.agent_instance_id, ctx.username, file_path, new_content, conversation_id=ctx.conversation_id)
        return {"error_message": "", "message": "Edit applied successfully."}

    try:
        return await asyncio.to_thread(_impl)
    except Exception as exc:
        _LOGGER.error("Edit tool failed file_path=%s error=%s", file_path, exc)
        return {"error_message": str(exc)}


EDIT_TOOL = FunctionTool(
    name="edit",
    description=(
        "Edit a file in the workspace by replacing a string. "
        "Provide the exact old_string to find and the new_string to replace it with. "
        "Set replace_all=true to replace all occurrences, or false (default) for just the first. "
        "Fails if old_string is not found in the file."
    ),
    input_model=EditInput,
    func=_edit_func,
)
