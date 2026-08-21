"""Compatibility and prompt projections over source manifests."""

from __future__ import annotations

from typing import Any

from .models import SourceManifest

_MAX_PROMPT_SHEETS = 50
_MAX_PROMPT_HEADERS = 50
_MAX_PROMPT_CASE_IDS = 20
_MAX_PROMPT_SUMMARY_CHARS = 1_200


def workbook_manifest_payload(manifest: SourceManifest) -> dict[str, Any]:
    sheets = [
        {
            "name": sheet.name,
            "kind": sheet.kind,
            "non_empty_rows": sheet.data_rows + (1 if sheet.headers else 0),
            "data_rows": sheet.data_rows,
            "headers": list(sheet.headers[:12]),
        }
        for sheet in manifest.sheets
    ]
    data_sheets = [sheet for sheet in manifest.sheets if sheet.kind == "data"]
    master_sheets = [sheet for sheet in manifest.sheets if sheet.kind == "master"]
    summary_sheets = [sheet for sheet in manifest.sheets if sheet.kind == "summary"]
    executable = [sheet for sheet in manifest.sheets if sheet.kind in {"data", "master"} and sheet.data_rows > 0]
    source_data_rows = sum(sheet.data_rows for sheet in data_sheets)
    master_data_rows = sum(sheet.data_rows for sheet in master_sheets)
    return {
        "type": "workbook",
        "sheet_count": len(manifest.sheets),
        "total_data_rows": sum(sheet.data_rows for sheet in manifest.sheets),
        "runnable_data_rows": source_data_rows if source_data_rows > 0 else master_data_rows,
        "source_data_rows": source_data_rows,
        "master_data_rows": master_data_rows,
        "summary_data_rows": sum(sheet.data_rows for sheet in summary_sheets),
        "data_sheet_count": len(data_sheets),
        "executable_sheet_count": len(executable),
        "multiple_data_sheets": len(data_sheets) > 1,
        "requires_scope_selection": len(executable) > 1,
        "contains_master_sheet": bool(master_sheets),
        "sheets": sheets,
        "scope_confirmation_hint": _scope_confirmation_hint(executable),
    }


def compact_manifest_payload(manifest: SourceManifest) -> dict[str, Any]:
    sheets = manifest.sheets[:_MAX_PROMPT_SHEETS]
    runnable_sheet_ids = set(manifest.runnable_sheet_ids)
    return {
        "source_ref": manifest.source_ref,
        "format": manifest.format,
        "requires_scope_selection": manifest.requires_scope_selection,
        "summary": _truncate(manifest.summary, _MAX_PROMPT_SUMMARY_CHARS),
        "content_chars": manifest.content_chars,
        "sheet_count": len(manifest.sheets),
        "omitted_sheet_count": len(manifest.sheets) - len(sheets),
        "sheets": [
            {
                "name": sheet.name,
                "kind": sheet.kind,
                "semantic_kind": sheet.semantic_kind,
                "runnable": sheet.sheet_id in runnable_sheet_ids,
                "data_rows": sheet.data_rows,
                "case_id_count": len(sheet.case_ids),
                "case_ids": list(sheet.case_ids[:_MAX_PROMPT_CASE_IDS]),
                "omitted_case_id_count": max(0, len(sheet.case_ids) - _MAX_PROMPT_CASE_IDS),
                "header_count": len(sheet.headers),
                "headers": list(sheet.headers[:_MAX_PROMPT_HEADERS]),
                "omitted_header_count": max(0, len(sheet.headers) - _MAX_PROMPT_HEADERS),
            }
            for sheet in sheets
        ],
    }


def _truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[:limit].rstrip() + "..."


def _scope_confirmation_hint(executable_sheets) -> str:
    if len(executable_sheets) <= 1:
        return ""
    return (
        "Workbook has multiple runnable sheets; ask the user which sheet(s), row range, or case IDs to execute before "
        "delegation."
    )
