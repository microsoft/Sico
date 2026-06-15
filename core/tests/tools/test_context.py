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

from __future__ import annotations

import json
from pathlib import Path


from app.tools.context import (
    ContextInput,
    _compact_file_tree,
    load_workspace_context,
)


def _make_files(workspace: Path, paths: list[str], *, size_bytes: int = 1024) -> None:
    """Create dummy files under *workspace* for each relative path."""
    for rel in paths:
        p = workspace / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x" * size_bytes)


# ---------------------------------------------------------------------------
# _compact_file_tree
# ---------------------------------------------------------------------------


def test_compact_file_tree_groups_by_top_level_directory() -> None:
    files = [
        {"path": "results/batch-1/a.json", "size_kb": 10.0},
        {"path": "results/batch-1/b.json", "size_kb": 5.0},
        {"path": "results/batch-2/c.json", "size_kb": 3.0},
        {"path": "skills/001/SKILL.md", "size_kb": 1.0},
        {"path": "readme.txt", "size_kb": 0.5},
    ]
    tree = _compact_file_tree(files)
    by_dir = {e["directory"]: e for e in tree}

    assert set(by_dir.keys()) == {"results", "skills", "(root)"}
    assert by_dir["results"]["file_count"] == 3
    assert by_dir["results"]["total_size_kb"] == 18.0
    assert by_dir["skills"]["file_count"] == 1
    assert by_dir["(root)"]["file_count"] == 1


def test_compact_file_tree_empty() -> None:
    assert _compact_file_tree([]) == []


# ---------------------------------------------------------------------------
# load_workspace_context — full vs compact mode
# ---------------------------------------------------------------------------


def test_load_full_mode_when_few_files(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    _make_files(workspace, ["a.txt", "sub/b.txt"])

    monkeypatch.setattr("app.tools.context.CHAT_FS.get_workspace_path", lambda *_a: workspace)
    monkeypatch.setattr(
        "app.tools.context.CHAT_FS.list_files",
        lambda *_a: [{"path": "a.txt", "size_kb": 1.0}, {"path": "sub/b.txt", "size_kb": 2.0}],
    )

    result = load_workspace_context(1, "user", max_files=10)

    assert result["file_listing_mode"] == "full"
    assert result["total_file_count"] == 2
    assert len(result["files"]) == 2


def test_load_compact_mode_when_too_many_files(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)

    many_files = [{"path": f"results/file_{i}.json", "size_kb": 1.0} for i in range(50)]

    monkeypatch.setattr("app.tools.context.CHAT_FS.get_workspace_path", lambda *_a: workspace)
    monkeypatch.setattr("app.tools.context.CHAT_FS.list_files", lambda *_a: many_files)

    result = load_workspace_context(1, "user", max_files=10)

    assert result["file_listing_mode"] == "compact"
    assert result["total_file_count"] == 50
    assert isinstance(result["files"], list)
    assert result["files"][0].get("directory") is not None


# ---------------------------------------------------------------------------
# load_workspace_context — directory filtering
# ---------------------------------------------------------------------------


def test_load_scoped_to_directory(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)

    all_files = [
        {"path": "results/batch-1/a.json", "size_kb": 1.0},
        {"path": "results/batch-1/b.json", "size_kb": 2.0},
        {"path": "results/batch-2/c.json", "size_kb": 3.0},
        {"path": "skills/001/SKILL.md", "size_kb": 0.5},
    ]

    monkeypatch.setattr("app.tools.context.CHAT_FS.get_workspace_path", lambda *_a: workspace)
    monkeypatch.setattr("app.tools.context.CHAT_FS.list_files", lambda *_a: all_files)

    result = load_workspace_context(1, "user", directory="results/batch-1", max_files=100)

    assert result["file_listing_mode"] == "full"
    assert result["total_file_count"] == 2
    assert all("results/batch-1" in f["path"] for f in result["files"])


# ---------------------------------------------------------------------------
# load_workspace_context — include_skills / include_knowledge toggles
# ---------------------------------------------------------------------------


def test_load_excludes_skills_when_disabled(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    skills_dir = workspace / "skills"
    skills_dir.mkdir()
    (skills_dir / "index.json").write_text(json.dumps([{"id": 1, "name": "s1"}]), encoding="utf-8")

    monkeypatch.setattr("app.tools.context.CHAT_FS.get_workspace_path", lambda *_a: workspace)
    monkeypatch.setattr("app.tools.context.CHAT_FS.list_files", lambda *_a: [])

    result = load_workspace_context(1, "user", include_skills=False)
    assert result["skills"] == []

    result_with = load_workspace_context(1, "user", include_skills=True)
    assert len(result_with["skills"]) == 1


def test_load_excludes_knowledge_when_disabled(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    knowledge_dir = workspace / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "index.json").write_text(json.dumps([{"id": 1, "name": "k1"}]), encoding="utf-8")

    monkeypatch.setattr("app.tools.context.CHAT_FS.get_workspace_path", lambda *_a: workspace)
    monkeypatch.setattr("app.tools.context.CHAT_FS.list_files", lambda *_a: [])

    result = load_workspace_context(1, "user", include_knowledge=False)
    assert result["knowledge"] == []

    result_with = load_workspace_context(1, "user", include_knowledge=True)
    assert len(result_with["knowledge"]) == 1


# ---------------------------------------------------------------------------
# ContextInput validation
# ---------------------------------------------------------------------------


def test_context_input_defaults() -> None:
    inp = ContextInput()
    assert inp.directory is None
    assert inp.max_files is None
    assert inp.include_skills is True
    assert inp.include_knowledge is True


def test_context_input_with_values() -> None:
    inp = ContextInput(directory="results", max_files=50, include_skills=False, include_knowledge=False)
    assert inp.directory == "results"
    assert inp.max_files == 50
    assert inp.include_skills is False
    assert inp.include_knowledge is False
