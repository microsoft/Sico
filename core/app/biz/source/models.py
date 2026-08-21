"""Canonical source manifests and typed tabular snapshots."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any


def normalize_header(value: str) -> str:
    text = unicodedata.normalize("NFKC", value).strip().casefold()
    return re.sub(r"[^\w]+", "_", text, flags=re.UNICODE).strip("_")


def canonical_case_id(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def canonical_case_id_pairs(values: Iterable[str]) -> tuple[tuple[str, str], ...]:
    selected: dict[str, str] = {}
    for value in values:
        display = value.strip()
        key = canonical_case_id(display)
        if key and key not in selected:
            selected[key] = display
    return tuple(selected.items())


def source_occurrence_id(content_hash: str, source_ref: str) -> str:
    digest = hashlib.sha256()
    digest.update(content_hash.encode("ascii"))
    digest.update(b"\0")
    digest.update(source_ref.replace("\\", "/").strip().lstrip("/").encode("utf-8"))
    return digest.hexdigest()[:16]


def table_id_for_source(source_id: str, sheet_name: str) -> str:
    sheet_digest = hashlib.sha256(sheet_name.encode("utf-8")).hexdigest()[:8]
    return f"{source_id}:{sheet_digest}"


@dataclass(frozen=True, slots=True)
class SourceAccessContext:
    username: str
    agent_instance_id: int
    conversation_id: int = 0


@dataclass(frozen=True, slots=True)
class TabularRow:
    source_row: int
    data_row_index: int
    values: Mapping[str, Any]
    display_values: Mapping[str, str]


@dataclass(frozen=True, slots=True)
class TabularSheet:
    table_id: str
    name: str
    index: int
    headers: tuple[str, ...]
    rows: tuple[TabularRow, ...]
    normalized_headers: Mapping[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TabularDocument:
    source_ref: str
    source_id: str
    file_name: str
    format: str
    sheets: tuple[TabularSheet, ...]
    materialized_ref: str = ""


@dataclass(frozen=True, slots=True)
class NormalizedRow:
    source_ref: str
    source_id: str
    table_id: str
    sheet_name: str
    source_row: int
    data_row_index: int
    title: str
    goal: str
    case_id: str
    values: Mapping[str, Any]
    display_values: Mapping[str, str]
    normalizer_id: str
    materialized_ref: str = ""


@dataclass(frozen=True, slots=True)
class SheetManifest:
    sheet_id: str
    name: str
    index: int
    kind: str
    semantic_kind: str
    headers: tuple[str, ...]
    data_rows: int
    case_ids: tuple[str, ...]
    snapshot_path: str


@dataclass(frozen=True, slots=True)
class SourceManifest:
    source_id: str
    source_ref: str
    content_hash: str
    parser_version: int
    file_name: str
    format: str
    size_bytes: int
    sheets: tuple[SheetManifest, ...]
    case_ids: tuple[str, ...]
    runnable_sheet_ids: tuple[str, ...]
    requires_scope_selection: bool
    summary: str = ""
    content_chars: int = 0
    object_path: str = ""


@dataclass(frozen=True, slots=True)
class TabularScope:
    sheet_names: tuple[str, ...] = ()
    row_start: int | None = None
    row_end: int | None = None
    case_ids: tuple[str, ...] = ()
