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

"""Report tool — convert internal workspace files into downloadable URLs.

Uploads workspace-relative files to SeaweedFS via the filer's HTTP API and
attaches the resulting CDN URLs as tool-call deliverables so the frontend can
render them as download links.

Mirrors the backend SeaweedFS storage layer
(``backend/internal/infra/storage/seaweedfs.go``):

  - Object path: ``default_space/{project_id}/{object_key}``
  - Filer URL:   ``{SEAWEEDFS_ENDPOINT}/default_space/{project_id}/{object_key}``

The raw filer URL is returned as ``cdn_url``. Inside the docker/kind network
this points at the cluster-internal filer hostname; sico-nginx rewrites such
URLs to same-origin ``/storage/...`` paths via ``sub_filter`` so that browsers
can fetch them.
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolDeliverable, ToolDeliverableType, ToolExecutionInfo, ToolType
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context
from app.utils.uploads import post_file

_LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# SeaweedFS upload helpers (mirrors backend SEAWEEDFS_ENDPOINT env var)
# ---------------------------------------------------------------------------


_DEFAULT_PATH_PREFIX = "default_space"


def _seaweedfs_endpoint() -> str:
    endpoint = os.getenv("SEAWEEDFS_ENDPOINT", "").rstrip("/")
    if not endpoint:
        raise RuntimeError("SEAWEEDFS_ENDPOINT must be set")
    return endpoint


def _build_filer_url(endpoint: str, blob_path: str) -> str:
    return f"{endpoint}/{blob_path.lstrip('/')}"


def upload_file_to_blob(file_path: Path, project_id: int) -> dict[str, Any]:
    """Upload a local file to SeaweedFS and return metadata.

    Args:
        file_path: Absolute path to the file on disk.
        project_id: Project ID used as the blob namespace.

    Returns:
        Dict with keys: cdn_url, blob_path, object_key, file_name, size_bytes.

    Raises:
        FileNotFoundError: If *file_path* does not exist.
        RuntimeError: If SeaweedFS is not configured or the upload fails.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"file not found: {file_path}")

    original_name = file_path.name
    ext = file_path.suffix or ".bin"
    unique_id = uuid.uuid4().hex
    object_key = f"{unique_id}{ext}"
    blob_path = f"{_DEFAULT_PATH_PREFIX}/{project_id}/{object_key}"

    content_type, _ = mimetypes.guess_type(str(file_path))
    if not content_type:
        content_type = "application/octet-stream"

    data = file_path.read_bytes()

    endpoint = _seaweedfs_endpoint()
    filer_url = _build_filer_url(endpoint, blob_path)

    _LOGGER.info(
        "upload_file_to_blob project_id=%s file=%s blob_path=%s content_type=%s",
        project_id,
        original_name,
        blob_path,
        content_type,
    )

    response = post_file(
        filer_url,
        file_name=object_key,
        data=data,
        content_type=content_type,
        timeout=60,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(f"SeaweedFS upload failed with status {response.status_code}: {response.text}")

    return {
        "cdn_url": filer_url,
        "blob_path": blob_path,
        "object_key": object_key,
        "file_name": original_name,
        "size_bytes": len(data),
    }


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
        workspace_dir = CHAT_FS.get_workspace_path(agent_instance_id, username)
        workspace_root = workspace_dir.resolve()

        for entry in entries:
            rel_path = entry.workspace_file_path.strip()
            if not rel_path:
                continue
            try:
                abs_path = (workspace_dir / rel_path).resolve()
                # Prevent path traversal
                if not abs_path.is_relative_to(workspace_root):
                    _LOGGER.warning("Report: path traversal attempt blocked: %s", rel_path)
                    failures.append({"file_path": rel_path, "error_message": "path escapes workspace"})
                    continue
                if not abs_path.exists():
                    failures.append({"file_path": rel_path, "error_message": "file not found in workspace"})
                    continue

                upload_result = await asyncio.to_thread(upload_file_to_blob, abs_path, ctx.project_id)
                upload_result["file_path"] = rel_path
                upload_result["as_deliverable"] = entry.as_deliverable
                uploaded_files.append(upload_result)

                if entry.as_deliverable:
                    file_deliverable = ToolDeliverable(
                        type=ToolDeliverableType.FILE,
                        file_url=upload_result["cdn_url"],
                        file_name=upload_result["file_name"],
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
