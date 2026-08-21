"""Chat-facing source discovery and compact prompt projections."""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from app.biz.source import canonical_case_id, compact_manifest_payload
from app.biz.source.persistence.legacy.workbook_case_snapshot_v1 import (
    extract_case_ids,
    legacy_manifest_paths,
    legacy_sheet_sources,
    load_legacy_manifest,
)
from app.biz.source.persistence.repository import WorkspaceSourceRepository
from app.biz.source.tabular.reader import SUPPORTED_TABULAR_SUFFIXES

_EXECUTION_TERMS = (
    "execute", "run", "rerun", "re-run", "test", "执行", "运行", "跑", "重跑", "重新执行", "测试", "测一下", "帮我测", "帮我测试",
)
_REPEAT_TERMS = (
    "rerun", "re-run", "repeat", "again", "previous", "last", "上一次", "上一轮", "之前", "再次", "重跑",
)
_INSPECT_TERMS = (
    "what is", "content", "detail", "details", "describe", "description", "title", "steps",
    "内容", "详情", "是什么", "标题", "步骤", "预期",
)
_PROJECT_KNOWLEDGE_TERMS = (
    "project knowledge", "knowledge base", "knowledge", "项目知识", "知识库", "知识",
)
_HISTORY_ATTACHMENT_TERMS = (
    "previous attachment", "old attachment", "uploaded before", "历史附件", "之前的附件", "旧附件", "上次上传",
)
_CURRENT_ATTACHMENT_TERMS = (
    "current attachment", "this attachment", "uploaded file", "当前附件", "这个附件", "这份附件", "刚上传",
)
_GENERIC_SCOPE_NAMES = {
    "all", "case", "cases", "data", "sheet", "sheet1", "test", "tests", "workbook", "用例", "数据", "测试", "工作表",
}
_MAX_PROMPT_CANDIDATE_CASE_IDS = 20


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


def build_source_sections(workspace: Path, message: str, attachment_names: tuple[str, ...]) -> dict[str, str]:
    sections = {
        "source_manifests": render_available_source_manifests_section(workspace, attachment_names),
        "case_source_resolution": render_case_source_resolution_section(
            workspace,
            message,
            current_attachment_names=attachment_names,
        ),
        "prior_tabular_sources": render_prior_tabular_sources_section(workspace, message),
    }
    return {name: value for name, value in sections.items() if value}


def render_available_source_manifests_section(workspace: Path, attachment_names: tuple[str, ...]) -> str:
    wanted = set(attachment_names)
    manifests = []
    for manifest in WorkspaceSourceRepository(workspace).list_manifests():
        is_current_attachment = manifest.source_ref.startswith("attachments/") and (
            not wanted or Path(manifest.source_ref).name in wanted
        )
        if is_current_attachment or manifest.source_ref.startswith("knowledge/"):
            manifests.append(manifest)
    manifests.sort(key=lambda manifest: (not manifest.source_ref.startswith("attachments/"), manifest.source_ref))
    if not manifests:
        return ""
    payload = {
        "sources": [compact_manifest_payload(manifest) for manifest in manifests[:8]],
        "policy": [
            "Use these manifests before choosing a source tool or delegate scope.",
            "If requires_scope_selection is true and the user did not identify sheets, ask before delegation.",
            "One runnable data sheet plus summary/readme sheets does not require selecting the summary sheets.",
        ],
    }
    return "Source manifests available:\n" + json.dumps(payload, ensure_ascii=False, indent=2)


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
        *_snapshot_candidates(workspace, case_ids, current_attachment_names),
        *_legacy_candidates(workspace, case_ids),
    ]
    knowledge = _project_knowledge_candidate(workspace)
    if knowledge is not None and not any(
        candidate.source_type == CaseSourcePreference.PROJECT_KNOWLEDGE.value for candidate in candidates
    ):
        candidates.append(knowledge)
    source_preference = infer_source_preference(message)
    intent = infer_case_intent(message)
    return CaseSourceResolution(
        case_ids=case_ids,
        intent=intent,
        source_preference=source_preference,
        candidates=tuple(_dedupe_candidates(candidates)),
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
            "For project knowledge tabular paths, include each path as a source_ref in delegate request_json.",
            "Do not call parse_document for historical attachments or history files; use existing source snapshots.",
            "If source preference is unspecified and multiple source types exist, state labels or ask a follow-up.",
        ],
    }
    return "Case source resolver context:\n" + json.dumps(payload, ensure_ascii=False, indent=2)


