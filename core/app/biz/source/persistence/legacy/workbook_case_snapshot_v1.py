"""Read-only discovery of legacy workbook case-source snapshots."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

LEGACY_CASE_SOURCES_DIR = "case_sources"
LEGACY_PARSED_DOCUMENTS_DIR = "parsed_documents"
CASE_ID_RE = re.compile(r"(?<![A-Z0-9])[A-Z][A-Z0-9]{1,20}-\d+(?![A-Z0-9])", re.IGNORECASE)


def extract_case_ids(text: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(match.group(0).upper() for match in CASE_ID_RE.finditer(text or "")))


def legacy_manifest_paths(workspace: Path) -> list[Path]:
    paths: list[Path] = []
    current = workspace / LEGACY_CASE_SOURCES_DIR / LEGACY_PARSED_DOCUMENTS_DIR
    if current.exists():
        paths.extend(current.glob("*.json"))
    history = workspace / "history"
    if history.exists():
        paths.extend(history.glob(f"turn-*/{LEGACY_CASE_SOURCES_DIR}/{LEGACY_PARSED_DOCUMENTS_DIR}/*.json"))
    return sorted(paths, key=lambda path: (_manifest_turn_id(path), path.name), reverse=True)


def load_legacy_manifest(path: Path) -> dict[str, Any] | None:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(loaded, dict) or int(loaded.get("schema_version") or 1) != 1:
        return None
    return loaded


def legacy_sheet_sources(workspace: Path, manifest_path: Path, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    raw_sources = manifest.get("workbook_case_sources")
    if not isinstance(raw_sources, list):
        return payloads
    for source in raw_sources:
        if not isinstance(source, dict):
            continue
        name = str(source.get("case_source_path") or "")
        source_path = manifest_path.with_name(name) if name else None
        payload = {
            "sheet_name": source.get("sheet_name"),
            "kind": source.get("kind"),
            "case_count": source.get("case_count"),
        }
        if source_path is not None and source_path.is_file():
            payload["source_ref"] = source_path.relative_to(workspace).as_posix()
        payloads.append(payload)
    return payloads


def _manifest_turn_id(path: Path) -> int:
    for parent in path.parents:
        if parent.name.startswith("turn-"):
            try:
                return int(parent.name.removeprefix("turn-"))
            except ValueError:
                return 0
    return 0
