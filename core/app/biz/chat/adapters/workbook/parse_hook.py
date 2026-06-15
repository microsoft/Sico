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

"""Workbook-aware ``parse_document`` hook.

Registered automatically when the workbook adapter package is imported. When a
parsed document is a supported workbook, this hook:

* extracts the workbook manifest and per-sheet case sources,
* archives them so future turns can rediscover the structured data, and
* enriches the ``parse_document`` response with ``workbook_manifest`` plus
  workbook-specific message stats.

For non-workbook documents the hook still archives the parsed text and any
case IDs found inside, so generic case-ID lookups continue to work.
"""

from __future__ import annotations

from typing import Any

from app.tools.parse_document_hooks import (
    ParseDocumentExtras,
    ParseDocumentHookContext,
    register_post_parse_hook,
)

from .archive import archive_parsed_document_source
from .workbook_cases import workbook_case_sources, workbook_manifest


def _workbook_parse_hook(context: ParseDocumentHookContext) -> ParseDocumentExtras | None:
    manifest = workbook_manifest(context.abs_path)
    sources = workbook_case_sources(context.abs_path, manifest) if manifest is not None else []
    data_rows = _runnable_data_rows(manifest) if manifest is not None else None

    archive_parsed_document_source(
        context.ctx,
        file_path=context.file_path,
        full_markdown_path=context.full_markdown_path,
        full_text=context.full_text,
        summary=context.summary,
        metadata={
            "content_chars": len(context.full_text),
            "data_rows": data_rows,
            "workbook_manifest": manifest,
            "workbook_case_sources": sources,
        },
    )

    if manifest is None:
        return None

    stats: list[str] = []
    if data_rows is not None:
        stats.append(f"detected {data_rows:,} runnable data rows")
    stats.append(_workbook_manifest_message(manifest))
    return ParseDocumentExtras(
        response_fields={"workbook_manifest": manifest},
        message_stats=stats,
    )


def _runnable_data_rows(manifest: dict[str, Any]) -> int:
    if "runnable_data_rows" in manifest:
        return int(manifest.get("runnable_data_rows") or 0)
    return int(manifest.get("total_data_rows") or 0)


def _workbook_manifest_message(manifest: dict[str, Any]) -> str:
    sheets = manifest.get("sheets") or []
    parts: list[str] = []
    for sheet in sheets[:8]:
        if not isinstance(sheet, dict):
            continue
        name = str(sheet.get("name") or "")
        kind = str(sheet.get("kind") or "")
        rows = int(sheet.get("data_rows") or 0)
        parts.append(f"{name} ({rows:,} data rows, {kind})")
    if len(sheets) > len(parts):
        parts.append(f"+{len(sheets) - len(parts)} more")
    return "workbook sheets: " + "; ".join(parts)


register_post_parse_hook(_workbook_parse_hook)
