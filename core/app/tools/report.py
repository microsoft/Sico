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

from app.schemas.conversation.plan import ToolDeliverable, ToolDeliverableType, ToolExecutionInfo, ToolType
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context
from app.tools.upload_assets import upload_file_to_blob

_LOGGER = logging.getLogger(__name__)


class ReportInput(BaseModel):
    workspace_file_paths: list[str] = Field(
        default_factory=list,
        description=(
            "List of file paths (relative to the chat workspace directory) "
            "to upload to blob storage and include as downloadable file deliverables. "
            "For example: ['output/presentation.pptx', 'results/data.csv']."
        ),
    )


async def _report_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}

    agent_instance_id = ctx.agent_instance_id
    username = ctx.username
    turn_id = ctx.turn_id
    workspace_file_paths: list[str] = kwargs.get("workspace_file_paths") or []
    if not workspace_file_paths:
        return {"error_message": "workspace_file_paths is required"}

    _LOGGER.info(
        "Report tool start agent_instance_id=%s username=%s turn_id=%s",
        agent_instance_id, username, turn_id,
    )

    tool_call_id = await ctx.plan_editor.create_tool_call(
        "Report", "Writing report to storage",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="report"
        )
    )

    async def _impl() -> dict[str, Any]:
        uploaded_files: list[dict[str, Any]] = []
        for rel_path in workspace_file_paths:
            rel_path = rel_path.strip()
            if not rel_path:
                continue
            try:
                workspace_dir = CHAT_FS.get_workspace_path(agent_instance_id, username)
                abs_path = workspace_dir / rel_path
                # Prevent path traversal
                abs_path = abs_path.resolve()
                if not str(abs_path).startswith(str(workspace_dir.resolve())):
                    _LOGGER.warning("Report: path traversal attempt blocked: %s", rel_path)
                    continue

                upload_result = await asyncio.to_thread(
                    upload_file_to_blob, abs_path, ctx.project_id
                )
                uploaded_files.append(upload_result)

                file_deliverable = ToolDeliverable(
                    type=ToolDeliverableType.FILE,
                    file_url=upload_result["cdn_url"],
                    file_name=upload_result["file_name"],
                )
                await ctx.plan_editor.update_tool_call_deliverable(tool_call_id, file_deliverable)

            except Exception as file_exc:
                _LOGGER.error("Report: failed to upload workspace file %s: %s", rel_path, file_exc)

        uploaded_count = len(uploaded_files)
        return {
            "error_message": "",
            "message": f"Uploaded {uploaded_count} important file(s)",
            "uploaded_files": uploaded_files,
        }

    try:
        result = await _impl()
        await ctx.plan_editor.update_tool_call_message(tool_call_id, result["message"])
        return result

    except Exception as exc:
        _LOGGER.error("Report tool failed: %s", exc, exc_info=True)
        await ctx.plan_editor.update_tool_call_message(tool_call_id, "Failed to write report.")
        return {"error_message": str(exc)}


REPORT_TOOL = FunctionTool(
    name="report",
    description='''
Upload important files from the chat workspace to blob storage.
Use this when the user wants to receive downloadable files or reports that
were produced during execution.
''',
    input_model=ReportInput,
    func=_report_func,
)
