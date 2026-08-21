"""Stage skills, knowledge, bounded rerun context, and attachments for chat."""

import asyncio
import json
import logging
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from app.biz.task_runtime.workspace.rerun_sources import (
    RERUN_HISTORY_MAX_BYTES,
    RERUN_HISTORY_MAX_SOURCES,
    RERUN_SOURCES_DIR,
    RERUN_SOURCE_MAX_BYTES,
)
from app.biz.skill.paths import latest_skill_version_dir
from app.biz.skill.resolver import (
    ORIGINAL_DIR,
    RESOLVED_CORTEX_DIR,
    RESOLVED_DIR,
    infer_required_parameter_names,
    load_resolved_actions,
)
from app.biz.reverse_grpc.knowledge import ReverseKnowledgeService
from app.biz.source import SourceManifest, WorkspaceSourceService, is_supported_tabular_path
from app.biz.source.persistence.repository import WorkspaceSourceRepository
from app.experiences.playbook import PlaybookStore
from app.storage.fs import (
    CHAT_FS,
    KNOWLEDGE_DOCUMENT_FS,
    KNOWLEDGE_LINK_FS,
    SKILLS_FS,
    parse_skill_frontmatter,
)

_LOGGER = logging.getLogger(__name__)

_HISTORY_TURN_COUNT = 3

CLEAN_TMP_ON_WORKSPACE_INIT = True
"""When ``True``, the ``.tmp/`` directory (used by tool output truncation)
is cleared at the start of each turn during workspace initialization."""


@dataclass(frozen=True)
class WorkspaceInitOptions:
    include_knowledge: bool = True
    include_history: bool = True
    include_playbooks: bool = True
    retain_previous_attachments: bool = True


async def init_workspace(  # noqa: PLR0913
    agent_instance_id: int,
    username: str,
    turn_id: int,
    project_id: int,
    agent_id: str,
    attachments: list[Any] | None = None,
    options: WorkspaceInitOptions | None = None,
    conversation_id: int = 0,
) -> None:
    """Initialize the workspace directory for a chat session.

    Copies skills, knowledge, and user attachments into the
    unified workspace so that all LLM tools operate on a single directory.
    """
    _LOGGER.info(
        "init_workspace start agent_instance_id=%s conversation_id=%s turn_id=%s project_id=%s agent_id=%s",
        agent_instance_id,
        conversation_id,
        turn_id,
        project_id,
        agent_id,
    )

    await asyncio.to_thread(
        _init_workspace_sync,
        agent_instance_id,
        username,
        turn_id,
        project_id,
        agent_id,
        attachments,
        options or WorkspaceInitOptions(),
        conversation_id,
    )

    _LOGGER.info(
        "init_workspace completed agent_instance_id=%s conversation_id=%s turn_id=%s",
        agent_instance_id,
        conversation_id,
        turn_id,
    )


def _init_workspace_sync(  # noqa: PLR0913
    agent_instance_id: int,
    username: str,
    turn_id: int,
    project_id: int,
    agent_id: str,
    attachments: list[Any] | None,
    options: WorkspaceInitOptions,
    conversation_id: int = 0,
) -> None:
    CHAT_FS.migrate_legacy_session(agent_instance_id, username, conversation_id)
    workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
    workspace.mkdir(parents=True, exist_ok=True)

    _copy_skills(workspace, project_id, agent_id)
    if options.include_knowledge:
        _copy_knowledge(workspace, project_id, agent_id)
    else:
        _clear_workspace_subdir(workspace, "knowledge")
        WorkspaceSourceRepository(workspace).replace_refs("knowledge/", ())
    _clear_workspace_subdir(workspace, "history")
    if options.include_history:
        _copy_rerun_sources_history(
            workspace,
            agent_instance_id,
            username,
            turn_id,
            conversation_id,
        )

    if CLEAN_TMP_ON_WORKSPACE_INIT:
        _clear_workspace_subdir(workspace, ".tmp")
    # ``results/`` (delegate task-runtime artifacts), the conversation-private
    # source repository, and legacy ``case_sources/`` are retained across turns. Their filenames are
    # content-/UUID-addressed so
    # collisions cannot occur, and keeping them lets read/context tools and the
    # parse_document cache surface prior-turn outputs without re-parsing.
    if options.include_playbooks:
        _copy_playbooks(workspace, agent_instance_id)
    else:
        _clear_workspace_subdir(workspace, "playbooks")
    _copy_attachments(
        workspace,
        attachments,
        retain_previous=options.retain_previous_attachments,
    )


def _clear_workspace_subdir(workspace: Path, name: str) -> None:
    path = workspace / name
    if path.exists():
        shutil.rmtree(path)


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------


