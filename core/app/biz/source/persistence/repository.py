"""Content-addressed workspace repository for source snapshots."""

from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from collections.abc import Iterable
from contextlib import contextmanager
from dataclasses import replace
from functools import lru_cache
from pathlib import Path
from typing import Any

import portalocker

from ..models import SourceManifest, TabularDocument, source_occurrence_id, table_id_for_source
from .formats.source_snapshot_v2 import document_from_snapshot, manifest_from_payload, manifest_payload, row_payload

SOURCE_REPOSITORY_DIR = ".source-repository"
SOURCE_OBJECT_SCHEME = "sico-source://"
SNAPSHOTS_DIR = "snapshots"
OBJECTS_DIR = "objects"
INDEX_FILE = "index.json"
_REPOSITORY_LOCK = threading.RLock()
_LOCK_STATE = threading.local()
_LOCK_FILE = ".repository.lock"
_ORPHAN_MARKER = ".orphaned-at"
_ORPHAN_RETENTION_SECONDS = 30 * 24 * 60 * 60


class WorkspaceSourceRepository:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()
        self.root = self.workspace.parent / SOURCE_REPOSITORY_DIR / self.workspace.name

    def find(self, source_ref: str) -> SourceManifest | None:
        with _repository_lock(self.root):
            normalized_ref = _normalize_ref(source_ref)
            return self._manifest_from_entry(normalized_ref, self._index().get(normalized_ref))

    def save(self, manifest: SourceManifest, document: TabularDocument, *, source_path: Path | None = None) -> None:
        with _repository_lock(self.root):
            if source_path is not None:
                self._save_object(manifest, source_path)
            snapshot_root = self._snapshot_root(manifest)
            snapshot_root.mkdir(parents=True, exist_ok=True)
            for sheet_manifest, sheet in zip(manifest.sheets, document.sheets, strict=True):
                table_path = _safe_child(snapshot_root, sheet_manifest.snapshot_path)
                table_path.parent.mkdir(parents=True, exist_ok=True)
                _write_lines_atomic(
                    table_path,
                    (json.dumps(row_payload(row), ensure_ascii=False) + "\n" for row in sheet.rows),
                )
            self._save_manifest(manifest)

    def attach_text_metadata(self, manifest: SourceManifest, content_chars: int, summary: str) -> SourceManifest:
        with _repository_lock(self.root):
            updated = replace(
                manifest,
                summary=summary,
                content_chars=content_chars,
            )
            self._save_manifest(updated)
            return updated

    def save_object(self, manifest: SourceManifest, source_path: Path) -> None:
        with _repository_lock(self.root):
            self._save_object(manifest, source_path)

    def object_ref(self, manifest: SourceManifest) -> str:
        with _repository_lock(self.root):
            if not manifest.object_path:
                return ""
            try:
                target = _safe_child(self.root, manifest.object_path)
            except ValueError:
                return ""
            object_root = (self.root / OBJECTS_DIR).resolve()
            if not target.is_relative_to(object_root):
                return ""
            if not target.is_file() or _file_hash(target) != manifest.content_hash:
                return ""
            return SOURCE_OBJECT_SCHEME + manifest.object_path

    def resolve_object_ref(self, object_ref: str) -> Path | None:
        if not object_ref.startswith(SOURCE_OBJECT_SCHEME):
            return None
        relative = object_ref.removeprefix(SOURCE_OBJECT_SCHEME)
        try:
            target = _safe_child(self.root, relative)
        except ValueError:
            return None
        parts = Path(relative).parts
        if len(parts) < 3 or parts[0] != OBJECTS_DIR:
            return None
        expected_hash = parts[1]
        if not target.is_file() or _file_hash(target) != expected_hash:
            return None
        return target

    def replace_refs(self, prefix: str, manifests: Iterable[SourceManifest]) -> None:
        normalized_prefix = _normalize_ref(prefix)
        if normalized_prefix and not normalized_prefix.endswith("/"):
            normalized_prefix += "/"
        with _repository_lock(self.root):
            index = {
                source_ref: entry
                for source_ref, entry in self._index().items()
                if not source_ref.startswith(normalized_prefix)
            }
            for manifest in manifests:
                index[_normalize_ref(manifest.source_ref)] = self._index_entry(manifest)
            self.root.mkdir(parents=True, exist_ok=True)
            _write_json_atomic(self.root / INDEX_FILE, index)
            self._prune_orphans(index)

    def _save_manifest(self, manifest: SourceManifest) -> None:
        snapshot_root = self._snapshot_root(manifest)
        snapshot_root.mkdir(parents=True, exist_ok=True)
        manifest_path = snapshot_root / "manifest.json"
        _write_json_atomic(manifest_path, manifest_payload(manifest))
        index = self._index()
        index[_normalize_ref(manifest.source_ref)] = self._index_entry(manifest)
        self.root.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(self.root / INDEX_FILE, index)

    def _index_entry(self, manifest: SourceManifest) -> dict[str, str]:
        manifest_path = self._snapshot_root(manifest) / "manifest.json"
        return {
            "source_id": manifest.source_id,
            "content_hash": manifest.content_hash,
            "file_name": manifest.file_name,
            "manifest_path": manifest_path.relative_to(self.root).as_posix(),
        }

    def _save_object(self, manifest: SourceManifest, source_path: Path) -> None:
        if not manifest.object_path:
            return
        target = _safe_child(self.root, manifest.object_path)
        if not target.is_relative_to((self.root / OBJECTS_DIR).resolve()):
            raise ValueError(f"source object path is outside object storage: {manifest.object_path}")
        if target.is_file() and _file_hash(target) == manifest.content_hash:
            return
        _copy_file_atomic(source_path, target)

    def load_document(self, manifest: SourceManifest, selected: tuple[str, ...]) -> TabularDocument:
        with _repository_lock(self.root):
            wanted = set(selected)
            sheets = tuple(sheet for sheet in manifest.sheets if not wanted or sheet.name.casefold() in wanted)
            snapshot_root = self._snapshot_root(manifest)
            return document_from_snapshot(snapshot_root, manifest, sheets)

    def list_manifests(self) -> tuple[SourceManifest, ...]:
        with _repository_lock(self.root):
            index = self._index()
            return tuple(
                manifest
                for source_ref, entry in index.items()
                if (manifest := self._manifest_from_entry(source_ref, entry)) is not None
            )

    def _manifest_from_entry(self, source_ref: str, entry: Any) -> SourceManifest | None:
        if not isinstance(entry, dict):
            return None
        try:
            manifest_path = _safe_child(self.root, str(entry.get("manifest_path") or ""))
        except ValueError:
            return None
        if not manifest_path.is_file():
            return None
        try:
            loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
            return _bind_source_ref(
                manifest_from_payload(loaded),
                source_ref,
                str(entry.get("file_name") or Path(source_ref).name),
            )
        except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def _index(self) -> dict[str, Any]:
        path = self.root / INDEX_FILE
        if not path.is_file():
            return {}
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return loaded if isinstance(loaded, dict) else {}

    def _snapshot_root(self, manifest: SourceManifest) -> Path:
        key = f"{manifest.content_hash}.{manifest.format}.p{manifest.parser_version}"
        return _safe_child(self.root / SNAPSHOTS_DIR, key)

    def _prune_orphans(self, index: dict[str, Any]) -> None:
        active_snapshots = {
            Path(str(entry.get("manifest_path") or "")).parent.name
            for entry in index.values()
            if isinstance(entry, dict)
        }
        active_objects = {
            str(entry.get("content_hash") or "")
            for entry in index.values()
            if isinstance(entry, dict) and entry.get("content_hash")
        }
        self._prune_directory(self.root / SNAPSHOTS_DIR, active_snapshots)
        self._prune_directory(self.root / OBJECTS_DIR, active_objects)

    @staticmethod
    def _prune_directory(root: Path, active: set[str]) -> None:
        if not root.is_dir():
            return
        now = time.time()
        for child in root.iterdir():
            if not child.is_dir():
                continue
            relative = child.relative_to(root).as_posix()
            marker = child / _ORPHAN_MARKER
            if relative in active:
                marker.unlink(missing_ok=True)
                continue
            if not marker.exists():
                marker.write_text(str(int(now)), encoding="ascii")
                continue
            if now - marker.stat().st_mtime >= _ORPHAN_RETENTION_SECONDS:
                shutil.rmtree(child, ignore_errors=True)


