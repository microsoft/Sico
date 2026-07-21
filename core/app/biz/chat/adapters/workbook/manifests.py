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

"""Workbook case-source manifest discovery and prompt-context rendering.

Reads the archives produced by :mod:`app.biz.chat.adapters.workbook.archive`
and turns them into:

* candidate listings for the case-source resolver (current/historical
  attachments, project knowledge),
* JSON prompt sections injected into the chat orchestration so the LLM picks
  the correct tool path for case-ID and workbook-execution references.
"""

from __future__ import annotations

import contextlib
import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from app.storage.fs import CHAT_FS

from .archive import CASE_SOURCES_DIR, PARSED_DOCUMENTS_DIR, extract_case_ids
from .workbook_cases import SUPPORTED_WORKBOOK_SUFFIXES

_EXECUTION_TERMS = (
    "execute",
    "run",
    "rerun",
    "re-run",
    "test",
    "执行",
    "运行",
    "跑",
    "重跑",
    "重新执行",
    "测试",
    "测一下",
    "帮我测",
    "帮我测试",
)
_REPEAT_TERMS = ("rerun", "re-run", "repeat", "again", "previous", "last", "上一次", "上一轮", "之前", "再次", "重跑")
_INSPECT_TERMS = (
    "what is",
    "content",
    "detail",
    "details",
    "describe",
    "description",
    "title",
    "steps",
    "内容",
    "详情",
    "是什么",
    "标题",
    "步骤",
    "预期",
)
_PROJECT_KNOWLEDGE_TERMS = ("project knowledge", "knowledge base", "knowledge", "项目知识", "知识库", "知识")
_HISTORY_ATTACHMENT_TERMS = (
    "previous attachment",
    "old attachment",
    "uploaded before",
    "历史附件",
    "之前的附件",
    "旧附件",
    "上次上传",
)
_CURRENT_ATTACHMENT_TERMS = (
    "current attachment",
    "this attachment",
    "uploaded file",
    "当前附件",
    "这个附件",
    "这份附件",
    "刚上传",
)
_GENERIC_WORKBOOK_SCOPE_NAMES = {
    "all",
    "case",
    "cases",
    "data",
    "sheet",
    "sheet1",
    "test",
    "tests",
    "workbook",
    "用例",
    "数据",
    "测试",
    "工作表",
}


class CaseIntent(StrEnum):
    EXECUTE = "execute_case"
    INSPECT = "inspect_case"
    RERUN = "rerun_case"
    UNKNOWN = "unknown"


class CaseSourcePreference(StrEnum):
    PROJECT_KNOWLEDGE = "project_knowledge"
    CURRENT_ATTACHMENT = "current_attachment"
    HISTORY_ATTACHMENT = "history_attachment"
    PREVIOUS_RUN = "previous_run"
    UNSPECIFIED = "unspecified"


@dataclass(frozen=True)
class CaseSourceCandidate:
    source_type: str
    label: str
    paths: tuple[str, ...] = ()
    case_ids: tuple[str, ...] = ()
    confidence: str = "candidate"
    requires_parse: bool = False
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class CaseSourceResolution:
    case_ids: tuple[str, ...]
    intent: CaseIntent
    source_preference: CaseSourcePreference
    candidates: tuple[CaseSourceCandidate, ...]
    ambiguous: bool
    needs_intent_check: bool


def is_explicit_case_execution_request(message: str) -> bool:
    if not extract_case_ids(message):
        return False
    intent = infer_case_intent(message)
    return intent is CaseIntent.EXECUTE


def is_case_source_query_request(message: str) -> bool:
    if not extract_case_ids(message):
        return False
    intent = infer_case_intent(message)
    return intent in {CaseIntent.INSPECT, CaseIntent.UNKNOWN}


