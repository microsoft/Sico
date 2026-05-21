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
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel

from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

class ContextInput(BaseModel):
    pass


def load_workspace_context(
    agent_instance_id: int, username: str, retrieve_knowledge_summary: bool = False
) -> dict[str, list[dict[str, Any]]]:
    workspace = CHAT_FS.get_workspace_path(agent_instance_id, username)
    if not workspace.exists():
        return {"files": [], "skills": [], "knowledge": []}

    files = CHAT_FS.list_files(agent_instance_id, username)

    # Load raw content from index.json files.
    skills_list: list[dict[str, Any]] = []
    knowledge_list: list[dict[str, Any]] = []

    skills_index = workspace / "skills" / "index.json"
    if skills_index.exists():
        try:
            loaded = json.loads(skills_index.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                skills_list = loaded
        except Exception:
            pass

    knowledge_index = workspace / "knowledge" / "index.json"
    if knowledge_index.exists():
        try:
            loaded = json.loads(knowledge_index.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                knowledge_list = loaded
            if retrieve_knowledge_summary:
                for item in knowledge_list:
                    knowledge_id = item.get("id", None)
                    if knowledge_id is not None:
                        summary_path = workspace / "knowledge" / f"{knowledge_id}" / "summary.md"
                        if summary_path.exists():
                            item["summary"] = summary_path.read_text(encoding="utf-8")
        except Exception:
            pass

    return {
        "files": files,
        "skills": skills_list,
        "knowledge": knowledge_list,
    }

async def _context_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {
            "error_message": "missing tool context",
            "files": [],
            "skills": [],
            "knowledge": [],
        }

    def _impl() -> dict[str, Any]:
        context = load_workspace_context(ctx.agent_instance_id, ctx.username)
        return {
            "error_message": "",
            "files": context["files"],
            "skills": context["skills"],
            "knowledge": context["knowledge"],
        }

    try:
        return await asyncio.to_thread(_impl)
    except Exception as exc:
        _LOGGER.error("Context tool failed agent_instance_id=%s error=%s", ctx.agent_instance_id, exc)
        return {
            "error_message": str(exc),
            "files": [],
            "skills": [],
            "knowledge": [],
        }


CONTEXT_TOOL = FunctionTool(
    name="context",
    description=(
        "List all files in the workspace directory (recursive). "
        "Think of it as the 'ls' command for the agent's current workspace."
        "Returns file paths and sizes, plus the raw content from skills/index.json "
        "and knowledge/index.json as top-level fields. "
        "This is usually the first tool to call. "
        "Call it frequently to get an updated view of the workspace state, "
        "especially after using write_file, edit, or remove tools."
    ),
    input_model=ContextInput,
    func=_context_func,
)
