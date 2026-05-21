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

"""Workspace initialization for chat sessions.

Copies skills, knowledge, history, and attachments into the unified
workspace directory before a chat session starts.
"""

import asyncio
import json
import logging
import re
import shutil
from pathlib import Path
from typing import Any

import requests

from app.experiences.store import PlaybookStore
from app.storage.fs import (
    CHAT_FS,
    KNOWLEDGE_DOCUMENT_FS,
    KNOWLEDGE_LINK_FS,
    SKILLS_FS,
    parse_skill_frontmatter,
)
from app.biz.reverse_grpc.knowledge import ReverseKnowledgeService

_LOGGER = logging.getLogger(__name__)

_HISTORY_TURN_COUNT = 3


async def init_workspace(
    agent_instance_id: int,
    username: str,
    turn_id: int,
    project_id: int,
    agent_id: str,
    attachments: list[Any] | None = None,
) -> None:
    """Initialize the workspace directory for a chat session.

    Copies skills, knowledge, recent history, and user attachments into the
    unified workspace so that all LLM tools operate on a single directory.
    """
    _LOGGER.info(
        "init_workspace start agent_instance_id=%s turn_id=%s project_id=%s agent_id=%s",
        agent_instance_id,
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
    )

    _LOGGER.info("init_workspace completed agent_instance_id=%s turn_id=%s", agent_instance_id, turn_id)


def _init_workspace_sync(
    agent_instance_id: int,
    username: str,
    turn_id: int,
    project_id: int,
    agent_id: str,
    attachments: list[Any] | None,
) -> None:
    workspace = CHAT_FS.get_workspace_path(agent_instance_id, username)
    workspace.mkdir(parents=True, exist_ok=True)

    _copy_skills(workspace, project_id, agent_id)
    _copy_knowledge(workspace, project_id, agent_id)
    _copy_history(workspace, agent_instance_id, username, turn_id)
    _copy_playbooks(workspace, agent_instance_id)
    _copy_attachments(workspace, attachments)


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------


def _copy_skills(workspace: Path, project_id: int, agent_id: str) -> None:
    skills_dir = workspace / "skills"
    # Clear previous snapshot
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    skills_dir.mkdir(parents=True, exist_ok=True)

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

            dest = skills_dir / str(skill_id)
            shutil.copytree(skill_dir, dest, dirs_exist_ok=True)

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
                }
            )

    (skills_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    _LOGGER.info("Copied %d skills to workspace", len(index))


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
    _LOGGER.info("Copied %d knowledge items to workspace", len(index))


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


def _copy_history(workspace: Path, agent_instance_id: int, username: str, current_turn_id: int) -> None:
    history_dir = workspace / "history"
    if history_dir.exists():
        shutil.rmtree(history_dir)
    history_dir.mkdir(parents=True, exist_ok=True)

    turn_ids = CHAT_FS.list_turn_ids(agent_instance_id, username)
    # Exclude current turn, take last N
    past_turns = [t for t in turn_ids if t < current_turn_id]
    recent_turns = past_turns[-_HISTORY_TURN_COUNT:]

    for tid in recent_turns:
        turn_path = CHAT_FS._get_turn_path(agent_instance_id, username, tid)
        if not turn_path.exists():
            continue
        dest = history_dir / f"turn-{tid}"
        dest.mkdir(parents=True, exist_ok=True)

        # Copy plan.json
        plan = turn_path / "plan.json"
        if plan.exists():
            shutil.copy2(plan, dest / "plan.json")

        # Copy conversation.json
        conv = turn_path / "conversation.json"
        if conv.exists():
            shutil.copy2(conv, dest / "conversation.json")

        # Copy reports
        report_dir = turn_path / "report"
        if report_dir.exists():
            dest_report = dest / "report"
            shutil.copytree(report_dir, dest_report, dirs_exist_ok=True)

    _LOGGER.info("Copied %d history turns to workspace", len(recent_turns))


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


def _copy_attachments(workspace: Path, attachments: list[Any] | None) -> None:
    attach_dir = workspace / "attachments"
    # Clean up old attachments
    if attach_dir.exists():
        shutil.rmtree(attach_dir)

    if not attachments:
        return

    attach_dir.mkdir(parents=True, exist_ok=True)
    copied = 0

    for attachment in attachments:
        name = getattr(attachment, "name", "") or "unnamed"
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
            # Save the SAS URL alongside the file for tools that need the original link
            url_file = attach_dir / f"{name}_url.txt"
            url_file.write_text(sas_url, encoding="utf-8")
            copied += 1
        except Exception as exc:
            _LOGGER.warning("Failed to download attachment %s: %s", name, exc)

    _LOGGER.info("Downloaded %d attachments to workspace", copied)