def infer_case_intent(message: str) -> CaseIntent:
    text = (message or "").lower()
    if _contains_any(text, _REPEAT_TERMS):
        return CaseIntent.RERUN
    if _contains_any(text, _INSPECT_TERMS) or "?" in text or "？" in text:
        return CaseIntent.INSPECT
    if _contains_any(text, _EXECUTION_TERMS):
        return CaseIntent.EXECUTE
    return CaseIntent.UNKNOWN


def infer_source_preference(message: str) -> CaseSourcePreference:
    text = (message or "").lower()
    if _contains_any(text, _CURRENT_ATTACHMENT_TERMS):
        return CaseSourcePreference.CURRENT_ATTACHMENT
    if _contains_any(text, _HISTORY_ATTACHMENT_TERMS):
        return CaseSourcePreference.HISTORY_ATTACHMENT
    if _contains_any(text, _PROJECT_KNOWLEDGE_TERMS):
        return CaseSourcePreference.PROJECT_KNOWLEDGE
    if _contains_any(text, _REPEAT_TERMS):
        return CaseSourcePreference.PREVIOUS_RUN
    return CaseSourcePreference.UNSPECIFIED


def resolve_case_sources(
    workspace: Path,
    message: str,
    *,
    current_attachment_names: tuple[str, ...] = (),
) -> CaseSourceResolution | None:
    case_ids = extract_case_ids(message)
    if not case_ids:
        return None
    candidates = [
        *_current_attachment_candidates(workspace, current_attachment_names),
        *_history_document_candidates(workspace, case_ids),
    ]
    knowledge_candidate = _project_knowledge_candidate(workspace)
    if knowledge_candidate is not None:
        candidates.append(knowledge_candidate)
    source_preference = infer_source_preference(message)
    intent = infer_case_intent(message)
    return CaseSourceResolution(
        case_ids=case_ids,
        intent=intent,
        source_preference=source_preference,
        candidates=tuple(candidates),
        ambiguous=_is_source_ambiguous(source_preference, candidates),
        needs_intent_check=source_preference is CaseSourcePreference.UNSPECIFIED or intent is CaseIntent.UNKNOWN,
    )


def render_case_source_resolution_section(
    workspace: Path,
    message: str,
    *,
    current_attachment_names: tuple[str, ...] = (),
) -> str:
    resolution = resolve_case_sources(workspace, message, current_attachment_names=current_attachment_names)
    if resolution is None:
        return ""
    payload = {
        "case_ids": list(resolution.case_ids),
        "intent": resolution.intent.value,
        "source_preference": resolution.source_preference.value,
        "ambiguous": resolution.ambiguous,
        "needs_intent_check": resolution.needs_intent_check,
        "candidates": [_candidate_payload(candidate) for candidate in resolution.candidates],
        "policy": [
            "Use this as an intent/source check before choosing tools.",
            "For project_knowledge workbook paths, route to task and call delegate with kind=workbook using file_path.",
            "Do not call parse_document for historical attachments or history files.",
            "parse_document is allowed only for current-turn attachments listed under attachments/**.",
            "If source_preference is unspecified and multiple source types exist, state labels or ask a follow-up.",
            "Use read/grep on candidate paths that already exist; do not scan unrelated workspace paths.",
        ],
    }
    return "Case source resolver context:\n" + json.dumps(payload, ensure_ascii=False, indent=2)


def render_prior_parsed_workbook_sources_section(workspace: Path, message: str) -> str:
    if not _is_prior_workbook_source_request(workspace, message):
        return ""
    sources = _prior_parsed_workbook_sources(workspace)
    if not sources:
        return ""
    payload = {
        "sources": sources[:3],
        "policy": [
            "To execute a selected sheet, row range, or case IDs, call delegate with kind=workbook and "
            "workbook_cases.source_path set to the matching case_source_path.",
            "Do not expand workbook cases into individual tasks yourself; delegate with kind=workbook "
            "expands structured workbook sources deterministically.",
            "Do not call parse_document for historical attachments or history files.",
            "Do not use read/grep over archived Markdown to reconstruct workbook cases unless no structured case source exists.",
            "If the user named a sheet that appears in exactly one source, delegate that source directly.",
        ],
    }
    return "Prior parsed workbook sources available:\n" + json.dumps(payload, ensure_ascii=False, indent=2)


