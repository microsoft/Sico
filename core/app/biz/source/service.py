"""Shared source inspection and scoped tabular materialization."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from app.storage.fs import CHAT_FS

from .errors import SourceError
from .models import (
    SheetManifest,
    SourceAccessContext,
    SourceManifest,
    TabularDocument,
    TabularRow,
    TabularScope,
    TabularSheet,
    canonical_case_id,
    canonical_case_id_pairs,
    source_occurrence_id,
)
from .persistence.formats.source_snapshot_v2 import PARSER_VERSION
from .persistence.repository import WorkspaceSourceRepository, source_object_path
from .tabular.normalizers import NormalizerSelector, case_id_for_row
from .tabular.reader import SUPPORTED_TABULAR_SUFFIXES, TabularReader, content_hash

RowFilter = Callable[[TabularRow], bool]
_CASE_ID_RE = re.compile(r"(?<![A-Z0-9])[A-Z][A-Z0-9]{1,20}-\d+(?![A-Z0-9])", re.IGNORECASE)


class WorkspaceSourceService:
    def __init__(self, reader: TabularReader | None = None) -> None:
        self._reader = reader or TabularReader()
        self._normalizers = NormalizerSelector()

    def index_path(self, workspace: Path, source_ref: str, path: Path) -> SourceManifest:
        digest = content_hash(path)
        repository = WorkspaceSourceRepository(workspace)
        cached = repository.find(source_ref)
        if (
            cached is not None
            and cached.content_hash == digest
            and cached.parser_version == PARSER_VERSION
            and cached.format == path.suffix.lower().lstrip(".")
            and cached.sheets
            and cached.object_path
        ):
            repository.save_object(cached, path)
            return cached
        source_id = source_occurrence_id(digest, source_ref)
        document = self._reader.read(path, source_ref, source_id)
        manifest = self._manifest(path, source_ref, digest, document)
        if cached is not None and cached.content_hash == digest:
            manifest = replace(
                manifest,
                summary=cached.summary,
                content_chars=cached.content_chars,
            )
        repository.save(manifest, document, source_path=path)
        return repository.find(source_ref) or manifest

    def index_text(
        self,
        access: SourceAccessContext,
        source_ref: str,
        path: Path,
        full_text: str,
        summary: str,
    ) -> SourceManifest:
        workspace = self._workspace(access)
        repository = WorkspaceSourceRepository(workspace)
        digest = content_hash(path)
        manifest = repository.find(source_ref)
        source_format = path.suffix.lower().lstrip(".")
        if (
            manifest is None
            or manifest.content_hash != digest
            or manifest.parser_version != PARSER_VERSION
            or manifest.format != source_format
        ):
            manifest = SourceManifest(
                source_id=source_occurrence_id(digest, source_ref),
                source_ref=source_ref,
                content_hash=digest,
                parser_version=PARSER_VERSION,
                file_name=path.name,
                format=source_format,
                size_bytes=path.stat().st_size,
                sheets=(),
                case_ids=(),
                runnable_sheet_ids=(),
                requires_scope_selection=False,
                object_path=source_object_path(digest, source_format),
            )
        repository.save_object(manifest, path)
        case_ids = tuple(
            display
            for _key, display in canonical_case_id_pairs(
                (*manifest.case_ids, *(match.group(0) for match in _CASE_ID_RE.finditer(full_text or "")))
            )
        )
        return repository.attach_text_metadata(
            SourceManifest(
                source_id=manifest.source_id,
                source_ref=manifest.source_ref,
                content_hash=manifest.content_hash,
                parser_version=manifest.parser_version,
                file_name=manifest.file_name,
                format=manifest.format,
                size_bytes=manifest.size_bytes,
                sheets=manifest.sheets,
                case_ids=case_ids,
                runnable_sheet_ids=manifest.runnable_sheet_ids,
                requires_scope_selection=manifest.requires_scope_selection,
                object_path=manifest.object_path,
            ),
            len(full_text),
            summary,
        )

    def materialize_object_ref(
        self,
        access: SourceAccessContext,
        source_ref: str,
        expected_content_hash: str = "",
    ) -> str:
        workspace = self._workspace(access)
        repository = WorkspaceSourceRepository(workspace)
        normalized_ref = source_ref.replace("\\", "/").strip().lstrip("/")
        manifest = repository.find(normalized_ref)
        if manifest is None:
            raise SourceError(
                f"source is no longer active: {source_ref}",
                code="source_ref_inactive",
                details={"source_ref": normalized_ref},
            )
        if expected_content_hash and manifest.content_hash != expected_content_hash:
            raise SourceError(
                f"source content changed since the original task: {source_ref}",
                code="source_content_changed",
                details={
                    "source_ref": normalized_ref,
                    "expected_content_hash": expected_content_hash,
                    "active_content_hash": manifest.content_hash,
                },
            )
        object_ref = repository.object_ref(manifest)
        if not object_ref:
            raise SourceError(
                f"persisted source object is unavailable: {source_ref}",
                code="source_object_unavailable",
                details={"source_ref": normalized_ref},
            )
        return object_ref

    def select(
        self,
        access: SourceAccessContext,
        source_ref: str,
        *,
        scope: TabularScope | None = None,
        max_rows: int | None = None,
        row_filter: RowFilter | None = None,
    ) -> TabularDocument:
        scope = scope or TabularScope()
        workspace = self._workspace(access)
        repository = WorkspaceSourceRepository(workspace)
        requested_ref = source_ref.replace("\\", "/").strip().lstrip("/")
        manifest = repository.find(requested_ref)
        try:
            path, relative = self._resolve(workspace, source_ref)
        except SourceError as exc:
            if exc.code != "tabular_source_not_found" or manifest is None:
                raise
            selected_names = self._resolve_sheet_names(manifest, scope)
            try:
                document = repository.load_document(manifest, selected_names)
            except (KeyError, OSError, TypeError, ValueError) as snapshot_exc:
                raise SourceError(
                    f"persisted source snapshot is unavailable: {source_ref}",
                    code="source_snapshot_unavailable",
                    details={"source_ref": requested_ref},
                ) from snapshot_exc
            materialized_ref = repository.object_ref(manifest)
            if not materialized_ref:
                raise SourceError(
                    f"persisted source object is unavailable: {source_ref}",
                    code="source_object_unavailable",
                    details={"source_ref": requested_ref},
                )
            return self._apply_scope(
                replace(document, materialized_ref=materialized_ref),
                source_ref=requested_ref,
                scope=scope,
                max_rows=max_rows,
                row_filter=row_filter,
            )
        digest = content_hash(path)
        if relative != requested_ref:
            manifest = repository.find(relative)
        if manifest is None or manifest.content_hash != digest or manifest.parser_version != PARSER_VERSION:
            manifest = self.index_path(workspace, relative, path)
        else:
            repository.save_object(manifest, path)
        selected_names = self._resolve_sheet_names(manifest, scope)
        try:
            document = repository.load_document(manifest, selected_names)
        except (KeyError, OSError, TypeError, ValueError):
            document = self._reader.read(path, relative, source_occurrence_id(digest, relative))
            manifest = self._manifest(path, relative, digest, document)
            repository.save(manifest, document, source_path=path)
            manifest = repository.find(relative) or manifest
            selected_names = self._resolve_sheet_names(manifest, scope)
            document = repository.load_document(manifest, selected_names)
        materialized_ref = repository.object_ref(manifest)
        if not materialized_ref:
            raise SourceError(
                f"persisted source object is unavailable: {source_ref}",
                code="source_object_unavailable",
                details={"source_ref": relative},
            )
        return self._apply_scope(
            replace(document, materialized_ref=materialized_ref),
            source_ref=source_ref,
            scope=scope,
            max_rows=max_rows,
            row_filter=row_filter,
        )

    @staticmethod
    def _apply_scope(
        document: TabularDocument,
        *,
        source_ref: str,
        scope: TabularScope,
        max_rows: int | None,
        row_filter: RowFilter | None,
    ) -> TabularDocument:
        selected_count = 0
        wanted_cases = {canonical_case_id(case_id) for case_id in scope.case_ids if case_id.strip()}
        sheets: list[TabularSheet] = []
        for sheet in document.sheets:
            rows: list[TabularRow] = []
            for row in sheet.rows:
                if scope.row_start is not None and row.data_row_index < scope.row_start:
                    continue
                if scope.row_end is not None and row.data_row_index > scope.row_end:
                    continue
                if wanted_cases and canonical_case_id(case_id_for_row(row)) not in wanted_cases:
                    continue
                if row_filter is not None and not row_filter(row):
                    continue
                if max_rows is not None and selected_count >= max_rows:
                    raise SourceError(
                        f"selected tabular rows exceed max_rows={max_rows}",
                        code="tabular_row_limit",
                        details={"selected_rows": selected_count + 1, "max_rows": max_rows},
                    )
                selected_count += 1
                rows.append(row)
            sheets.append(
                TabularSheet(
                    table_id=sheet.table_id,
                    name=sheet.name,
                    index=sheet.index,
                    headers=sheet.headers,
                    rows=tuple(rows),
                    normalized_headers=sheet.normalized_headers,
                )
            )
        non_empty = tuple(sheet for sheet in sheets if sheet.rows)
        if not non_empty and row_filter is None:
            raise SourceError(
                "no tabular rows matched the selected source scope",
                code="tabular_no_rows",
                details={"source_ref": source_ref, "sheet_names": list(scope.sheet_names)},
            )
        return TabularDocument(
            source_ref=document.source_ref,
            source_id=document.source_id,
            file_name=document.file_name,
            format=document.format,
            sheets=non_empty if non_empty else tuple(sheets),
            materialized_ref=document.materialized_ref,
        )

    def _manifest(
        self,
        path: Path,
        source_ref: str,
        digest: str,
        document: TabularDocument,
    ) -> SourceManifest:
        sheet_manifests: list[SheetManifest] = []
        normalized_by_table = {
            sheet.table_id: self._normalizers.select(sheet).normalize(document, sheet)
            for sheet in document.sheets
        }
        for sheet in document.sheets:
            kind = _classify_sheet(sheet.name, sheet.headers, len(sheet.rows))
            semantic_kind = self._normalizers.select(sheet).normalizer_id
            sheet_case_ids = _dedupe_case_ids(row.case_id for row in normalized_by_table[sheet.table_id])
            sheet_manifests.append(
                SheetManifest(
                    sheet_id=sheet.table_id,
                    name=sheet.name,
                    index=sheet.index,
                    kind=kind,
                    semantic_kind=semantic_kind,
                    headers=sheet.headers,
                    data_rows=len(sheet.rows),
                    case_ids=sheet_case_ids,
                    snapshot_path=f"tables/{sheet.table_id.rsplit(':', 1)[-1]}.jsonl",
                )
            )
        data_sheets = [sheet for sheet in sheet_manifests if sheet.kind == "data" and sheet.data_rows > 0]
        master_sheets = [sheet for sheet in sheet_manifests if sheet.kind == "master" and sheet.data_rows > 0]
        executable = data_sheets or master_sheets
        case_ids: list[str] = []
        seen_case_ids: set[str] = set()
        for sheet in document.sheets:
            for row in normalized_by_table[sheet.table_id]:
                case_id = row.case_id.strip()
                key = canonical_case_id(case_id)
                if key and key not in seen_case_ids:
                    seen_case_ids.add(key)
                    case_ids.append(case_id)
        return SourceManifest(
            source_id=document.source_id,
            source_ref=source_ref,
            content_hash=digest,
            parser_version=PARSER_VERSION,
            file_name=path.name,
            format=document.format,
            size_bytes=path.stat().st_size,
            sheets=tuple(sheet_manifests),
            case_ids=tuple(case_ids),
            runnable_sheet_ids=tuple(sheet.sheet_id for sheet in executable),
            requires_scope_selection=len(executable) > 1,
            object_path=source_object_path(digest, document.format),
        )

    def _resolve_sheet_names(
        self,
        manifest: SourceManifest,
        scope: TabularScope,
    ) -> tuple[str, ...]:
        cleaned = tuple(name.strip().casefold() for name in scope.sheet_names if name.strip())
        available = [sheet.name for sheet in manifest.sheets]
        if not cleaned:
            wanted_pairs = canonical_case_id_pairs(scope.case_ids)
            wanted_cases = tuple(key for key, _display in wanted_pairs)
            wanted_display = {key: display for key, display in wanted_pairs}
            runnable = [sheet for sheet in manifest.sheets if sheet.sheet_id in manifest.runnable_sheet_ids]
            if wanted_cases:
                matches_by_case = {
                    case_id: [
                        sheet
                        for sheet in runnable
                        if case_id in {canonical_case_id(value) for value in sheet.case_ids}
                    ]
                    for case_id in wanted_cases
                }
                ambiguous = [
                    wanted_display[case_id]
                    for case_id in wanted_cases
                    if len(matches_by_case[case_id]) > 1
                ]
                if ambiguous:
                    raise SourceError(
                        "requested case IDs occur in multiple runnable sheets; select sheet_names explicitly",
                        code="tabular_sheet_scope_required",
                        details={
                            "source_ref": manifest.source_ref,
                            "available": available,
                            "runnable": [sheet.name for sheet in runnable],
                            "ambiguous_case_ids": ambiguous,
                        },
                    )
                matched_ids = {sheet.sheet_id for matches in matches_by_case.values() for sheet in matches}
                if matched_ids:
                    return tuple(sheet.name.casefold() for sheet in runnable if sheet.sheet_id in matched_ids)
            if len(runnable) == 1:
                return (runnable[0].name.casefold(),)
            if len(manifest.sheets) == 1:
                return (manifest.sheets[0].name.casefold(),)
            raise SourceError(
                "tabular document contains multiple runnable sheets; select sheet_names explicitly",
                code="tabular_sheet_scope_required",
                details={
                    "source_ref": manifest.source_ref,
                    "available": available,
                    "runnable": [sheet.name for sheet in runnable],
                },
            )
        selected = tuple(sheet.name.casefold() for sheet in manifest.sheets if not cleaned or sheet.name.casefold() in cleaned)
        if missing := sorted(set(cleaned) - set(selected)):
            raise SourceError(
                f"sheet(s) not found: {missing}",
                code="tabular_sheet_not_found",
                details={"source_ref": manifest.source_ref, "missing": missing, "available": available},
            )
        return selected

    def _resolve(self, workspace: Path, source_ref: str) -> tuple[Path, str]:
        root = workspace.resolve()
        normalized = source_ref.replace("\\", "/").strip().lstrip("/")
        if normalized:
            candidate = (root / normalized).resolve()
            try:
                relative = candidate.relative_to(root).as_posix()
            except ValueError:
                pass
            else:
                if candidate.is_file():
                    return candidate, relative
        matches: dict[Path, str] = {}
        candidates = (
            sorted((root / "attachments").glob(f"**/{normalized}"))
            if normalized and Path(normalized).name == normalized
            else []
        )
        for candidate in candidates:
            resolved = candidate.resolve()
            try:
                relative = resolved.relative_to(root).as_posix()
            except ValueError:
                continue
            if resolved.is_file():
                matches[resolved] = relative
        if len(matches) == 1:
            return next(iter(matches.items()))
        if len(matches) > 1:
            raise SourceError(
                f"tabular source name is ambiguous: {source_ref}",
                code="tabular_source_ambiguous",
                details={"source_ref": source_ref, "candidates": sorted(matches.values())},
            )
        raise SourceError(
            f"tabular source not found: {source_ref}",
            code="tabular_source_not_found",
            details={"source_ref": source_ref},
        )

    @staticmethod
    def _workspace(access: SourceAccessContext) -> Path:
        return CHAT_FS.get_workspace_path(access.agent_instance_id, access.username, access.conversation_id)


def _classify_sheet(name: str, headers: tuple[str, ...], data_rows: int) -> str:
    if data_rows <= 0:
        return "empty"
    lowered_name = name.strip().lower()
    lowered_headers = {header.strip().lower() for header in headers if header.strip()}
    if lowered_name in {"summary", "readme", "overview"} or (lowered_headers and lowered_headers <= {"metric", "value"}):
        return "summary"
    if lowered_name in {"master", "all", "combined"} or {"source_file", "source_row"}.issubset(lowered_headers):
        return "master"
    return "data"


def is_supported_tabular_path(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_TABULAR_SUFFIXES


def _dedupe_case_ids(values) -> tuple[str, ...]:
    return tuple(display for _key, display in canonical_case_id_pairs(values))
