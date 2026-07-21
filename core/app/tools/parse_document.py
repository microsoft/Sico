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

import asyncio
import logging
import os
from collections import OrderedDict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.document import build_doc_extractor
from app.schemas.conversation.plan import (
    Plan,
    PlanExtra,
    PlanStep,
    PlanStepStatus,
    ToolExecutionInfo,
    ToolType,
)
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context
from app.tools.parse_document_hooks import (
    ParseDocumentHookContext,
    dispatch_post_parse_hooks,
)

_LOGGER = logging.getLogger(__name__)

_DOCUMENT_PREPARATION_PLAN_TITLE = "Document Preparation"
_PARSE_DOCUMENT_CACHE_MAX_ENTRIES = 128

_extractor = None
_PARSE_DOCUMENT_CACHE: OrderedDict[tuple[int, str, int, int, str], dict[str, Any]] = OrderedDict()
_PARSE_DOCUMENT_LOCKS: dict[tuple[int, str, int, int, str], asyncio.Lock] = {}
_PARSE_DOCUMENT_LOCK_REFS: dict[tuple[int, str, int, int, str], int] = {}
_PARSE_DOCUMENT_LOCKS_GUARD = asyncio.Lock()


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
    file_path = str(kwargs.get("file_path", "")).strip()
    error_message = _validate_parse_document_request(ctx, file_path)
    if error_message:
        return None, "", error_message

    return ctx, file_path, ""


async def _parse_document_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx, file_path, error_message = _get_parse_request(invocation_ctx, kwargs)
    if error_message:
        return _error(error_message)
    assert ctx is not None

    extractor = _get_extractor()
    if extractor is None:
        return _error("document extractor is not configured")

    cache_key = _parse_document_cache_key(ctx, file_path)
    async with _parse_document_lock(cache_key):
        cached_result = _PARSE_DOCUMENT_CACHE.get(cache_key)
        if cached_result is not None:
            _PARSE_DOCUMENT_CACHE.move_to_end(cache_key)
            return dict(cached_result)

        result = await _parse_document_uncached(ctx, file_path, extractor)
        if not result.get("error_message"):
            _PARSE_DOCUMENT_CACHE[cache_key] = dict(result)
            _PARSE_DOCUMENT_CACHE.move_to_end(cache_key)
            _prune_parse_document_cache()
        return result


@asynccontextmanager
async def _parse_document_lock(cache_key: tuple[int, str, int, int, str]) -> AsyncIterator[None]:
    async with _PARSE_DOCUMENT_LOCKS_GUARD:
        lock = _PARSE_DOCUMENT_LOCKS.setdefault(cache_key, asyncio.Lock())
        _PARSE_DOCUMENT_LOCK_REFS[cache_key] = _PARSE_DOCUMENT_LOCK_REFS.get(cache_key, 0) + 1
    await lock.acquire()
    try:
        yield
    finally:
        lock.release()
        async with _PARSE_DOCUMENT_LOCKS_GUARD:
            refs = _PARSE_DOCUMENT_LOCK_REFS.get(cache_key, 0) - 1
            if refs <= 0:
                _PARSE_DOCUMENT_LOCK_REFS.pop(cache_key, None)
                if _PARSE_DOCUMENT_LOCKS.get(cache_key) is lock:
                    _PARSE_DOCUMENT_LOCKS.pop(cache_key, None)
            else:
                _PARSE_DOCUMENT_LOCK_REFS[cache_key] = refs


def _prune_parse_document_cache() -> None:
    while len(_PARSE_DOCUMENT_CACHE) > _PARSE_DOCUMENT_CACHE_MAX_ENTRIES:
        _PARSE_DOCUMENT_CACHE.popitem(last=False)


async def _parse_document_uncached(ctx: ToolContext, file_path: str, extractor) -> dict[str, Any]:
    tool_call_id = await _create_parse_plan_tool_call(ctx, file_path)

    try:
        abs_path = CHAT_FS.resolve_workspace_file(ctx.agent_instance_id, ctx.username, file_path, ctx.conversation_id)
        if not abs_path.exists():
            message = f"file not found: {file_path}"
            await _finish_parse_plan_tool_call(ctx, tool_call_id, file_path, message, failed=True)
            return _error(message)

        full_text, summary = await extractor.extract(str(abs_path))

        # Write full.md next to the original file
        parent_dir = Path(file_path).parent.as_posix()
        full_md_path = f"{parent_dir}/full.md" if parent_dir != "." else "full.md"

        CHAT_FS.write_file(ctx.agent_instance_id, ctx.username, full_md_path, full_text, conversation_id=ctx.conversation_id)

        inline_limit = _inline_content_limit()
        inline_content = full_text[:inline_limit]

        extras = dispatch_post_parse_hooks(
            ParseDocumentHookContext(
                ctx=ctx,
                file_path=file_path,
                abs_path=abs_path,
                full_markdown_path=full_md_path,
                full_text=full_text,
                summary=summary,
            )
        )
        parse_message = _document_parse_message(file_path, full_md_path, full_text, extras.message_stats)
        await _finish_parse_plan_tool_call(
            ctx,
            tool_call_id,
            file_path,
            parse_message,
            failed=False,
        )
        return {
            "error_message": "",
            "summary": summary,
            "full_markdown_path": full_md_path,
            "content": inline_content,
            "content_chars": len(full_text),
            "content_truncated": len(full_text) > inline_limit,
            **extras.response_fields,
        }
    except Exception as exc:
        _LOGGER.error("parse_document failed file_path=%s error=%s", file_path, exc)
        await _finish_parse_plan_tool_call(ctx, tool_call_id, file_path, str(exc), failed=True)
        return _error(str(exc))