def is_workbook_execution_reference(message: str) -> bool:
    text = (message or "").lower()
    if not _contains_any(text, _EXECUTION_TERMS):
        return False
    workbook_terms = ("xlsx", "xlsm", "sheet", "tab", "worksheet", "workbook", "spreadsheet", "工作表", "rewritten_")
    return any(term in text for term in workbook_terms)


def is_prior_workbook_execution_reference(
    *,
    agent_instance_id: int,
    username: str,
    current_turn_id: int,
    message: str,
    conversation_id: int = 0,
) -> bool:
    if is_workbook_execution_reference(message):
        return True
    if not _contains_any((message or "").lower(), _EXECUTION_TERMS):
        return False
    if agent_instance_id <= 0 or current_turn_id <= 0:
        return False
    for manifest_path in prior_turn_case_source_manifest_paths(agent_instance_id, username, current_turn_id, conversation_id):
        loaded = _load_json_dict(manifest_path)
        if _message_mentions_workbook_scope(message, loaded):
            return True
    return False


def prior_case_source_manifest_paths(workspace: Path) -> list[Path]:
    """Return case-source manifest paths under ``workspace/case_sources/``.

    Manifests are content-addressed and retained across turns. Newest filenames
    sort last lexicographically by hash, so we return them in reverse-name
    order to keep recent entries first. Also includes legacy archives under
    ``workspace/history/turn-*/case_sources/`` if present.
    """
    paths: list[Path] = []
    current_dir = workspace / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
    if current_dir.exists():
        paths.extend(current_dir.glob("*.json"))
    history_dir = workspace / "history"
    if history_dir.exists():
        paths.extend(history_dir.glob(f"turn-*/{CASE_SOURCES_DIR}/{PARSED_DOCUMENTS_DIR}/*.json"))
    return sorted(paths, key=lambda path: (_manifest_turn_id(path), path.name), reverse=True)


def prior_turn_case_source_manifest_paths(
    agent_instance_id: int,
    username: str,
    current_turn_id: int,
    conversation_id: int = 0,
) -> list[Path]:
    """Return case-source manifest paths from the workspace.

    Case sources are persisted under ``workspace/case_sources/parsed_documents/``
    and retained across turns. Manifest filenames are content-addressed
    (``<file>-<hash>.json``) so the same parsed document is reused on repeat
    parses; there is no per-turn segregation. ``current_turn_id`` is accepted
    for backward compatibility but is not used for filtering.
    """
    del current_turn_id  # retained for backward-compatible signature
    with contextlib.suppress(Exception):
        if agent_instance_id <= 0 or not username:
            return []
        workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
        return prior_case_source_manifest_paths(workspace)
    return []


def _current_attachment_candidates(workspace: Path, attachment_names: tuple[str, ...]) -> list[CaseSourceCandidate]:
    index_path = workspace / "attachments" / "index.json"
    indexed = _load_json_list(index_path)
    candidates: list[CaseSourceCandidate] = []
    for item in indexed:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        path = str(item.get("path") or "")
        if not name or not path:
            continue
        if attachment_names and name not in attachment_names:
            continue
        candidates.append(
            CaseSourceCandidate(
                source_type=CaseSourcePreference.CURRENT_ATTACHMENT.value,
                label=name,
                paths=(path,),
                confidence="current_turn",
                requires_parse=True,
            )
        )
    return candidates


