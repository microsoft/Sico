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

from __future__ import annotations

import contextlib
import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .manifests import prior_case_source_manifest_paths
from .workbook_cases import (
    SUPPORTED_WORKBOOK_SUFFIXES,
    dedupe_cases_by_case_id,
    extract_workbook_cases,
    filter_cases,
)
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext

_LOGGER = logging.getLogger(__name__)

# Cap on the number of workbook cases a single adapter call may expand into
# delegated tasks.
WORKBOOK_CASES_MAX = 500

class ExtractWorkbookCasesInput(BaseModel):
    source_path: str = Field(
        default="",
        description="Optional structured JSONL case source path from prior parsed workbook sources.",
    )
    file_path: str = Field(
        default="",
        description=(
            "Optional workbook path or file name. Use attachments/name.xlsx or attachments/name.csv for current uploads, "
            "or a prior file name."
        ),
    )
    sheet_name: str = Field(default="", description="Optional workbook sheet/tab name to extract, e.g. rewritten_userdata.")
    row_start: int | None = Field(default=None, description="Optional 1-based data-row start within the selected sheet.")
    row_end: int | None = Field(default=None, description="Optional 1-based data-row end within the selected sheet.")
    case_ids: list[str] = Field(default_factory=list, description="Optional exact case IDs to extract.")
    max_cases: int = Field(
        default=WORKBOOK_CASES_MAX,
        ge=1,
        le=WORKBOOK_CASES_MAX,
        description="Maximum cases to return; choose a narrower scope if exceeded.",
    )


def extract_workbook_cases_for_request(ctx: ToolContext, request: ExtractWorkbookCasesInput) -> dict[str, Any]:
    if request.source_path:
        return _extract_case_source_path(ctx, request)
    current_path = _resolve_current_workbook(ctx, request.file_path)
    if current_path is not None:
        result = extract_workbook_cases(
            current_path,
            sheet_name=request.sheet_name,
            row_start=request.row_start,
            row_end=request.row_end,
            case_ids=request.case_ids,
            max_cases=request.max_cases,
        )
        result["source"] = "current_attachment"
        result["source_path"] = _workspace_relative(ctx, current_path)
        return result
    return _extract_history_cases(ctx, request)


def _extract_case_source_path(ctx: ToolContext, request: ExtractWorkbookCasesInput) -> dict[str, Any]:
    source_path = _resolve_structured_case_source(ctx, request.source_path)
    if source_path is None:
        return {"error_message": f"structured case source not found: {request.source_path}", "cases": []}
    cases = _read_case_source(source_path)
    cases = _filter_cases_by_sheet(cases, request.sheet_name)
    cases = filter_cases(cases, row_start=request.row_start, row_end=request.row_end, case_ids=request.case_ids)
    cases = dedupe_cases_by_case_id(cases, request.case_ids)
    missing_case_ids = _missing_case_ids(cases, request.case_ids)
    if missing_case_ids:
        return {"error_message": f"no cases matched case_ids: {', '.join(missing_case_ids)}", "cases": []}
    if not cases:
        return {"error_message": "no cases matched the selected scope", "cases": []}
    if len(cases) > request.max_cases:
        return {
            "error_message": f"selected {len(cases)} cases exceeds max_cases={request.max_cases}; choose a narrower scope",
            "cases": [],
        }
    selected_sheets = _selected_sheet_names(cases)
    return {
        "error_message": "",
        "source": "structured_case_source",
        "source_path": _workspace_relative(ctx, source_path),
        "selected_sheets": selected_sheets,
        "case_count": len(cases),
        "cases": cases,
        "available_sheets": [],
    }


def _resolve_structured_case_source(ctx: ToolContext, source_path: str) -> Path | None:
    workspace = CHAT_FS.get_workspace_path(ctx.agent_instance_id or 0, ctx.username)
    normalized = source_path.replace("\\", "/").strip().lstrip("/")
    if not normalized:
        return None
    candidate = (workspace / normalized).resolve()
    workspace_root = workspace.resolve()
    with contextlib.suppress(ValueError):
        candidate.relative_to(workspace_root)
        if candidate.exists() and candidate.suffix.lower() == ".jsonl":
            return candidate
    return None