def _copy_skills(workspace: Path, project_id: int, agent_id: str) -> None:
    skills_dir = workspace / "skills"
    # Clear previous snapshot
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    skills_dir.mkdir(parents=True, exist_ok=True)

    skill_dirs: list[tuple[int, Path]] = []
    for _, _, skill_root in SKILLS_FS.roots(project_id=project_id, agent_id=agent_id):
        if not skill_root.exists():
            continue
        for skill_dir in sorted(skill_root.iterdir()):
            if not skill_dir.is_dir():
                continue
            try:
                skill_id = int(skill_dir.name)
            except ValueError:
                continue
            skill_dirs.append((skill_id, latest_skill_version_dir(skill_dir)))

    _prune_staged_skill_runtimes(workspace, {skill_id for skill_id, _ in skill_dirs})

    index: list[dict[str, Any]] = []
    for skill_id, skill_dir in skill_dirs:
        dest = skills_dir / str(skill_id)
        _stage_skill_runtime_for_workspace(workspace, skill_id, skill_dir)
        source = skill_dir / RESOLVED_CORTEX_DIR
        if not source.exists():
            source = skill_dir / ORIGINAL_DIR
        if not source.exists():
            dest.mkdir(parents=True, exist_ok=True)
            source_skill_md = skill_dir / "SKILL.md"
            if source_skill_md.exists():
                shutil.copy2(source_skill_md, dest / "SKILL.md")
        else:
            shutil.copytree(source, dest, dirs_exist_ok=True)

        name = ""
        description = ""
        skill_md = dest / "SKILL.md"
        if skill_md.exists():
            try:
                meta = parse_skill_frontmatter(skill_md.read_text(encoding="utf-8"))
                name = meta.get("name", "")
                description = meta.get("description", "")
            except Exception as exc:
                _LOGGER.warning("Failed to parse SKILL.md for skill %s: %s", skill_id, exc)

        index.append(
            {
                "id": skill_id,
                "name": name,
                "description": description,
                "actions": _skill_actions_for_index(skill_dir),
            }
        )

    (skills_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    _LOGGER.info("Copied %d skills to workspace", len(index))


def _prune_staged_skill_runtimes(workspace: Path, active_skill_ids: set[int]) -> None:
    staged_skills_dir = workspace.parent / "skills"
    if not staged_skills_dir.is_dir():
        return
    for staged_skill_dir in staged_skills_dir.iterdir():
        if not staged_skill_dir.is_dir():
            continue
        try:
            skill_id = int(staged_skill_dir.name)
        except ValueError:
            continue
        if skill_id not in active_skill_ids:
            shutil.rmtree(staged_skill_dir)


def _stage_skill_runtime_for_workspace(workspace: Path, skill_id: int, skill_dir: Path) -> Path:
    staged_skill_root = workspace.parent / "skills" / str(skill_id)
    if staged_skill_root.exists():
        shutil.rmtree(staged_skill_root)
    staged_skill_root.mkdir(parents=True, exist_ok=True)

    runtime_source = skill_dir / ORIGINAL_DIR
    runtime_dest = staged_skill_root / "runtime"
    if runtime_source.exists():
        shutil.copytree(runtime_source, runtime_dest, dirs_exist_ok=True)
    else:
        shutil.copytree(skill_dir, runtime_dest, dirs_exist_ok=True)

    resolved_source = skill_dir / RESOLVED_DIR
    if resolved_source.exists():
        shutil.copytree(resolved_source, staged_skill_root / RESOLVED_DIR, dirs_exist_ok=True)
    return staged_skill_root


def _skill_actions_for_index(skill_dir: Path) -> list[dict[str, Any]]:
    try:
        actions = load_resolved_actions(skill_dir)
    except Exception:
        _LOGGER.warning("Failed to load resolved actions for skill index: %s", skill_dir, exc_info=True)
        return []
    indexed_actions: list[dict[str, Any]] = []
    for action in actions:
        required = infer_required_parameter_names(action)
        indexed_actions.append(
            {
                "name": action.name,
                "description": action.description,
                "infra_requirements": list(action.infra_requirements),
                "parameters": [
                    {**parameter.model_dump(), "required": parameter.name in required} for parameter in action.parameters
                ],
            }
        )
    return indexed_actions


# ---------------------------------------------------------------------------
# Knowledge
# ---------------------------------------------------------------------------


def _collect_knowledge_entries(
    fs: Any,
    project_id: int,
    agent_id: str,
    knowledge_type: str,
    knowledge_dir: Path,
    seen: set[int],
) -> tuple[list[int], list[dict[str, Any]]]:
    """Scan *fs* roots, copy directories into *knowledge_dir*, return (ids, index_entries)."""
    ids: list[int] = []
    entries: list[dict[str, Any]] = []
    for _, _, root in fs.roots(project_id=project_id, agent_id=agent_id):
        if not root.exists():
            continue
        for child in sorted(root.iterdir()):
            if not child.is_dir():
                continue
            try:
                item_id = int(child.name)
            except ValueError:
                continue
            if item_id in seen:
                continue
            seen.add(item_id)
            ids.append(item_id)
            shutil.copytree(child, knowledge_dir / str(item_id), dirs_exist_ok=True)
            entries.append({"id": item_id, "type": knowledge_type, "name": "", "tags": []})
    return ids, entries


def _copy_knowledge(workspace: Path, project_id: int, agent_id: str) -> None:
    knowledge_dir = workspace / "knowledge"
    if knowledge_dir.exists():
        shutil.rmtree(knowledge_dir)
    knowledge_dir.mkdir(parents=True, exist_ok=True)

    seen: set[int] = set()
    all_ids: list[int] = []
    index: list[dict[str, Any]] = []

    for fs, ktype in ((KNOWLEDGE_DOCUMENT_FS, "document"), (KNOWLEDGE_LINK_FS, "link")):
        ids, entries = _collect_knowledge_entries(fs, project_id, agent_id, ktype, knowledge_dir, seen)
        all_ids.extend(ids)
        index.extend(entries)

    # Hydrate metadata from backend
    if all_ids:
        try:
            metadata_map = ReverseKnowledgeService.get_instance().list_knowledge_metadata(all_ids)
            for entry in index:
                meta = metadata_map.get(entry["id"])
                if meta:
                    entry["name"] = meta.name or ""
                    entry["tags"] = list(meta.tags) if meta.tags else []
        except Exception as exc:
            _LOGGER.warning("Failed to fetch knowledge metadata: %s", exc)

    (knowledge_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    manifests = _index_tabular_tree(workspace, knowledge_dir)
    WorkspaceSourceRepository(workspace).replace_refs("knowledge/", manifests)
    _LOGGER.info("Copied %d knowledge items to workspace", len(index))


def _index_tabular_tree(workspace: Path, root: Path) -> tuple[SourceManifest, ...]:
    source_service = WorkspaceSourceService()
    manifests: list[SourceManifest] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or not is_supported_tabular_path(path):
            continue
        source_ref = path.relative_to(workspace).as_posix()
        try:
            manifests.append(source_service.index_path(workspace, source_ref, path))
        except Exception:  # noqa: BLE001 - source indexing is optional enrichment.
            _LOGGER.warning("Failed to index staged tabular source %s", source_ref, exc_info=True)
    return tuple(manifests)


def _copy_rerun_sources_history(
    workspace: Path,
    agent_instance_id: int,
    username: str,
    current_turn_id: int,
    conversation_id: int,
) -> int:
    copied = 0
    copied_sources = 0
    copied_bytes = 0
    turn_ids = CHAT_FS.list_turn_ids(agent_instance_id, username, conversation_id)
    for tid in sorted((turn_id for turn_id in turn_ids if turn_id < current_turn_id), reverse=True):
        if copied >= _HISTORY_TURN_COUNT or copied_sources >= RERUN_HISTORY_MAX_SOURCES:
            break
        source_dir = CHAT_FS.get_turn_path(agent_instance_id, username, tid, conversation_id) / RERUN_SOURCES_DIR
        if not source_dir.exists():
            continue
        dest = workspace / "history" / f"turn-{tid}" / RERUN_SOURCES_DIR
        copied_turn = False
        for source_path in sorted(source_dir.glob("*.json"), key=_rerun_source_mtime, reverse=True):
            try:
                size_bytes = source_path.stat().st_size
            except OSError:
                continue
            if size_bytes > RERUN_SOURCE_MAX_BYTES:
                continue
            if copied_sources >= RERUN_HISTORY_MAX_SOURCES or copied_bytes + size_bytes > RERUN_HISTORY_MAX_BYTES:
                break
            dest.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(source_path, dest / source_path.name)
            except OSError:
                continue
            copied_sources += 1
            copied_bytes += size_bytes
            copied_turn = True
        if copied_turn:
            copied += 1
    _LOGGER.info("Copied %d rerun source turns to workspace", copied)
    return copied


def _rerun_source_mtime(path: Path) -> int:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return -1


# ---------------------------------------------------------------------------
# Playbooks
# ---------------------------------------------------------------------------


def _section_to_filename(section: str) -> str:
    """Convert a playbook section name to a snake_case filename.

    Example: "Tool Prerequisites" -> "tool_prerequisites.md"
    """
    name = section.strip().lower()
    name = re.sub(r"[^a-z0-9]+", "_", name).strip("_")
    return f"{name}.md"


def _copy_playbooks(workspace: Path, agent_instance_id: int) -> None:
    playbooks_dir = workspace / "playbooks"
    if playbooks_dir.exists():
        shutil.rmtree(playbooks_dir)
    playbooks_dir.mkdir(parents=True, exist_ok=True)

    store = PlaybookStore()
    playbook = store.load(agent_instance_id)
    if playbook is None or not playbook.bullets():
        _LOGGER.info("No playbook found for agent_instance_id=%s", agent_instance_id)
        return

    # Write one file per section using playbook's own markdown renderer
    sections = sorted({b.section for b in playbook.bullets()})
    for section in sections:
        filename = _section_to_filename(section)
        (playbooks_dir / filename).write_text(
            playbook.as_markdown(section=section) + "\n",
            encoding="utf-8",
        )

    _LOGGER.info(
        "Copied %d playbook sections (%d bullets) to workspace",
        len(sections),
        len(playbook.bullets()),
    )


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


def _copy_attachments(
    workspace: Path,
    attachments: list[Any] | None,
    *,
    retain_previous: bool = False,
) -> None:
    attach_dir = workspace / "attachments"
    if not attachments:
        if retain_previous and attach_dir.exists():
            _LOGGER.info("Retained existing workspace attachments for later turns")
        elif attach_dir.exists():
            shutil.rmtree(attach_dir)
        index = _load_attachment_index(attach_dir) if attach_dir.exists() else {}
        _reconcile_attachment_refs(workspace, index)
        return

    if attach_dir.exists() and not retain_previous:
        shutil.rmtree(attach_dir)
    attach_dir.mkdir(parents=True, exist_ok=True)
    index = _load_attachment_index(attach_dir) if retain_previous else {}
    copied = 0
    manifests: list[SourceManifest] = []

    for attachment in attachments:
        name = _safe_attachment_name(getattr(attachment, "name", "") or "unnamed")
        att_type = getattr(attachment, "type", "") or ""
        # Skip image attachments — they're sent inline with the user message
        if att_type.lower().startswith("image"):
            continue

        sas_url = getattr(attachment, "sas_url", "") or getattr(attachment, "uri", "") or ""
        if not sas_url:
            continue

        try:
            resp = requests.get(str(sas_url), timeout=60)
            resp.raise_for_status()
            target = attach_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(resp.content)
            if is_supported_tabular_path(target):
                try:
                    manifests.append(WorkspaceSourceService().index_path(workspace, f"attachments/{name}", target))
                except Exception:  # noqa: BLE001 - source indexing is optional enrichment.
                    _LOGGER.warning("Failed to index tabular attachment %s", name, exc_info=True)
            # Save the SAS URL alongside the file for tools that need the original link
            url_file = attach_dir / f"{name}_url.txt"
            url_file.write_text(sas_url, encoding="utf-8")
            index[name] = {
                "name": name,
                "path": f"attachments/{name}",
                "url_path": f"attachments/{name}_url.txt",
                "type": att_type,
                "downloaded_at": int(time.time() * 1000),
            }
            copied += 1
        except Exception as exc:
            _LOGGER.warning("Failed to download attachment %s: %s", name, exc)

    _write_attachment_index(attach_dir, index)
    _reconcile_attachment_refs(workspace, index, newly_indexed=manifests)
    _LOGGER.info("Downloaded %d attachments to workspace", copied)


def _reconcile_attachment_refs(
    workspace: Path,
    index: dict[str, dict[str, Any]],
    *,
    newly_indexed: list[SourceManifest] | None = None,
) -> None:
    repository = WorkspaceSourceRepository(workspace)
    manifests = {manifest.source_ref: manifest for manifest in newly_indexed or ()}
    for item in index.values():
        source_ref = str(item.get("path") or "")
        source_path = workspace / source_ref
        if not source_ref.startswith("attachments/") or not source_path.is_file():
            continue
        manifest = manifests.get(source_ref) or repository.find(source_ref)
        if manifest is not None:
            manifests[source_ref] = manifest
    repository.replace_refs("attachments/", manifests.values())


def _load_attachment_index(attach_dir: Path) -> dict[str, dict[str, Any]]:
    index_path = attach_dir / "index.json"
    if not index_path.exists():
        return {}
    try:
        loaded = json.loads(index_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(loaded, list):
        return {}
    entries: dict[str, dict[str, Any]] = {}
    for item in loaded:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            entries[item["name"]] = item
    return entries


def _write_attachment_index(attach_dir: Path, index: dict[str, dict[str, Any]]) -> None:
    payload = sorted(index.values(), key=lambda item: str(item.get("name", "")))
    (attach_dir / "index.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _safe_attachment_name(name: str) -> str:
    safe = Path(name).name.strip()
    return safe or "unnamed"