def _history_document_candidates(workspace: Path, case_ids: tuple[str, ...]) -> list[CaseSourceCandidate]:
    candidates: list[CaseSourceCandidate] = []
    wanted = set(case_ids)
    history_dir = workspace / "history"
    if not history_dir.exists():
        return []
    for manifest_path in prior_case_source_manifest_paths(workspace):
        loaded = _load_json_dict(manifest_path)
        if not loaded:
            continue
        manifest_case_ids = tuple(str(case_id).upper() for case_id in loaded.get("case_ids") or [])
        if not manifest_case_ids or not wanted.intersection(manifest_case_ids):
            continue
        markdown_name = str(loaded.get("archived_markdown_path") or "")
        markdown_path = manifest_path.with_name(markdown_name) if markdown_name else manifest_path.with_suffix(".md")
        paths = (markdown_path.relative_to(workspace).as_posix(),) if markdown_path.exists() else ()
        metadata = {
            "manifest_path": manifest_path.relative_to(workspace).as_posix(),
            "data_rows": loaded.get("data_rows"),
            "content_truncated": loaded.get("content_truncated"),
        }
        workbook_manifest = loaded.get("workbook_manifest")
        if isinstance(workbook_manifest, dict):
            metadata["workbook_manifest"] = workbook_manifest
        candidates.append(
            CaseSourceCandidate(
                source_type=CaseSourcePreference.HISTORY_ATTACHMENT.value,
                label=str(loaded.get("file_path") or manifest_path.stem),
                paths=paths,
                case_ids=manifest_case_ids,
                confidence="indexed_case_id" if manifest_case_ids else "parsed_document",
                metadata=metadata,
            )
        )
    return candidates


def _project_knowledge_candidate(workspace: Path) -> CaseSourceCandidate | None:
    index_path = workspace / "knowledge" / "index.json"
    indexed = _load_json_list(index_path)
    if not indexed:
        return None
    names = [str(item.get("name") or item.get("id") or "") for item in indexed if isinstance(item, dict)]
    workbook_paths = _project_knowledge_workbook_paths(workspace)
    return CaseSourceCandidate(
        source_type=CaseSourcePreference.PROJECT_KNOWLEDGE.value,
        label="Project Knowledge",
        paths=tuple(workbook_paths[:8]) if workbook_paths else ("knowledge/**",),
        confidence="workbook_path" if workbook_paths else "available_unverified",
        metadata={"items": len(indexed), "names": names[:8], "workbook_paths": workbook_paths[:8]},
    )