def _extract_history_cases(ctx: ToolContext, request: ExtractWorkbookCasesInput) -> dict[str, Any]:
    workspace = CHAT_FS.get_workspace_path(ctx.agent_instance_id or 0, ctx.username)
    candidates = _history_workbook_candidates(workspace, request.file_path, request.sheet_name)
    if not candidates:
        return {
            "error_message": "no matching current or prior parsed workbook source found",
            "cases": [],
            "available_sources": _available_history_sources(workspace),
        }
    selected = _select_history_cases(candidates, request)
    if selected["error_message"]:
        return {**selected, "available_sources": _available_history_sources(workspace)}
    candidate = selected["candidate"]
    cases = selected["cases"]
    if len(cases) > request.max_cases:
        return {
            "error_message": f"selected {len(cases)} cases exceeds max_cases={request.max_cases}; choose a narrower scope",
            "cases": [],
            "available_sources": _available_history_sources(workspace),
        }
    return {
        "error_message": "",
        "source": "prior_parsed_workbook",
        "source_path": candidate["case_source_rel_path"],
        "file_path": candidate["file_path"],
        "selected_sheets": candidate.get("selected_sheets") or [candidate["sheet_name"]],
        "case_count": len(cases),
        "cases": cases,
        "available_sheets": candidate.get("available_sheets") or [],
    }


def _resolve_current_workbook(ctx: ToolContext, file_path: str) -> Path | None:
    workspace = CHAT_FS.get_workspace_path(ctx.agent_instance_id or 0, ctx.username)
    normalized = file_path.replace("\\", "/").strip().lstrip("/")
    candidate_paths: list[Path] = []
    if normalized:
        candidate_paths.append((workspace / normalized).resolve())
        candidate_paths.extend(_attachment_paths_by_name(workspace, normalized))
    else:
        attachments_dir = workspace / "attachments"
        discovered: list[Path] = []
        for entry in attachments_dir.glob("*"):
            if entry.is_file() and entry.suffix.lower() in SUPPORTED_WORKBOOK_SUFFIXES:
                discovered.append(entry)
        candidate_paths.extend(sorted(discovered))
    workspace_root = workspace.resolve()
    for candidate in candidate_paths:
        with contextlib.suppress(ValueError):
            candidate.relative_to(workspace_root)
            if candidate.exists() and candidate.suffix.lower() in SUPPORTED_WORKBOOK_SUFFIXES:
                return candidate
    return None


def _attachment_paths_by_name(workspace: Path, name_or_path: str) -> list[Path]:
    index = _load_json(workspace / "attachments" / "index.json")
    wanted_name = Path(name_or_path).name.lower()
    paths: list[Path] = []
    if isinstance(index, list):
        for item in index:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            path = str(item.get("path") or "")
            if name.lower() == wanted_name or Path(path).name.lower() == wanted_name:
                paths.append((workspace / path).resolve())
    fallback = workspace / "attachments" / Path(name_or_path).name
    paths.append(fallback.resolve())
    return paths


def _history_workbook_candidates(workspace: Path, file_path: str, sheet_name: str) -> list[dict[str, Any]]:
    history_dir = workspace / "history"
    if not history_dir.exists():
        return []
    wanted_file = Path(file_path).name.lower() if file_path else ""
    wanted_sheet = _normalize_name(sheet_name)
    candidates: list[dict[str, Any]] = []
    for manifest_path in prior_case_source_manifest_paths(workspace):
        loaded = _load_json(manifest_path)
        if not isinstance(loaded, dict):
            continue
        original_file = str(loaded.get("file_path") or "")
        if wanted_file and Path(original_file).name.lower() != wanted_file:
            continue
        available_sheets = _manifest_sheet_summaries(loaded)
        for source in loaded.get("workbook_case_sources") or []:
            if not isinstance(source, dict):
                continue
            source_sheet = str(source.get("sheet_name") or "")
            if wanted_sheet and _normalize_name(source_sheet) != wanted_sheet:
                continue
            source_name = str(source.get("case_source_path") or "")
            case_source_path = manifest_path.with_name(source_name) if source_name else None
            if case_source_path is None or not case_source_path.exists():
                continue
            candidates.append(
                {
                    "file_path": original_file,
                    "sheet_name": source_sheet,
                    "manifest_path": manifest_path,
                    "case_source_path": case_source_path,
                    "case_source_rel_path": case_source_path.relative_to(workspace).as_posix(),
                    "available_sheets": available_sheets,
                }
            )
    return candidates


def _available_history_sources(workspace: Path) -> list[dict[str, Any]]:
    history_dir = workspace / "history"
    if not history_dir.exists():
        return []
    sources: list[dict[str, Any]] = []
    for manifest_path in prior_case_source_manifest_paths(workspace):
        loaded = _load_json(manifest_path)
        if not isinstance(loaded, dict) or not loaded.get("workbook_case_sources"):
            continue
        sources.append(
            {
                "file_path": loaded.get("file_path"),
                "manifest_path": manifest_path.relative_to(workspace).as_posix(),
                "sheets": _manifest_sheet_summaries(loaded),
            }
        )
    return sources[:5]


