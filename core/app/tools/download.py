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

"""Download a file from a public URL and extract content using AI content understanding."""

import asyncio
import logging
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.document import build_doc_extractor
from app.schemas.conversation.plan import ToolExecutionInfo, ToolType
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
_DEFAULT_TIMEOUT = 60  # seconds
_MAX_TIMEOUT = 300  # seconds

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/143.0.0.0 Safari/537.36"
)

_extractor = None


def _get_extractor():
    global _extractor
    if _extractor is None:
        _extractor = build_doc_extractor(_LOGGER)
    return _extractor


class DownloadInput(BaseModel):
    url: str = Field(description="The public URL pointing directly to a file to download (e.g. https://some-cdn.com/file.pdf).")


async def _download_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}

    url = str(kwargs.get("url", "")).strip()
    if not url:
        return {"error_message": "url is required"}

    if not url.startswith("http://") and not url.startswith("https://"):
        return {"error_message": "URL must start with http:// or https://"}

    parsed = urlparse(url)
    raw_name = Path(parsed.path).name if parsed.path else ""
    if not raw_name:
        raw_name = "downloaded_file"
    # Sanitize the filename
    file_name = "".join(c for c in raw_name if c.isalnum() or c in "._-")
    if not file_name:
        file_name = "downloaded_file"

    download_rel_path = f"download/{file_name}"

    tool_call_id = await ctx.plan_editor.create_tool_call(
        "Download", f"Downloading file: {url}",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="download"
        )
    )

    extractor = _get_extractor()

    def _impl() -> dict[str, Any]:
        # Download the file
        headers = {"User-Agent": _USER_AGENT}
        response = requests.get(url, headers=headers, timeout=_DEFAULT_TIMEOUT, stream=True, allow_redirects=True)

        if not response.ok:
            raise RuntimeError(f"Download failed with status code: {response.status_code}")

        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > _MAX_FILE_SIZE:
            raise RuntimeError(f"File too large (exceeds {_MAX_FILE_SIZE // (1024 * 1024)}MB limit)")

        # Read content with size limit
        chunks = []
        total = 0
        for chunk in response.iter_content(chunk_size=8192):
            total += len(chunk)
            if total > _MAX_FILE_SIZE:
                raise RuntimeError(f"File too large (exceeds {_MAX_FILE_SIZE // (1024 * 1024)}MB limit)")
            chunks.append(chunk)
        file_bytes = b"".join(chunks)

        # Write the file to workspace
        workspace = CHAT_FS.get_workspace_path(ctx.agent_instance_id, ctx.username)
        target = workspace / download_rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(file_bytes)

        result: dict[str, Any] = {
            "error_message": "",
            "file_name": download_rel_path,
            "file_size_kb": round(len(file_bytes) / 1024, 2),
        }

        result["summary"] = ""
        result["full_markdown_path"] = ""

        return result

    try:
        result = await asyncio.to_thread(_impl)
        # Extract content using the configured document extractor (async)
        if extractor is not None:
            try:
                abs_path = CHAT_FS.resolve_workspace_file(ctx.agent_instance_id, ctx.username, download_rel_path)
                full_text, summary = await extractor.extract(str(abs_path))

                md_name = Path(file_name).stem + ".md"
                full_md_path = f"download/{md_name}"

                CHAT_FS.write_file(ctx.agent_instance_id, ctx.username, full_md_path, full_text)

                result["summary"] = summary
                result["full_markdown_path"] = full_md_path
            except Exception as exc:
                _LOGGER.warning("Content extraction failed for %s: %s", download_rel_path, exc)
        msg = f"Downloaded {file_name} ({result['file_size_kb']} KB)"
        if result.get("full_markdown_path"):
            msg += f", extracted content to {result['full_markdown_path']}"
        await ctx.plan_editor.update_tool_call_message(tool_call_id, msg)
        return result
    except Exception as exc:
        _LOGGER.error("download failed url=%s error=%s", url, exc)
        await ctx.plan_editor.update_tool_call_message(tool_call_id, "Failed to download file.")
        return {"error_message": str(exc)}


DOWNLOAD_TOOL = FunctionTool(
    name="download",
    description=(
        "Download a file from a public URL and extract its content. "
        "The file is saved under the 'download/' directory in the workspace. "
        "If the file is a supported document (PDF, DOCX, PPTX, etc.), content is extracted "
        "using AI content understanding and a markdown version is also saved.\n\n"
        "Returns the file name, file size in KB, a summary of the content, "
        "and the path to the full markdown extraction.\n\n"
        "Usage notes:\n"
        "- Use this for public links that directly point to files (e.g. https://some-cdn.com/file.pdf)\n"
        "- Maximum file size: 50MB\n"
        "- For web pages, use `webfetch` instead"
    ),
    input_model=DownloadInput,
    func=_download_func,
)