def _project_knowledge_workbook_paths(workspace: Path) -> list[str]:
    knowledge_dir = workspace / "knowledge"
    if not knowledge_dir.exists():
        return []
    paths: list[str] = []
    for path in sorted(knowledge_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED_WORKBOOK_SUFFIXES:
            paths.append(path.relative_to(workspace).as_posix())
    return paths


def _prior_parsed_workbook_sources(workspace: Path) -> list[dict[str, Any]]:
    history_dir = workspace / "history"
    if not history_dir.exists():
        return []
    sources: list[dict[str, Any]] = []
    for manifest_path in prior_case_source_manifest_paths(workspace):
        loaded = _load_json_dict(manifest_path)
        workbook_manifest = loaded.get("workbook_manifest") if loaded else None
        if not isinstance(workbook_manifest, dict):
            continue
        workbook_sources = _workbook_case_source_payloads(workspace, manifest_path, loaded.get("workbook_case_sources"))
        if not workbook_sources:
            continue
        sources.append(
            {
                "turn_id": _manifest_turn_id(manifest_path),
                "file_path": loaded.get("file_path"),
                "manifest_path": manifest_path.relative_to(workspace).as_posix(),
                "data_rows": loaded.get("data_rows"),
                "content_truncated": loaded.get("content_truncated"),
                "sheets": _workbook_sheet_summaries(workbook_manifest),
                "workbook_case_sources": workbook_sources,
            }
        )
    return sources


def _workbook_case_source_payloads(workspace: Path, manifest_path: Path, raw_sources: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_sources, list):
        return []
    payloads: list[dict[str, Any]] = []
    for source in raw_sources:
        if not isinstance(source, dict):
            continue
        case_source_name = str(source.get("case_source_path") or "")
        case_source_path = manifest_path.with_name(case_source_name) if case_source_name else None
        payload = {
            "sheet_name": source.get("sheet_name"),
            "kind": source.get("kind"),
            "case_count": source.get("case_count"),
        }
        if case_source_path is not None and case_source_path.exists():
            payload["case_source_path"] = case_source_path.relative_to(workspace).as_posix()
        payloads.append(payload)
    return payloads


def _workbook_sheet_summaries(workbook_manifest: dict[str, Any]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for sheet in workbook_manifest.get("sheets") or []:
        if not isinstance(sheet, dict):
            continue
        summaries.append(
            {
                "name": sheet.get("name"),
                "kind": sheet.get("kind"),
                "data_rows": sheet.get("data_rows"),
            }
        )
    return summaries


def _manifest_turn_id(manifest_path: Path) -> int:
    for parent in manifest_path.parents:
        if parent.name.startswith("turn-"):
            with contextlib.suppress(ValueError):
                return int(parent.name.removeprefix("turn-"))
    return -1


def _turn_dir_turn_id(turn_dir: Path) -> int:
    if turn_dir.name.startswith("turn-"):
        with contextlib.suppress(ValueError):
            return int(turn_dir.name.removeprefix("turn-"))
    return -1


def _candidate_payload(candidate: CaseSourceCandidate) -> dict[str, Any]:
    return {
        "source_type": candidate.source_type,
        "label": candidate.label,
        "paths": list(candidate.paths),
        "case_ids": list(candidate.case_ids),
        "confidence": candidate.confidence,
        "requires_parse": candidate.requires_parse,
        "metadata": candidate.metadata or {},
    }


def _is_source_ambiguous(source_preference: CaseSourcePreference, candidates: list[CaseSourceCandidate]) -> bool:
    if source_preference is not CaseSourcePreference.UNSPECIFIED:
        return False
    return len({candidate.source_type for candidate in candidates}) > 1


def _load_json_list(path: Path) -> list[Any]:
    loaded = _load_json(path)
    return loaded if isinstance(loaded, list) else []


def _load_json_dict(path: Path) -> dict[str, Any]:
    loaded = _load_json(path)
    return loaded if isinstance(loaded, dict) else {}


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _is_prior_workbook_source_request(workspace: Path, message: str) -> bool:
    if is_workbook_execution_reference(message):
        return True
    if not _contains_any((message or "").lower(), _EXECUTION_TERMS):
        return False
    return any(
        _message_mentions_workbook_scope(message, _load_json_dict(path)) for path in prior_case_source_manifest_paths(workspace)
    )


def _message_mentions_workbook_scope(message: str, manifest: dict[str, Any]) -> bool:
    if not isinstance(manifest, dict) or not manifest.get("workbook_case_sources"):
        return False
    message_key = _normalize_lookup_text(message)
    if not message_key:
        return False
    names: list[str] = []
    names.append(Path(str(manifest.get("file_path") or "")).stem)
    workbook_manifest = manifest.get("workbook_manifest")
    if isinstance(workbook_manifest, dict):
        names.extend(str(sheet.get("name") or "") for sheet in workbook_manifest.get("sheets") or [] if isinstance(sheet, dict))
    names.extend(
        str(source.get("sheet_name") or "") for source in manifest.get("workbook_case_sources") or [] if isinstance(source, dict)
    )
    for name in names:
        if _workbook_scope_name_matches(message_key, name):
            return True
    return False


def _workbook_scope_name_matches(message_key: str, name: str) -> bool:
    name_key = _normalize_lookup_text(name)
    if not name_key or name_key in _GENERIC_WORKBOOK_SCOPE_NAMES:
        return False
    min_length = 2 if _contains_cjk(name_key) else 3
    if len(name_key) < min_length:
        return False
    return name_key in message_key


def _normalize_lookup_text(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum() or "\u4e00" <= ch <= "\u9fff")


def _contains_cjk(value: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in value)