def _normalize_ref(source_ref: str) -> str:
    return source_ref.replace("\\", "/").strip().lstrip("/")


@contextmanager
def _repository_lock(root: Path):
    with _REPOSITORY_LOCK:
        depth = int(getattr(_LOCK_STATE, "depth", 0))
        if depth:
            _LOCK_STATE.depth = depth + 1
            try:
                yield
            finally:
                _LOCK_STATE.depth = depth
            return
        root.mkdir(parents=True, exist_ok=True)
        with portalocker.Lock(root / _LOCK_FILE, mode="a", timeout=30):
            _LOCK_STATE.depth = 1
            try:
                yield
            finally:
                _LOCK_STATE.depth = 0


def source_object_path(content_hash: str, source_format: str) -> str:
    suffix = source_format.strip().lower() or "bin"
    return f"{OBJECTS_DIR}/{content_hash}/source.{suffix}"


def _safe_child(root: Path, relative: str) -> Path:
    normalized = relative.replace("\\", "/").strip().lstrip("/")
    if not normalized:
        raise ValueError("empty repository path")
    candidate = (root / normalized).resolve()
    if not candidate.is_relative_to(root.resolve()):
        raise ValueError(f"repository path escapes root: {relative}")
    return candidate


def _file_hash(path: Path) -> str:
    resolved = path.resolve()
    stat = resolved.stat()
    return _cached_file_hash(str(resolved), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)


@lru_cache(maxsize=2_048)
def _cached_file_hash(path: str, _size: int, _mtime_ns: int, _ctime_ns: int, _inode: int) -> str:
    import hashlib

    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bind_source_ref(manifest: SourceManifest, source_ref: str, file_name: str) -> SourceManifest:
    source_id = source_occurrence_id(manifest.content_hash, source_ref)
    runnable_ids = set(manifest.runnable_sheet_ids)
    sheets = tuple(
        replace(sheet, sheet_id=table_id_for_source(source_id, sheet.name))
        for sheet in manifest.sheets
    )
    return replace(
        manifest,
        source_id=source_id,
        source_ref=source_ref,
        file_name=file_name,
        sheets=sheets,
        runnable_sheet_ids=tuple(
            sheet.sheet_id
            for original, sheet in zip(manifest.sheets, sheets, strict=True)
            if original.sheet_id in runnable_ids
        ),
    )


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _write_lines_atomic(path: Path, lines: Iterable[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{uuid.uuid4().hex}.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        stream.writelines(lines)
    temporary.replace(path)


def _copy_file_atomic(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + f".{uuid.uuid4().hex}.tmp")
    with source.open("rb") as source_stream, temporary.open("wb") as target_stream:
        shutil.copyfileobj(source_stream, target_stream, length=1024 * 1024)
    temporary.replace(target)
