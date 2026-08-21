from __future__ import annotations

from collections.abc import Iterable
from typing import Any

RERUN_SOURCES_DIR = "rerun_sources"
RERUN_SOURCE_SCHEMA_VERSION = 1
RERUN_SOURCE_INLINE_MAX_CHARS = 60000
RERUN_SOURCE_MAX_BYTES = 2 * 1024 * 1024
RERUN_HISTORY_MAX_SOURCES = 12
RERUN_HISTORY_MAX_BYTES = 8 * 1024 * 1024

_RERUN_TASK_FIELDS = (
    "task_id",
    "title",
    # ``dispatch`` names the capability (or sub-agent profile) to re-run; without
    # it the payload describes a task nobody can execute.
    "dispatch",
    "instructions",
    "args",
    "metadata",
    "stage",
)
_PLATFORM_METADATA_KEYS = {"capability", "display"}
_SOURCE_OBJECT_REF_KEY = "source_object_ref"


def build_rerun_source_payload(
    metadata: dict[str, Any],
    tasks: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    payload = {
        "schema_version": RERUN_SOURCE_SCHEMA_VERSION,
        **{key: value for key, value in metadata.items() if not _is_empty_rerun_value(value)},
        "tasks": list(tasks),
    }
    payload["task_count"] = len(payload["tasks"])
    return compact_rerun_source_payload(payload)


def compact_rerun_source_payload(source: dict[str, Any]) -> dict[str, Any]:
    compact = dict(source)
    tasks = source.get("tasks")
    if isinstance(tasks, list):
        compact["tasks"] = [compact_rerun_task_payload(task) if isinstance(task, dict) else task for task in tasks]
    return compact


def compact_rerun_task_payload(task: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    metadata = task.get("metadata")
    tabular = metadata.get("tabular") if isinstance(metadata, dict) else None
    source_object_ref = str(tabular.get(_SOURCE_OBJECT_REF_KEY) or "") if isinstance(tabular, dict) else ""
    source_ref = str(tabular.get("source_ref") or "") if isinstance(tabular, dict) else ""
    private_object_ref = _find_private_source_ref(task.get("args"), source_object_ref)
    materialize_object = bool(source_ref and private_object_ref)
    for key in _RERUN_TASK_FIELDS:
        if key not in task:
            continue
        if key == "metadata":
            value = compact_rerun_metadata(task[key])
        elif key == "args":
            value = _portable_rerun_value(task[key], source_object_ref, source_ref)
        else:
            value = task[key]
        if _is_empty_rerun_value(value):
            continue
        compact[key] = value
    compact_tabular = compact.get("metadata", {}).get("tabular") if isinstance(compact.get("metadata"), dict) else None
    if materialize_object and isinstance(compact_tabular, dict):
        compact_tabular["materialize_object"] = True
        if content_hash := _source_object_hash(private_object_ref):
            compact_tabular["content_hash"] = content_hash
    return compact


def compact_rerun_metadata(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    compact = {
        str(key): value
        for key, value in metadata.items()
        if key not in _PLATFORM_METADATA_KEYS and not _is_empty_rerun_value(value)
    }
    tabular = compact.get("tabular")
    if isinstance(tabular, dict):
        compact["tabular"] = {key: value for key, value in tabular.items() if key != _SOURCE_OBJECT_REF_KEY}
    return compact


def _portable_rerun_value(value: Any, source_object_ref: str, source_ref: str) -> Any:
    if isinstance(value, str):
        if source_ref and source_object_ref and value == source_object_ref:
            return source_ref
        return value
    if isinstance(value, dict):
        return {key: _portable_rerun_value(item, source_object_ref, source_ref) for key, item in value.items()}
    if isinstance(value, list):
        return [_portable_rerun_value(item, source_object_ref, source_ref) for item in value]
    return value


def _find_private_source_ref(value: Any, source_object_ref: str) -> str:
    if isinstance(value, str):
        return value if source_object_ref and value == source_object_ref else ""
    if isinstance(value, dict):
        return next(
            (found for item in value.values() if (found := _find_private_source_ref(item, source_object_ref))),
            "",
        )
    if isinstance(value, list):
        return next((found for item in value if (found := _find_private_source_ref(item, source_object_ref))), "")
    return ""


def _source_object_hash(object_ref: str) -> str:
    if not object_ref.startswith("sico-source://"):
        return ""
    normalized = object_ref.removeprefix("sico-source://").lstrip("/")
    parts = normalized.split("/")
    if len(parts) < 3 or parts[0] != "objects":
        return ""
    content_hash = parts[1].lower()
    return content_hash if len(content_hash) == 64 and all(char in "0123456789abcdef" for char in content_hash) else ""


def _contains_private_source_syntax(value: Any) -> bool:
    if isinstance(value, str):
        return value.startswith("sico-source://")
    if isinstance(value, dict):
        return any(_contains_private_source_syntax(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_private_source_syntax(item) for item in value)
    return False


def delegate_request_from_rerun_source(source: dict[str, Any]) -> dict[str, Any] | None:
    tasks = source.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        return None
    items: list[dict[str, Any]] = []
    for task in tasks:
        if not isinstance(task, dict):
            return None
        item = _rerun_instruction_item(compact_rerun_task_payload(task))
        if item is None:
            return None
        items.append(item)
    request: dict[str, Any] = {
        "batch_goal": str(source.get("reason") or "Rerun delegated tasks"),
        "join_strategy": str(source.get("join_strategy") or "partial_ok"),
        "sources": [{"type": "instructions", "items": items}],
    }
    max_concurrency = source.get("max_concurrency")
    if isinstance(max_concurrency, int) and max_concurrency > 0:
        request["max_concurrency"] = max_concurrency
    return request


def _rerun_instruction_item(task: dict[str, Any]) -> dict[str, Any] | None:
    goal = str(task.get("instructions") or task.get("title") or "").strip()
    if not goal:
        return None
    item: dict[str, Any] = {"goal": goal}
    if title := str(task.get("title") or "").strip():
        item["title"] = title
    if isinstance(task.get("args"), dict) and task["args"]:
        item["params"] = task["args"]
    if isinstance(task.get("stage"), int) and task["stage"] >= 0:
        item["stage"] = task["stage"]
    metadata = task.get("metadata")
    tabular = metadata.get("tabular") if isinstance(metadata, dict) else None
    if isinstance(tabular, dict) and tabular.get("materialize_object"):
        source_ref = str(tabular.get("source_ref") or "").strip()
        content_hash = str(tabular.get("content_hash") or "")
        if not source_ref or len(content_hash) != 64:
            return None
        item["source_materialization"] = {
            "source_ref": source_ref,
            "content_hash": content_hash,
        }
    elif _contains_private_source_syntax(task.get("args")):
        return None
    dispatch = task.get("dispatch")
    if isinstance(dispatch, dict):
        dispatch_type = str(dispatch.get("type") or "")
        if dispatch_type == "capability" and dispatch.get("capability_id"):
            item["capability_id"] = str(dispatch["capability_id"])
        elif dispatch_type == "sub_agent":
            item["profile_id"] = str(dispatch.get("profile_id") or "default")
            grants = dispatch.get("capability_grants")
            if isinstance(grants, list) and grants:
                item["capability_grants"] = [str(grant) for grant in grants if str(grant).strip()]
            if isinstance(dispatch.get("max_model_turns"), int) and dispatch["max_model_turns"] > 0:
                item["max_model_turns"] = dispatch["max_model_turns"]
        elif dispatch_type:
            return None
    elif task.get("kind") == "tool" and task.get("tool_name"):
        item["capability_id"] = f"builtin:{task['tool_name']}"
    return item


def _is_empty_rerun_value(value: Any) -> bool:
    return value is None or value == "" or value == {} or value == []
