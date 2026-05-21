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
from app.storage.fs import (
    KNOWLEDGE_DOCUMENT_FS,
    KNOWLEDGE_LINK_FS,
    SKILLS_FS,
    parse_skill_frontmatter,
)

_LOGGER = logging.getLogger(__name__)

def get_skills_index(project_id: int, agent_id: str) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []

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

            skill_md = skill_dir / "SKILL.md"
            meta = parse_skill_frontmatter(skill_md.read_text(encoding="utf-8"))
            name = meta.get("name", "")
            description = meta.get("description", "")

            index.append({
                "id": skill_id,
                "name": name,
                "description": description,
            })

    return index

def get_knowledge_document_index(project_id: int, agent_id: str, retrieve_summary: bool = False) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []

    for _, _, doc_root in KNOWLEDGE_DOCUMENT_FS.roots(project_id=project_id, agent_id=agent_id):
        if not doc_root.exists():
            continue
        for doc_dir in sorted(doc_root.iterdir()):
            if not doc_dir.is_dir():
                continue
            try:
                doc_id = int(doc_dir.name)
            except ValueError:
                continue

            item = {
                "id": doc_id,
                "type": "document",
                "name": "",
                "tags": [],
            }
            if retrieve_summary:
                summary_path = doc_dir / "summary.md"
                if summary_path.exists():
                    summary = summary_path.read_text(encoding="utf-8")
                    item["summary"] = summary
            index.append(item)

    return index

def get_knowledge_link_index(project_id: int, agent_id: str, retrieve_summary: bool = False) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []

    for _, _, link_root in KNOWLEDGE_LINK_FS.roots(project_id=project_id, agent_id=agent_id):
        if not link_root.exists():
            continue
        for link_dir in sorted(link_root.iterdir()):
            if not link_dir.is_dir():
                continue
            try:
                link_id = int(link_dir.name)
            except ValueError:
                continue

            item = {
                "id": link_id,
                "type": "link",
                "name": "",
                "tags": [],
            }
            if retrieve_summary:
                summary_path = link_dir / "summary.md"
                if summary_path.exists():
                    summary = summary_path.read_text(encoding="utf-8")
                    item["summary"] = summary
            index.append(item)

    return index

def get_knowledge_index(project_id: int, agent_id: str, retrieve_summary: bool = False) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []

    all_ids: list[int] = []
    seen: set[int] = set()

    # --- document knowledge ---
    document_index = get_knowledge_document_index(project_id, agent_id, retrieve_summary=retrieve_summary)
    for item in document_index:
        doc_id = item["id"]
        if doc_id not in seen:
            seen.add(doc_id)
            all_ids.append(doc_id)
        index.append(item)


    # --- link knowledge ---
    link_index = get_knowledge_link_index(project_id, agent_id, retrieve_summary=retrieve_summary)
    for item in link_index:
        link_id = item["id"]
        if link_id not in seen:
            seen.add(link_id)
            all_ids.append(link_id)
        index.append(item)

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
    project_id: int,
    agent_id: str,
    retrieve_knowledge_summary: bool = False
) -> dict[str, list[dict[str, Any]]]:
    skills = get_skills_index(project_id, agent_id)
    knowledge = get_knowledge_index(project_id, agent_id, retrieve_summary=retrieve_knowledge_summary)
    return {
        "skills": skills,
        "knowledge": knowledge,
    }