def render_prior_tabular_sources_section(workspace: Path, message: str) -> str:
    if not _is_prior_source_request(workspace, message):
        return ""
    sources = _snapshot_source_payloads(workspace) + _legacy_source_payloads(workspace)
    if not sources:
        return ""
    payload = {
        "sources": sources[:8],
        "policy": [
            "To execute a selected sheet, row range, or case IDs, include one type=tabular document source_ref "
            "with explicit sheet_names in delegate request_json.",
            "Do not expand rows into individual chat tool calls; source selection is deterministic.",
            "Do not call parse_document for historical sources that already have snapshots.",
        ],
    }
    return "Prior indexed tabular sources available:\n" + json.dumps(payload, ensure_ascii=False, indent=2)


def is_tabular_execution_reference(message: str) -> bool:
    text = (message or "").lower()
    if not _contains_any(text, _EXECUTION_TERMS):
        return False
    return any(term in text for term in ("xlsx", "xlsm", "sheet", "tab", "worksheet", "workbook", "spreadsheet", "工作表"))


def _current_attachment_candidates(workspace: Path, attachment_names: tuple[str, ...]) -> list[CaseSourceCandidate]:
    indexed = _load_json(workspace / "attachments" / "index.json")
    items = indexed if isinstance(indexed, list) else []
    manifests = {manifest.source_ref: manifest for manifest in WorkspaceSourceRepository(workspace).list_manifests()}
    candidates: list[CaseSourceCandidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        path = str(item.get("path") or "")
        if not name or not path or (attachment_names and name not in attachment_names):
            continue
        manifest = manifests.get(path)
        candidates.append(
            CaseSourceCandidate(
                source_type=CaseSourcePreference.CURRENT_ATTACHMENT.value,
                label=name,
                paths=(path,),
                case_ids=manifest.case_ids if manifest else (),
                confidence="indexed_source" if manifest else "current_turn",
                requires_parse=manifest is None,
                metadata=compact_manifest_payload(manifest) if manifest else None,
            )
        )
    return candidates


def _snapshot_candidates(
    workspace: Path,
    case_ids: tuple[str, ...],
    current_attachment_names: tuple[str, ...],
) -> list[CaseSourceCandidate]:
    wanted = {canonical_case_id(case_id) for case_id in case_ids}
    current_refs = {f"attachments/{name}" for name in current_attachment_names}
    candidates: list[CaseSourceCandidate] = []
    for manifest in WorkspaceSourceRepository(workspace).list_manifests():
        indexed = {canonical_case_id(case_id) for case_id in manifest.case_ids}
        if not wanted.intersection(indexed) or manifest.source_ref in current_refs:
            continue
        source_type = (
            CaseSourcePreference.PROJECT_KNOWLEDGE.value
            if manifest.source_ref.startswith("knowledge/")
            else CaseSourcePreference.HISTORY_ATTACHMENT.value
        )
        candidates.append(
            CaseSourceCandidate(
                source_type=source_type,
                label=manifest.file_name,
                paths=(manifest.source_ref,),
                case_ids=manifest.case_ids,
                confidence="indexed_case_id",
                metadata=compact_manifest_payload(manifest),
            )
        )
    return candidates


def _legacy_candidates(workspace: Path, case_ids: tuple[str, ...]) -> list[CaseSourceCandidate]:
    wanted = {canonical_case_id(case_id) for case_id in case_ids}
    candidates: list[CaseSourceCandidate] = []
    for path in legacy_manifest_paths(workspace):
        manifest = load_legacy_manifest(path)
        if not manifest:
            continue
        indexed = tuple(str(value).upper() for value in manifest.get("case_ids") or ())
        if not indexed or not wanted.intersection(canonical_case_id(case_id) for case_id in indexed):
            continue
        markdown_name = str(manifest.get("archived_markdown_path") or "")
        markdown = path.with_name(markdown_name) if markdown_name else None
        paths = (markdown.relative_to(workspace).as_posix(),) if markdown is not None and markdown.is_file() else ()
        candidates.append(
            CaseSourceCandidate(
                source_type=CaseSourcePreference.HISTORY_ATTACHMENT.value,
                label=str(manifest.get("file_path") or path.stem),
                paths=paths,
                case_ids=indexed,
                confidence="indexed_case_id",
                metadata={"manifest_path": path.relative_to(workspace).as_posix()},
            )
        )
    return candidates


def _project_knowledge_candidate(workspace: Path) -> CaseSourceCandidate | None:
    indexed = _load_json(workspace / "knowledge" / "index.json")
    if not isinstance(indexed, list) or not indexed:
        return None
    paths = _project_knowledge_paths(workspace)
    return CaseSourceCandidate(
        source_type=CaseSourcePreference.PROJECT_KNOWLEDGE.value,
        label="Project Knowledge",
        paths=tuple(paths[:8]) if paths else ("knowledge/**",),
        confidence="tabular_path" if paths else "available_unverified",
        metadata={"items": len(indexed), "tabular_paths": paths[:8]},
    )


def _project_knowledge_paths(workspace: Path) -> list[str]:
    root = workspace / "knowledge"
    if not root.exists():
        return []
    return [
        path.relative_to(workspace).as_posix()
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.suffix.lower() in SUPPORTED_TABULAR_SUFFIXES
    ]


def _snapshot_source_payloads(workspace: Path) -> list[dict[str, Any]]:
    return [
        compact_manifest_payload(manifest)
        for manifest in WorkspaceSourceRepository(workspace).list_manifests()
        if manifest.sheets
    ]


def _legacy_source_payloads(workspace: Path) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for path in legacy_manifest_paths(workspace):
        manifest = load_legacy_manifest(path)
        if not manifest:
            continue
        sheets = legacy_sheet_sources(workspace, path, manifest)
        if not sheets:
            continue
        payloads.append(
            {
                "source_ref": manifest.get("file_path"),
                "legacy_manifest_path": path.relative_to(workspace).as_posix(),
                "sheets": sheets,
            }
        )
    return payloads


def _is_prior_source_request(workspace: Path, message: str) -> bool:
    if is_tabular_execution_reference(message):
        return True
    if not _contains_any((message or "").lower(), _EXECUTION_TERMS):
        return False
    return _message_mentions_scope(message, _snapshot_source_payloads(workspace) + _legacy_source_payloads(workspace))


def _message_mentions_scope(message: str, sources: list[dict[str, Any]]) -> bool:
    key = _normalize_lookup_text(message)
    for source in sources:
        names = [Path(str(source.get("source_ref") or "")).stem]
        for sheet in source.get("sheets") or ():
            if isinstance(sheet, dict):
                names.append(str(sheet.get("name") or sheet.get("sheet_name") or ""))
        if any(_scope_name_matches(key, name) for name in names):
            return True
    return False


def _scope_name_matches(message_key: str, name: str) -> bool:
    name_key = _normalize_lookup_text(name)
    if not name_key or name_key in _GENERIC_SCOPE_NAMES:
        return False
    minimum = 2 if any("\u4e00" <= char <= "\u9fff" for char in name_key) else 3
    return len(name_key) >= minimum and name_key in message_key


def _candidate_payload(candidate: CaseSourceCandidate) -> dict[str, Any]:
    return {
        "source_type": candidate.source_type,
        "label": candidate.label,
        "paths": list(candidate.paths),
        "case_id_count": len(candidate.case_ids),
        "case_ids": list(candidate.case_ids[:_MAX_PROMPT_CANDIDATE_CASE_IDS]),
        "omitted_case_id_count": max(0, len(candidate.case_ids) - _MAX_PROMPT_CANDIDATE_CASE_IDS),
        "confidence": candidate.confidence,
        "requires_parse": candidate.requires_parse,
        "metadata": candidate.metadata or {},
    }


def _dedupe_candidates(candidates: list[CaseSourceCandidate]) -> list[CaseSourceCandidate]:
    deduped: list[CaseSourceCandidate] = []
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for candidate in candidates:
        key = candidate.source_type, candidate.paths
        if key not in seen:
            seen.add(key)
            deduped.append(candidate)
    return deduped


def _is_source_ambiguous(preference: CaseSourcePreference, candidates: list[CaseSourceCandidate]) -> bool:
    return preference is CaseSourcePreference.UNSPECIFIED and len({item.source_type for item in candidates}) > 1


def _normalize_lookup_text(value: str) -> str:
    return "".join(char for char in value.strip().lower() if char.isalnum() or "\u4e00" <= char <= "\u9fff")


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _load_json(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