def _manifest_sheet_summaries(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    workbook_manifest = manifest.get("workbook_manifest")
    if not isinstance(workbook_manifest, dict):
        return []
    summaries: list[dict[str, Any]] = []
    for sheet in workbook_manifest.get("sheets") or []:
        if isinstance(sheet, dict):
            summaries.append(
                {
                    "name": sheet.get("name"),
                    "kind": sheet.get("kind"),
                    "data_rows": sheet.get("data_rows"),
                }
            )
    return summaries


def _read_case_source(path: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    try:
        case_file = path.open("r", encoding="utf-8")
    except OSError:
        _LOGGER.warning("case source read failed path=%s", path, exc_info=True)
        return cases
    with case_file:
        for line_number, line in enumerate(case_file, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                loaded = json.loads(line)
            except json.JSONDecodeError:
                _LOGGER.warning("invalid case source jsonl path=%s line=%s", path, line_number, exc_info=True)
                continue
            if isinstance(loaded, dict):
                cases.append(loaded)
    return cases


def _select_history_cases(candidates: list[dict[str, Any]], request: ExtractWorkbookCasesInput) -> dict[str, Any]:
    if request.case_ids:
        return _select_history_cases_by_id(candidates, request)
    for candidate in candidates:
        cases = _read_case_source(candidate["case_source_path"])
        filtered = filter_cases(cases, row_start=request.row_start, row_end=request.row_end, case_ids=request.case_ids)
        if filtered:
            return {"error_message": "", "candidate": candidate, "cases": filtered}
    return {"error_message": "no cases matched the selected scope", "cases": []}


def _select_history_cases_by_id(candidates: list[dict[str, Any]], request: ExtractWorkbookCasesInput) -> dict[str, Any]:
    partial_missing: list[str] = []
    for group in _candidate_groups(candidates):
        selected_cases: list[dict[str, Any]] = []
        selected_sheets: list[str] = []
        for candidate in group:
            cases = _read_case_source(candidate["case_source_path"])
            filtered = filter_cases(cases, row_start=request.row_start, row_end=request.row_end, case_ids=request.case_ids)
            selected_cases.extend(filtered)
            sheet_name = str(candidate.get("sheet_name") or "")
            if filtered and sheet_name and sheet_name not in selected_sheets:
                selected_sheets.append(sheet_name)
        selected_cases = dedupe_cases_by_case_id(selected_cases, request.case_ids)
        if not selected_cases:
            continue
        missing_ids = _missing_case_ids(selected_cases, request.case_ids)
        if missing_ids:
            partial_missing = missing_ids
            continue
        candidate = dict(group[0])
        candidate["selected_sheets"] = (
            _selected_sheet_names(selected_cases) or selected_sheets or [str(group[0].get("sheet_name") or "")]
        )
        return {"error_message": "", "candidate": candidate, "cases": selected_cases}
    if partial_missing:
        return {"error_message": f"no cases matched case_ids: {', '.join(partial_missing)}", "cases": []}
    return {"error_message": "no cases matched the selected scope", "cases": []}


def _selected_sheet_names(cases: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for case in cases:
        name = str(case.get("sheet_name") or "")
        if name and name not in names:
            names.append(name)
    return names


def _filter_cases_by_sheet(cases: list[dict[str, Any]], sheet_name: str) -> list[dict[str, Any]]:
    wanted_sheet = _normalize_name(sheet_name)
    if not wanted_sheet:
        return cases
    return [case for case in cases if _normalize_name(str(case.get("sheet_name") or "")) == wanted_sheet]


def _missing_case_ids(cases: list[dict[str, Any]], case_ids: list[str]) -> list[str]:
    wanted_ids = [_normalize_case_id(case_id) for case_id in case_ids if str(case_id).strip()]
    if not wanted_ids:
        return []
    found_ids = {_normalize_case_id(str(case.get("case_id") or "")) for case in cases}
    return [case_id for case_id in wanted_ids if case_id not in found_ids]

def _candidate_groups(candidates: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    current_key: str | None = None
    current_group: list[dict[str, Any]] = []
    for candidate in candidates:
        key = str(candidate.get("manifest_path") or candidate.get("file_path") or "")
        if current_group and key != current_key:
            groups.append(current_group)
            current_group = []
        current_key = key
        current_group.append(candidate)
    if current_group:
        groups.append(current_group)
    return groups


def _normalize_case_id(case_id: str) -> str:
    return case_id.strip().upper()


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    with contextlib.suppress(Exception):
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def _workspace_relative(ctx: ToolContext, path: Path) -> str:
    workspace = CHAT_FS.get_workspace_path(ctx.agent_instance_id or 0, ctx.username).resolve()
    with contextlib.suppress(ValueError):
        return path.resolve().relative_to(workspace).as_posix()
    return path.name


def _normalize_name(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum() or "\u4e00" <= ch <= "\u9fff")
