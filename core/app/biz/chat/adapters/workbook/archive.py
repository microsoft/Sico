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

"""Workbook case-source archiving.

Persists parsed-document and workbook-attachment metadata (case IDs, per-sheet
JSONL case sources, workbook manifests) under the per-turn ``case_sources/``
directory so later turns can rediscover prior workbook context without
re-parsing the raw attachment.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any

from app.storage.fs import CHAT_FS

_LOGGER = logging.getLogger(__name__)

CASE_SOURCE_SCHEMA_VERSION = 1
CASE_SOURCES_DIR = "case_sources"
PARSED_DOCUMENTS_DIR = "parsed_documents"

CASE_ID_RE = re.compile(r"(?<![A-Z0-9])[A-Z][A-Z0-9]{1,20}-\d+(?![A-Z0-9])", re.IGNORECASE)


def extract_case_ids(text: str) -> tuple[str, ...]:
    seen: set[str] = set()
    case_ids: list[str] = []
    for match in CASE_ID_RE.finditer(text or ""):
        case_id = match.group(0).upper()
        if case_id in seen:
            continue
        seen.add(case_id)
        case_ids.append(case_id)
    return tuple(case_ids)


def archive_parsed_document_source(
    ctx: Any,
    *,
    file_path: str,
    full_markdown_path: str,
    full_text: str,
    summary: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    try:
        metadata = metadata or {}
        agent_instance_id = int(ctx.agent_instance_id or 0)
        if agent_instance_id <= 0:
            return
        target_dir = (
            CHAT_FS.get_workspace_path(agent_instance_id, ctx.username) / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
        )
        target_dir.mkdir(parents=True, exist_ok=True)
        slug = _source_slug(file_path)
        archived_text = _archived_text(full_text)
        markdown_name = f"{slug}.md"
        (target_dir / markdown_name).write_text(archived_text, encoding="utf-8")
        workbook_case_sources = _archive_workbook_case_sources(
            target_dir,
            slug,
            metadata.get("workbook_case_sources"),
        )
        case_ids = _merged_case_ids(
            extract_case_ids(full_text),
            _case_ids_from_workbook_sources(metadata.get("workbook_case_sources")),
        )
        payload = {
            "schema_version": CASE_SOURCE_SCHEMA_VERSION,
            "source": "parse_document",
            "file_path": file_path,
            "full_markdown_path": full_markdown_path,
            "archived_markdown_path": markdown_name,
            "case_ids": case_ids,
            "summary": summary,
            "content_chars": metadata.get("content_chars", len(full_text)),
            "archived_chars": len(archived_text),
            "content_truncated": len(archived_text) < len(full_text),
            "data_rows": metadata.get("data_rows"),
            "workbook_manifest": metadata.get("workbook_manifest"),
            "workbook_case_sources": workbook_case_sources,
        }
        _write_json_atomic(target_dir / f"{slug}.json", payload)
    except Exception:
        _LOGGER.debug("case_source_archive_failed file_path=%s", file_path, exc_info=True)
        return


def archive_workbook_attachment_source(
    *,
    agent_instance_id: int,
    username: str,
    file_path: str,
    data_rows: int,
    workbook_manifest: dict[str, Any],
    workbook_case_sources: list[dict[str, Any]],
) -> None:
    try:
        if agent_instance_id <= 0 or not workbook_manifest:
            return
        target_dir = CHAT_FS.get_workspace_path(agent_instance_id, username) / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
        target_dir.mkdir(parents=True, exist_ok=True)
        slug = _source_slug(file_path)
        workbook_sources = _archive_workbook_case_sources(target_dir, slug, workbook_case_sources)
        case_ids = _case_ids_from_workbook_sources(workbook_case_sources)
        payload = {
            "schema_version": CASE_SOURCE_SCHEMA_VERSION,
            "source": "workbook_attachment",
            "file_path": file_path,
            "full_markdown_path": "",
            "archived_markdown_path": "",
            "case_ids": case_ids,
            "summary": "Workbook attachment indexed into structured case sources during workspace initialization.",
            "content_chars": 0,
            "archived_chars": 0,
            "content_truncated": False,
            "data_rows": data_rows,
            "workbook_manifest": workbook_manifest,
            "workbook_case_sources": workbook_sources,
        }
        _write_json_atomic(target_dir / f"{slug}.json", payload)
    except Exception:
        _LOGGER.debug("workbook_attachment_archive_failed file_path=%s", file_path, exc_info=True)


def _archive_workbook_case_sources(target_dir: Path, slug: str, raw_sources: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_sources, list):
        return []
    archived: list[dict[str, Any]] = []
    for source_index, source in enumerate(raw_sources, start=1):
        if not isinstance(source, dict):
            continue
        sheet_name = str(source.get("sheet_name") or "").strip()
        cases = source.get("cases")
        if not sheet_name or not isinstance(cases, list):
            continue
        source_name = f"{slug}__sheet_{source_index:03d}_{_safe_slug(sheet_name)}_{_short_digest(sheet_name)}.jsonl"
        source_path = target_dir / source_name
        with source_path.open("w", encoding="utf-8") as case_file:
            for case in cases:
                if isinstance(case, dict):
                    case_file.write(json.dumps(case, ensure_ascii=False) + "\n")
        archived.append(
            {
                "sheet_name": sheet_name,
                "kind": source.get("kind") or "data",
                "headers": source.get("headers") or [],
                "case_count": len([case for case in cases if isinstance(case, dict)]),
                "case_source_path": source_name,
            }
        )
    return archived


def _source_slug(file_path: str) -> str:
    name = Path(file_path).name or "document"
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", name).strip("._") or "document"
    digest = hashlib.sha1(file_path.encode("utf-8", errors="ignore")).hexdigest()[:10]
    return f"{stem}-{digest}"


def _safe_slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("._") or "sheet"


def _short_digest(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8", errors="ignore")).hexdigest()[:8]


def _case_ids_from_workbook_sources(raw_sources: Any) -> list[str]:
    if not isinstance(raw_sources, list):
        return []
    case_ids: list[str] = []
    seen: set[str] = set()
    for source in raw_sources:
        if not isinstance(source, dict):
            continue
        cases = source.get("cases")
        if not isinstance(cases, list):
            continue
        for case in cases:
            if not isinstance(case, dict):
                continue
            case_id = str(case.get("case_id") or "").strip().upper()
            if case_id and case_id not in seen:
                seen.add(case_id)
                case_ids.append(case_id)
    return case_ids


def _merged_case_ids(*groups: Any) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for value in group or []:
            case_id = str(value or "").strip().upper()
            if case_id and case_id not in seen:
                seen.add(case_id)
                merged.append(case_id)
    return merged


def _archived_text(full_text: str) -> str:
    return full_text[: _archive_max_chars()]


def _archive_max_chars() -> int:
    configured = os.getenv("CASE_SOURCE_ARCHIVE_MAX_CHARS", "500000").strip()
    try:
        return max(10000, int(configured))
    except ValueError:
        return 500000


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    tmp_path = path.with_suffix(path.suffix + f".{uuid.uuid4().hex}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)
