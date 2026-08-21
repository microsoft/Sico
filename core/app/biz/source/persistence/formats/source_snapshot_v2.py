"""Version 2 source-snapshot JSON codec."""

from __future__ import annotations

import json
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

from ...models import SheetManifest, SourceManifest, TabularDocument, TabularRow, TabularSheet, normalize_header
from ...tabular.reader import display_value

SCHEMA_VERSION = 2
PARSER_VERSION = 1


def manifest_payload(manifest: SourceManifest) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "source_id": manifest.source_id,
        "source_ref": manifest.source_ref,
        "content_hash": manifest.content_hash,
        "parser_version": manifest.parser_version,
        "file_name": manifest.file_name,
        "format": manifest.format,
        "size_bytes": manifest.size_bytes,
        "case_ids": list(manifest.case_ids),
        "summary": manifest.summary,
        "content_chars": manifest.content_chars,
        "object_path": manifest.object_path,
        "runnable_sheet_ids": list(manifest.runnable_sheet_ids),
        "requires_scope_selection": manifest.requires_scope_selection,
        "sheets": [
            {
                "sheet_id": sheet.sheet_id,
                "name": sheet.name,
                "index": sheet.index,
                "kind": sheet.kind,
                "semantic_kind": sheet.semantic_kind,
                "headers": list(sheet.headers),
                "data_rows": sheet.data_rows,
                "case_ids": list(sheet.case_ids),
                "snapshot_path": sheet.snapshot_path,
            }
            for sheet in manifest.sheets
        ],
    }


def manifest_from_payload(payload: dict[str, Any]) -> SourceManifest:
    if int(payload.get("schema_version") or 0) != SCHEMA_VERSION:
        raise ValueError("unsupported source snapshot schema")
    return SourceManifest(
        source_id=str(payload["source_id"]),
        source_ref=str(payload["source_ref"]),
        content_hash=str(payload["content_hash"]),
        parser_version=int(payload["parser_version"]),
        file_name=str(payload["file_name"]),
        format=str(payload["format"]),
        size_bytes=int(payload["size_bytes"]),
        sheets=tuple(
            SheetManifest(
                sheet_id=str(sheet["sheet_id"]),
                name=str(sheet["name"]),
                index=int(sheet["index"]),
                kind=str(sheet["kind"]),
                semantic_kind=str(sheet["semantic_kind"]),
                headers=tuple(str(header) for header in sheet.get("headers", ())),
                data_rows=int(sheet["data_rows"]),
                case_ids=tuple(str(value) for value in sheet.get("case_ids", ())),
                snapshot_path=str(sheet["snapshot_path"]),
            )
            for sheet in payload.get("sheets", ())
            if isinstance(sheet, dict)
        ),
        case_ids=tuple(str(value) for value in payload.get("case_ids", ())),
        runnable_sheet_ids=tuple(str(value) for value in payload.get("runnable_sheet_ids", ())),
        requires_scope_selection=bool(payload.get("requires_scope_selection")),
        summary=str(payload.get("summary") or ""),
        content_chars=int(payload.get("content_chars") or 0),
        object_path=str(payload.get("object_path") or ""),
    )


def row_payload(row: TabularRow) -> dict[str, Any]:
    return {
        "source_row": row.source_row,
        "data_row_index": row.data_row_index,
        "values": {header: _encode_value(value) for header, value in row.values.items()},
    }


def row_from_payload(payload: dict[str, Any], headers: tuple[str, ...]) -> TabularRow:
    raw_values = payload.get("values") if isinstance(payload.get("values"), dict) else {}
    values = {header: _decode_value(raw_values.get(header)) for header in headers}
    return TabularRow(
        source_row=int(payload["source_row"]),
        data_row_index=int(payload["data_row_index"]),
        values=values,
        display_values={header: display_value(value) for header, value in values.items()},
    )


def document_from_snapshot(root: Path, manifest: SourceManifest, selected: tuple[SheetManifest, ...]) -> TabularDocument:
    sheets: list[TabularSheet] = []
    for sheet in selected:
        snapshot_path = _safe_snapshot_path(root, sheet.snapshot_path)
        with snapshot_path.open("r", encoding="utf-8") as stream:
            rows = tuple(
                row_from_payload(json.loads(line), sheet.headers)
                for line in stream
                if line.strip()
            )
        sheets.append(
            TabularSheet(
                table_id=sheet.sheet_id,
                name=sheet.name,
                index=sheet.index,
                headers=sheet.headers,
                rows=rows,
                normalized_headers=_normalized_headers(sheet.headers),
            )
        )
    return TabularDocument(
        source_ref=manifest.source_ref,
        source_id=manifest.source_id,
        file_name=manifest.file_name,
        format=manifest.format,
        sheets=tuple(sheets),
        materialized_ref="",
    )


def _safe_snapshot_path(root: Path, relative: str) -> Path:
    normalized = relative.replace("\\", "/").strip().lstrip("/")
    candidate = (root / normalized).resolve()
    if not normalized or not candidate.is_relative_to(root.resolve()):
        raise ValueError(f"source snapshot path escapes root: {relative}")
    return candidate


def _normalized_headers(headers: tuple[str, ...]) -> dict[str, tuple[str, ...]]:
    grouped: dict[str, list[str]] = {}
    for header in headers:
        grouped.setdefault(normalize_header(header), []).append(header)
    return {key: tuple(values) for key, values in grouped.items() if key}


def _encode_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"$type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"$type": "date", "value": value.isoformat()}
    if isinstance(value, time):
        return {"$type": "time", "value": value.isoformat()}
    if isinstance(value, (dict, list)):
        return {"$type": "json", "value": value}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return {"$type": "string", "value": str(value)}


def _decode_value(value: Any) -> Any:
    if not isinstance(value, dict) or "$type" not in value:
        return value
    kind = value.get("$type")
    raw = str(value.get("value") or "")
    if kind == "datetime":
        return datetime.fromisoformat(raw)
    if kind == "date":
        return date.fromisoformat(raw)
    if kind == "time":
        return time.fromisoformat(raw)
    if kind == "json":
        return value.get("value")
    return raw
