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

"""Parse a document file using the configured document extractor."""

import logging
import os
from pathlib import Path
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.document import build_doc_extractor
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_extractor = None


def _get_extractor():
    global _extractor
    if _extractor is None:
        _extractor = build_doc_extractor(_LOGGER)
    return _extractor


class ParseDocumentInput(BaseModel):
    file_path: str = Field(description="Relative file path within the workspace to parse (e.g. 'attachments/report.pdf').")


def _error(message: str) -> dict[str, Any]:
    return {"error_message": message}


def _get_parse_request(
    invocation_ctx: FunctionInvocationContext,
    kwargs: dict[str, Any],
) -> tuple[ToolContext | None, str, str]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return None, "", "missing tool context"

    file_path = str(kwargs.get("file_path", "")).strip()
    if not file_path:
        return None, "", "file_path is required"

    normalized = os.path.normpath(file_path)
    if normalized.startswith("..") or os.path.isabs(normalized):
        return None, "", "file_path must be relative and within the workspace directory"

    return ctx, file_path, ""


async def _parse_document_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx, file_path, error_message = _get_parse_request(invocation_ctx, kwargs)
    if error_message:
        return _error(error_message)
    assert ctx is not None

    extractor = _get_extractor()
    if extractor is None:
        return _error("document extractor is not configured")

    try:
        abs_path = CHAT_FS.resolve_workspace_file(ctx.agent_instance_id, ctx.username, file_path)
        if not abs_path.exists():
            return _error(f"file not found: {file_path}")

        full_text, summary = await extractor.extract(str(abs_path))

        # Write full.md next to the original file
        parent_dir = Path(file_path).parent.as_posix()
        full_md_path = f"{parent_dir}/full.md" if parent_dir != "." else "full.md"

        CHAT_FS.write_file(ctx.agent_instance_id, ctx.username, full_md_path, full_text)

        return {
            "error_message": "",
            "summary": summary,
            "full_markdown_path": full_md_path,
        }
    except Exception as exc:
        _LOGGER.error("parse_document failed file_path=%s error=%s", file_path, exc)
        return _error(str(exc))


PARSE_DOCUMENT_TOOL = FunctionTool(
    name="parse_document",
    description=(
        "Parse a document file (PDF, DOCX, PPTX, etc.) using AI content understanding. "
        "Returns a summary and writes the full parsed content as a markdown file (full.md) "
        "next to the original file. Use this to extract text from non-text documents."
    ),
    input_model=ParseDocumentInput,
    func=_parse_document_func,
)
