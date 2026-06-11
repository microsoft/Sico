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

import logging
from typing import Any

from app.biz.reverse_grpc.knowledge import ReverseKnowledgeService
from app.biz.skill.paths import skill_cortex_dir
from app.storage.fs import (
    KNOWLEDGE_DOCUMENT_FS,
    KNOWLEDGE_LINK_FS,
    SKILLS_FS,
    parse_skill_frontmatter,
)

_LOGGER = logging.getLogger(__name__)


_MAX_SKILLS = 30
_MAX_KNOWLEDGE = 30
_MAX_SKILL_DESCRIPTION_CHARS = 600
_MAX_KNOWLEDGE_SUMMARY_CHARS = 1200
_CONTEXT_SCOPE_PRIORITY = {
    "agent_instance": 0,
    "agent": 1,
    "project": 2,
}


def _truncate_text(value: str, limit: int) -> str:
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + "..."


def _limit_reached(items: list[dict[str, Any]], limit: int | None) -> bool:
    return limit is not None and len(items) >= limit


def _read_text(path, *, description: str) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        _LOGGER.warning("Failed to read %s: path=%s err=%s", description, path, exc)
        return None


def _context_roots(storage_fs, *, project_id: int, agent_id: str):
    roots = storage_fs.roots(project_id=project_id, agent_id=agent_id)
    return sorted(roots, key=lambda root: (_CONTEXT_SCOPE_PRIORITY.get(root[0], 99), str(root[1])))


def _group_roots_by_scope(roots):
    grouped = {}
    for scope_name, scope_id, root_path in roots:
        grouped.setdefault((scope_name, scope_id), []).append((scope_name, scope_id, root_path))
    return grouped


def _ordered_scope_keys(*groups):
    keys = set()
    for group in groups:
        keys.update(group.keys())
    return sorted(keys, key=lambda key: (_CONTEXT_SCOPE_PRIORITY.get(key[0], 99), str(key[1])))


def _compact_skill(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", 0),
        "name": item.get("name", ""),
        "description": _truncate_text(str(item.get("description", "")), _MAX_SKILL_DESCRIPTION_CHARS),
    }


def _compact_knowledge(item: dict[str, Any]) -> dict[str, Any]:
    compacted = {
        "id": item.get("id", 0),
        "type": item.get("type", ""),
        "name": item.get("name", ""),
        "tags": item.get("tags", []),
    }
    summary = str(item.get("summary", "")).strip()
    if summary:
        compacted["summary"] = _truncate_text(summary, _MAX_KNOWLEDGE_SUMMARY_CHARS)
    return compacted


def get_skills_index(project_id: int, agent_id: str, limit: int | None = None) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []

    for _, _, skill_root in _context_roots(SKILLS_FS, project_id=project_id, agent_id=agent_id):
        if not skill_root.exists():
            continue
        for skill_dir in sorted(skill_root.iterdir()):
            if _limit_reached(index, limit):
                return index
            if not skill_dir.is_dir():
                continue
            try:
                skill_id = int(skill_dir.name)
            except ValueError:
                continue

            skill_md = skill_cortex_dir(skill_dir) / "SKILL.md"
            skill_content = _read_text(skill_md, description="skill frontmatter")
            if skill_content is None:
                continue

            meta = parse_skill_frontmatter(skill_content)
            name = meta.get("name", "")
            description = meta.get("description", "")

            index.append(
                {
                    "id": skill_id,
                    "name": name,
                    "description": description,
                }
            )

    return index


def _collect_knowledge_from_roots(
    roots, *, knowledge_type: str, retrieve_summary: bool, limit: int | None
) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []

    for _, _, knowledge_root in roots:
        if not knowledge_root.exists():
            continue
        for knowledge_dir in sorted(knowledge_root.iterdir()):
            if _limit_reached(index, limit):
                return index
            if not knowledge_dir.is_dir():
                continue
            try:
                knowledge_id = int(knowledge_dir.name)
            except ValueError:
                continue

            item = {
                "id": knowledge_id,
                "type": knowledge_type,
                "name": "",
                "tags": [],
            }
            if retrieve_summary:
                summary_path = knowledge_dir / "summary.md"
                if summary_path.exists():
                    summary = _read_text(summary_path, description=f"knowledge {knowledge_type} summary")
                    if summary is not None:
                        item["summary"] = summary
            index.append(item)

    return index


def get_knowledge_document_index(
    project_id: int, agent_id: str, retrieve_summary: bool = False, limit: int | None = None
) -> list[dict[str, Any]]:
    return _collect_knowledge_from_roots(
        _context_roots(KNOWLEDGE_DOCUMENT_FS, project_id=project_id, agent_id=agent_id),
        knowledge_type="document",
        retrieve_summary=retrieve_summary,
        limit=limit,
    )


def get_knowledge_link_index(
    project_id: int, agent_id: str, retrieve_summary: bool = False, limit: int | None = None
) -> list[dict[str, Any]]:
    return _collect_knowledge_from_roots(
        _context_roots(KNOWLEDGE_LINK_FS, project_id=project_id, agent_id=agent_id),
        knowledge_type="link",
        retrieve_summary=retrieve_summary,
        limit=limit,
    )


def get_knowledge_index(
    project_id: int, agent_id: str, retrieve_summary: bool = False, limit: int | None = None
) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []

    all_ids: list[int] = []
    seen: set[int] = set()

    document_roots_by_scope = _group_roots_by_scope(
        _context_roots(KNOWLEDGE_DOCUMENT_FS, project_id=project_id, agent_id=agent_id)
    )
    link_roots_by_scope = _group_roots_by_scope(_context_roots(KNOWLEDGE_LINK_FS, project_id=project_id, agent_id=agent_id))

    for scope_key in _ordered_scope_keys(document_roots_by_scope, link_roots_by_scope):
        for roots, knowledge_type in (
            (document_roots_by_scope.get(scope_key, []), "document"),
            (link_roots_by_scope.get(scope_key, []), "link"),
        ):
            remaining = None if limit is None else max(limit - len(index), 0)
            if remaining == 0:
                break

            for item in _collect_knowledge_from_roots(
                roots,
                knowledge_type=knowledge_type,
                retrieve_summary=retrieve_summary,
                limit=remaining,
            ):
                knowledge_id = item["id"]
                if knowledge_id not in seen:
                    seen.add(knowledge_id)
                    all_ids.append(knowledge_id)
                index.append(item)

        if _limit_reached(index, limit):
            break

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

    return index


def get_skill_knowledge_context(
    project_id: int, agent_id: str, retrieve_knowledge_summary: bool = False
) -> dict[str, list[dict[str, Any]]]:
    skills = get_skills_index(project_id, agent_id, limit=_MAX_SKILLS)
    knowledge = get_knowledge_index(project_id, agent_id, retrieve_summary=retrieve_knowledge_summary, limit=_MAX_KNOWLEDGE)
    return {
        "skills": [_compact_skill(item) for item in skills],
        "knowledge": [_compact_knowledge(item) for item in knowledge],
    }