def _parse_document_cache_key(ctx: ToolContext, file_path: str) -> tuple[int, str, int, int, str]:
    normalized = Path(os.path.normpath(file_path)).as_posix()
    return (int(ctx.agent_instance_id or 0), ctx.username, int(ctx.conversation_id or 0), int(ctx.turn_id or 0), normalized)


async def _create_parse_plan_tool_call(ctx: ToolContext, file_path: str) -> int:
    plan_editor = getattr(ctx, "plan_editor", None)
    if plan_editor is None:
        return 0
    try:
        if await plan_editor.get_plan() is None:
            await plan_editor.update_plan(
                Plan(
                    title=_DOCUMENT_PREPARATION_PLAN_TITLE,
                    steps=[PlanStep(title="Parse attachment", status=PlanStepStatus.IN_PROGRESS)],
                    extra=PlanExtra(
                        username=ctx.username,
                        agent_instance_id=int(ctx.agent_instance_id or 0),
                        agent_id=ctx.agent_id,
                        turn_id=ctx.turn_id,
                        project_id=ctx.project_id,
                        conversation_id=ctx.conversation_id,
                    ),
                )
            )
        tool_call_id = await plan_editor.create_tool_call(
            "parse_document",
            f"Parsing document: {file_path}",
            ToolExecutionInfo(tool_type=ToolType.BUILTIN, builtin_tool_name="parse_document"),
        )
        return tool_call_id
    except Exception:
        _LOGGER.debug("failed to publish parse_document plan progress", exc_info=True)
        return 0


async def _finish_parse_plan_tool_call(
    ctx: ToolContext,
    tool_call_id: int,
    file_path: str,
    message: str,
    *,
    failed: bool,
) -> None:
    if not tool_call_id:
        return
    plan_editor = getattr(ctx, "plan_editor", None)
    if plan_editor is None:
        return
    try:
        await plan_editor.update_tool_call_message(tool_call_id, message)
    except Exception:
        _LOGGER.debug("failed to finish parse_document plan progress", exc_info=True)


def _validate_parse_document_request(ctx: ToolContext | None, file_path: str) -> str:
    if ctx is None:
        return "missing tool context"
    if not file_path:
        return "file_path is required"
    normalized = os.path.normpath(file_path)
    if normalized.startswith("..") or os.path.isabs(normalized):
        return "file_path must be relative and within the workspace directory"
    normalized_posix = Path(normalized).as_posix().lstrip("/")
    if not normalized_posix.startswith(("attachments/", "download/")):
        return (
            "parse_document only accepts current-turn attachments under attachments/ or downloaded files under download/; "
            "use read/grep for existing text or source files"
        )
    return ""


def _document_parse_message(
    file_path: str,
    full_md_path: str,
    full_text: str,
    extra_stats: list[str],
) -> str:
    stats = [f"extracted {len(full_text):,} characters", *extra_stats]
    return f"Parsed document: {file_path} ({'; '.join(stats)}; full Markdown: {full_md_path})"


def _inline_content_limit() -> int:
    configured = os.getenv("PARSE_DOCUMENT_INLINE_MAX_CHARS", "120000").strip()
    try:
        return max(1000, int(configured))
    except ValueError:
        _LOGGER.warning("invalid PARSE_DOCUMENT_INLINE_MAX_CHARS=%r; using default", configured)
        return 120000


PARSE_DOCUMENT_TOOL = FunctionTool(
    name="parse_document",
    description=(
        "Parse a current-turn attachment or downloaded document file (PDF, DOCX, PPTX, XLSX, etc.) using the "
        "configured document extractor. "
        "Returns a summary and writes the full parsed content as a markdown file (full.md) "
        "next to the original file. Use this to extract text from non-text documents under attachments/ or download/. "
        "For spreadsheets, also returns workbook_manifest with sheet names, data-row counts, headers, and scope hints. "
        "For existing text, Markdown, source, or repo files, use read/grep instead."
    ),
    input_model=ParseDocumentInput,
    func=_parse_document_func,
)
