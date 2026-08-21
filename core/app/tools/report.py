"""Report tool — convert internal workspace files into downloadable URLs.

Uploads workspace-relative files through the configured storage provider and
attaches the resulting URLs as tool-call deliverables so the frontend can
render them as download links.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolDeliverable, ToolDeliverableFile, ToolDeliverableType, ToolExecutionInfo, ToolType
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context, normalize_workspace_relative_path
from app.tools.upload_assets import upload_file

_LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# FunctionTool surface
# ---------------------------------------------------------------------------


class ReportFileEntry(BaseModel):
    workspace_file_path: str = Field(
        description="Workspace-relative path of the file to upload (e.g. ``results/batch-xxx/run-yyy/report.html``).",
    )
    as_deliverable: bool = Field(
        default=True,
        description=(
            "When true (default), the uploaded file is attached to the tool call as a "
            "deliverable so the frontend renders it as a download link. When false, the "
            "file is uploaded and the CDN URL is returned in the result but NOT attached "
            "as a deliverable — use this to obtain external URLs for embedding in a "
            "summary report without cluttering the deliverable list."
        ),
    )


class ReportInput(BaseModel):
    files: list[ReportFileEntry] = Field(
        description=(
            "List of workspace files to convert into downloadable URLs. Each entry "
            "specifies a workspace-relative path and whether to expose it as a "
            "deliverable (as_deliverable=true) or just return the URL (as_deliverable=false)."
        ),
        min_length=1,
    )


async def _report_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}

    agent_instance_id = ctx.agent_instance_id
    username = ctx.username
    turn_id = ctx.turn_id
    files_raw: list[Any] = kwargs.get("files") or []
    if not files_raw:
        return {"error_message": "files is required"}

    # Parse entries — accept both dict and ReportFileEntry
    entries: list[ReportFileEntry] = []
    for item in files_raw:
        if isinstance(item, ReportFileEntry):
            entries.append(item)
        elif isinstance(item, dict):
            entries.append(ReportFileEntry(**item))
        else:
            return {"error_message": f"invalid entry in files: {item!r}"}

    _LOGGER.info(
        "Report tool start agent_instance_id=%s username=%s turn_id=%s file_count=%d",
        agent_instance_id,
        username,
        turn_id,
        len(entries),
    )

    tool_call_id = await ctx.plan_editor.create_tool_call(
        "Report",
        "Publishing files as downloadable URLs",
        ToolExecutionInfo(tool_type=ToolType.BUILTIN, builtin_tool_name="report"),
    )

    async def _impl() -> dict[str, Any]:
        uploaded_files: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        workspace_dir = CHAT_FS.get_workspace_path(agent_instance_id, username, ctx.conversation_id)
        workspace_root = workspace_dir.resolve()

        for entry in entries:
            rel_path = entry.workspace_file_path.strip()
            if not rel_path:
                continue
            try:
                rel_path = normalize_workspace_relative_path(rel_path)
                abs_path = (workspace_dir / rel_path).resolve()
                # Prevent path traversal
                if not abs_path.is_relative_to(workspace_root):
                    _LOGGER.warning("Report: path traversal attempt blocked: %s", rel_path)
                    failures.append({"file_path": rel_path, "error_message": "path escapes workspace"})
                    continue
                if not abs_path.exists():
                    failures.append({"file_path": rel_path, "error_message": "file not found in workspace"})
                    continue

                upload_result = await asyncio.to_thread(upload_file, abs_path, ctx.project_id)
                upload_result["file_path"] = rel_path
                upload_result["as_deliverable"] = entry.as_deliverable
                uploaded_files.append(upload_result)

                if entry.as_deliverable:
                    file_deliverable = ToolDeliverable(
                        type=ToolDeliverableType.FILE,
                        file=ToolDeliverableFile(
                            file_sas_url=upload_result["cdn_url"],
                            file_name=upload_result["file_name"],
                            file_uri=upload_result["blob_path"],
                        ),
                    )
                    await ctx.plan_editor.update_tool_call_deliverable(tool_call_id, file_deliverable)

            except Exception as file_exc:
                _LOGGER.error("Report: failed to upload workspace file %s: %s", rel_path, file_exc)
                failures.append({"file_path": rel_path, "error_message": str(file_exc)})

        uploaded_count = len(uploaded_files)
        deliverable_count = sum(1 for f in uploaded_files if f.get("as_deliverable"))
        message = f"Published {uploaded_count} file(s) as downloadable URLs ({deliverable_count} as deliverables)"
        if failures:
            message += f"; {len(failures)} failed"
        return {
            "error_message": "" if not failures else f"{len(failures)} of {len(entries)} uploads failed",
            "message": message,
            "uploaded_files": uploaded_files,
            "failures": failures,
        }

    try:
        result = await _impl()
        await ctx.plan_editor.update_tool_call_message(tool_call_id, result["message"])
        return result

    except Exception as exc:
        _LOGGER.error("Report tool failed: %s", exc, exc_info=True)
        await ctx.plan_editor.update_tool_call_message(tool_call_id, "Failed to publish files.")
        return {"error_message": str(exc)}


REPORT_TOOL = FunctionTool(
    name="report",
    description=(
        "Convert internal workspace file paths into downloadable URLs by uploading them to "
        "blob storage. Use this tool to publish workspace files (e.g. delegate task reports "
        "under ``results/``, generated artifacts, summary documents). Each entry in ``files`` "
        "specifies a workspace-relative path and ``as_deliverable``: when true, the file is "
        "attached as a frontend-visible deliverable (download link); when false, the CDN URL "
        "is returned in the result only — use this to obtain external URLs for embedding in a "
        "summary markdown report without cluttering the deliverable list. "
        "Only accepts workspace-relative paths; absolute paths and traversal outside the "
        "workspace are rejected."
    ),
    input_model=ReportInput,
    func=_report_func,
)
