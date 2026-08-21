import asyncio
import logging
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context, normalize_workspace_relative_path

_LOGGER = logging.getLogger(__name__)


class WriteInput(BaseModel):
    filepath: str = Field(
        description="Relative file path to write (e.g. 'script.py' or 'data/input.json'). "
        "Will be saved under the workspace/ directory."
    )
    content: str = Field(description="The content to write to the file.")


async def _write_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}

    filepath = str(kwargs.get("filepath", "")).strip()
    content = str(kwargs.get("content", ""))
    agent_instance_id = ctx.agent_instance_id
    username = ctx.username

    _LOGGER.info(
        "Write tool start agent_instance_id=%s username=%s filepath=%s",
        agent_instance_id,
        username,
        filepath,
    )

    if not filepath:
        return {"error_message": "filepath is required"}

    # Block path traversal attempts that would escape the workspace directory.
    try:
        filepath = normalize_workspace_relative_path(filepath)
    except ValueError as exc:
        return {"error_message": str(exc)}

    def _impl() -> dict[str, Any]:
        CHAT_FS.write_file(agent_instance_id, username, filepath, content, conversation_id=ctx.conversation_id)

        return {
            "error_message": "",
            "filepath": f"workspace/{filepath}",
            "size_bytes": len(content.encode("utf-8")),
        }

    try:
        return await asyncio.to_thread(_impl)
    except Exception as exc:
        _LOGGER.error("Write tool failed filepath=%s error=%s", filepath, exc)
        return {"error_message": str(exc)}


WRITE_FILE_TOOL = FunctionTool(
    name="write_file",
    description="Write a file to the agent's workspace directory. "
    "The file will be saved under the workspace/ directory for the current turn. "
    "Useful for generating scripts, data files, or other artifacts.",
    input_model=WriteInput,
    func=_write_func,
)
