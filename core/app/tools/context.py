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

import asyncio
import json
import logging
import os
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_DEFAULT_MAX_FILES = int(os.getenv("CONTEXT_TOOL_MAX_FILES", "200"))


class ContextInput(BaseModel):
    directory: str | None = Field(
        default=None,
        description="Optional subdirectory to scope the file listing to (e.g. 'results/batch-1'). "
        "When omitted, lists from the workspace root.",
    )
    max_files: int | None = Field(
        default=None,
        description="Maximum number of individual files to return. "
        "When the listing exceeds this limit, a compact directory-tree summary is returned instead. "
        "Defaults to server-configured limit.",
    )
    include_skills: bool = Field(
        default=True,
        description="Whether to include the skills index in the response.",
    )
    include_knowledge: bool = Field(
        default=True,
        description="Whether to include the knowledge index in the response.",
    )


def _compact_file_tree(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse a flat file listing into a directory-tree summary with file counts and total sizes."""
    dir_stats: dict[str, dict[str, float | int]] = defaultdict(lambda: {"file_count": 0, "total_size_kb": 0.0})
    for f in files:
        parts = PurePosixPath(f["path"]).parts
        # Attribute to the top-level directory, or "(root)" for files at the workspace root.
        top_dir = parts[0] if len(parts) > 1 else "(root)"
        dir_stats[top_dir]["file_count"] += 1
        dir_stats[top_dir]["total_size_kb"] += f.get("size_kb", 0)
    tree: list[dict[str, Any]] = []
    for name in sorted(dir_stats):
        stats = dir_stats[name]
        entry: dict[str, Any] = {
            "directory": name,
            "file_count": int(stats["file_count"]),
            "total_size_kb": round(stats["total_size_kb"], 1),
        }
        tree.append(entry)
    return tree


def _load_index_json(path: Path) -> list[dict[str, Any]]:
    """Load a JSON array from *path*, returning [] on any failure."""
    if not path.exists():
        return []
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, list) else []
    except Exception:
        return []


def _enrich_knowledge_summaries(knowledge_list: list[dict[str, Any]], knowledge_dir: Path) -> None:
    """Attach ``summary`` text to each knowledge item that has a summary file."""
    for item in knowledge_list:
        knowledge_id = item.get("id")
        if knowledge_id is None:
            continue
        summary_path = knowledge_dir / f"{knowledge_id}" / "summary.md"
        if summary_path.exists():
            item["summary"] = summary_path.read_text(encoding="utf-8")


def load_workspace_context(  # noqa: PLR0913
    agent_instance_id: int,
    username: str,
    conversation_id: int = 0,
    retrieve_knowledge_summary: bool = False,
    *,
    directory: str | None = None,
    max_files: int | None = None,
    include_skills: bool = True,
    include_knowledge: bool = True,
) -> dict[str, Any]:
    workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
    if not workspace.exists():
        return {
            "files": [],
            "file_listing_mode": "full",
            "total_file_count": 0,
            "skills": [],
            "knowledge": [],
        }

    all_files = CHAT_FS.list_files(agent_instance_id, username, conversation_id)

    # Scope to subdirectory if requested.
    if directory:
        prefix = directory.rstrip("/") + "/"
        all_files = [f for f in all_files if f["path"].startswith(prefix) or f["path"] == directory.rstrip("/")]

    # Decide whether to return individual files or a compact tree summary.
    effective_max = max_files if max_files is not None else _DEFAULT_MAX_FILES
    if len(all_files) <= effective_max:
        files_result: Any = all_files
        file_listing_mode = "full"
    else:
        files_result = _compact_file_tree(all_files)
        file_listing_mode = "compact"

    skills_list = _load_index_json(workspace / "skills" / "index.json") if include_skills else []

    knowledge_list: list[dict[str, Any]] = []
    if include_knowledge:
        knowledge_list = _load_index_json(workspace / "knowledge" / "index.json")
        if retrieve_knowledge_summary and knowledge_list:
            _enrich_knowledge_summaries(knowledge_list, workspace / "knowledge")

    return {
        "files": files_result,
        "file_listing_mode": file_listing_mode,
        "total_file_count": len(all_files),
        "skills": skills_list,
        "knowledge": knowledge_list,
    }


async def _context_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {
            "error_message": "missing tool context",
            "files": [],
            "skills": [],
            "knowledge": [],
            "file_listing_mode": "full",
            "total_file_count": 0,
        }

    input_data = ContextInput(**kwargs)

    def _impl() -> dict[str, Any]:
        context = load_workspace_context(
            ctx.agent_instance_id,
            ctx.username,
            ctx.conversation_id,
            directory=input_data.directory,
            max_files=input_data.max_files,
            include_skills=input_data.include_skills,
            include_knowledge=input_data.include_knowledge,
        )
        result: dict[str, Any] = {
            "error_message": "",
            "files": context["files"],
            "file_listing_mode": context["file_listing_mode"],
            "total_file_count": context["total_file_count"],
        }
        if input_data.include_skills:
            result["skills"] = context["skills"]
        if input_data.include_knowledge:
            result["knowledge"] = context["knowledge"]
        return result

    try:
        return await asyncio.to_thread(_impl)
    except Exception as exc:
        _LOGGER.error("Context tool failed agent_instance_id=%s error=%s", ctx.agent_instance_id, exc)
        return {
            "error_message": str(exc),
            "files": [],
            "skills": [],
            "knowledge": [],
            "file_listing_mode": "full",
            "total_file_count": 0,
        }


CONTEXT_TOOL = FunctionTool(
    name="context",
    description=(
        "List files in the workspace directory (recursive). "
        "Think of it as the 'ls' command for the agent's current workspace. "
        "Returns file paths and sizes, plus optionally the skills and knowledge indexes. "
        "This is usually the first tool to call. "
        "Call it frequently to get an updated view of the workspace state, "
        "especially after using write_file, edit, or remove tools.\n\n"
        "**Response modes:**\n"
        "- When the file count is within the limit (default 200), returns individual file entries "
        "(`file_listing_mode='full'`).\n"
        "- When the file count exceeds the limit, returns a compact directory-tree summary with "
        "per-directory file counts and sizes (`file_listing_mode='compact'`). "
        "Use `directory` to drill into a specific subdirectory for its full listing.\n\n"
        "**Parameters:**\n"
        "- `directory` — scope listing to a subdirectory (e.g. 'results/batch-1').\n"
        "- `max_files` — override the file-count threshold for compact mode.\n"
        "- `include_skills` / `include_knowledge` — set to false to omit those sections and reduce response size.\n\n"
        "Notable top-level subfolders to look for in the listing:\n"
        "- `skills/` — staged skill bundles (one folder per skill id; metadata in `skills/index.json`).\n"
        "- `knowledge/` — staged knowledge docs (one folder per knowledge id; metadata in `knowledge/index.json`).\n"
        "- `playbooks/` — distilled rules/lessons grouped by section.\n"
        "- `attachments/` — files the user attached this turn (plus their original SAS URLs in `*_url.txt`).\n"
        "- `results/` — per-batch outputs produced by the `delegate` task tool. Each `results/<batch_id>/` "
        "folder holds the run records (status, payloads) and `results/<batch_id>/artifacts/` holds any "
        "files the runs produced. Use `read`/`grep` on these to inspect prior delegate runs.\n"
        "- `case_sources/parsed_documents/` — archived workbook / parsed-document manifests (`*.json`) and "
        "per-sheet JSONL case sources written by the workbook adapter when an attachment or `parse_document` "
        "call indexes a workbook. Each `<slug>.json` summarises the source and points at sibling `*.jsonl` "
        "files with the individual cases.\n"
        "- `history/turn-<id>/` — snapshots of prior turns (plan, conversation, reports, and prior "
        "`results/` + `case_sources/` snapshots if any). Hidden from this file listing — read explicitly when needed."
    ),
    additional_properties={"max_output_length": 50_000},
    input_model=ContextInput,
    func=_context_func,
)
