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

from pathlib import Path
from types import SimpleNamespace

import pytest_mock

from app.biz.chat import context


def _write_skill(root: Path, skill_id: int, *, name: str) -> None:
    skill_dir = root / f"{skill_id:03d}"
    skill_dir.mkdir(parents=True)
    skill_dir.joinpath("SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n",
        encoding="utf-8",
    )


def _write_versioned_skill(root: Path, skill_id: int, *, version: str, name: str) -> None:
    skill_dir = root / f"{skill_id:03d}" / "versions" / version
    (skill_dir / "resolved" / "cortex").mkdir(parents=True)
    (skill_dir / "resolved" / "cortex" / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n",
        encoding="utf-8",
    )


def _write_knowledge(root: Path, knowledge_id: int, *, summary: str) -> None:
    knowledge_dir = root / f"{knowledge_id:03d}"
    knowledge_dir.mkdir(parents=True)
    knowledge_dir.joinpath("summary.md").write_text(summary, encoding="utf-8")


def test_get_skills_index_limits_and_skips_unreadable_skill(tmp_path: Path, mocker: pytest_mock.MockerFixture) -> None:
    skill_root = tmp_path / "skills"
    skill_root.mkdir()
    (skill_root / "001").mkdir()
    for skill_id in range(2, 6):
        _write_skill(skill_root, skill_id, name=f"skill-{skill_id}")

    mocker.patch.object(context.SKILLS_FS, "roots", return_value=[("project", 1, skill_root)])

    skills = context.get_skills_index(project_id=1, agent_id="agent-1", limit=3)

    assert [skill["id"] for skill in skills] == [2, 3, 4]
    assert [skill["name"] for skill in skills] == ["skill-2", "skill-3", "skill-4"]


def test_get_skills_index_prioritizes_agent_scope_within_limit(tmp_path: Path, mocker: pytest_mock.MockerFixture) -> None:
    project_skill_root = tmp_path / "project-skills"
    agent_skill_root = tmp_path / "agent-skills"
    project_skill_root.mkdir()
    agent_skill_root.mkdir()
    for skill_id in range(1, 5):
        _write_skill(project_skill_root, skill_id, name=f"project-skill-{skill_id}")
    _write_skill(agent_skill_root, 101, name="agent-skill-101")
    _write_skill(agent_skill_root, 102, name="agent-skill-102")

    mocker.patch.object(
        context.SKILLS_FS,
        "roots",
        return_value=[("project", 1, project_skill_root), ("agent", "agent-1", agent_skill_root)],
    )

    skills = context.get_skills_index(project_id=1, agent_id="agent-1", limit=3)

    assert [skill["name"] for skill in skills] == ["agent-skill-101", "agent-skill-102", "project-skill-1"]


def test_get_skills_index_reads_latest_versioned_skill(tmp_path: Path, mocker: pytest_mock.MockerFixture) -> None:
    skill_root = tmp_path / "skills"
    skill_root.mkdir()
    _write_versioned_skill(skill_root, 1, version="1000", name="selected-version")
    _write_versioned_skill(skill_root, 1, version="9999", name="later-sorting-version")
    (skill_root / "001" / "current_version.txt").write_text("1000", encoding="utf-8")

    mocker.patch.object(context.SKILLS_FS, "roots", return_value=[("project", 1, skill_root)])

    skills = context.get_skills_index(project_id=1, agent_id="agent-1")

    assert skills == [{"id": 1, "name": "selected-version", "description": "selected-version description"}]


def test_get_knowledge_index_limits_before_summary_and_metadata(tmp_path: Path, mocker: pytest_mock.MockerFixture) -> None:
    doc_root = tmp_path / "documents"
    link_root = tmp_path / "links"
    doc_root.mkdir()
    link_root.mkdir()
    for knowledge_id in range(1, 6):
        _write_knowledge(doc_root, knowledge_id, summary=f"document summary {knowledge_id}")
    _write_knowledge(link_root, 1, summary="link summary 1")

    read_summary_paths: list[Path] = []
    original_read_text = Path.read_text

    def read_text_spy(path: Path, *args, **kwargs):
        if path.name == "summary.md":
            read_summary_paths.append(path)
        return original_read_text(path, *args, **kwargs)

    metadata_ids: list[int] = []

    def list_knowledge_metadata(ids: list[int]):
        metadata_ids.extend(ids)
        return {knowledge_id: SimpleNamespace(name=f"knowledge-{knowledge_id}", tags=[]) for knowledge_id in ids}

    mocker.patch.object(Path, "read_text", read_text_spy)
    mocker.patch.object(context.KNOWLEDGE_DOCUMENT_FS, "roots", return_value=[("project", 1, doc_root)])
    mocker.patch.object(context.KNOWLEDGE_LINK_FS, "roots", return_value=[("project", 1, link_root)])
    mocker.patch.object(
        context.ReverseKnowledgeService,
        "get_instance",
        return_value=SimpleNamespace(list_knowledge_metadata=list_knowledge_metadata),
    )

    knowledge = context.get_knowledge_index(project_id=1, agent_id="agent-1", retrieve_summary=True, limit=3)

    assert [item["id"] for item in knowledge] == [1, 2, 3]
    assert [item["summary"] for item in knowledge] == ["document summary 1", "document summary 2", "document summary 3"]
    assert metadata_ids == [1, 2, 3]
    assert read_summary_paths == [
        doc_root / "001" / "summary.md",
        doc_root / "002" / "summary.md",
        doc_root / "003" / "summary.md",
    ]


def test_get_knowledge_index_prioritizes_agent_scope_before_project_scope(
    tmp_path: Path, mocker: pytest_mock.MockerFixture
) -> None:
    project_doc_root = tmp_path / "project-documents"
    agent_link_root = tmp_path / "agent-links"
    project_doc_root.mkdir()
    agent_link_root.mkdir()
    for knowledge_id in range(1, 5):
        _write_knowledge(project_doc_root, knowledge_id, summary=f"project document summary {knowledge_id}")
    _write_knowledge(agent_link_root, 101, summary="agent link summary 101")

    metadata_ids: list[int] = []

    def list_knowledge_metadata(ids: list[int]):
        metadata_ids.extend(ids)
        return {knowledge_id: SimpleNamespace(name=f"knowledge-{knowledge_id}", tags=[]) for knowledge_id in ids}

    mocker.patch.object(
        context.KNOWLEDGE_DOCUMENT_FS,
        "roots",
        return_value=[("project", 1, project_doc_root)],
    )
    mocker.patch.object(
        context.KNOWLEDGE_LINK_FS,
        "roots",
        return_value=[("project", 1, tmp_path / "missing-project-links"), ("agent", "agent-1", agent_link_root)],
    )
    mocker.patch.object(
        context.ReverseKnowledgeService,
        "get_instance",
        return_value=SimpleNamespace(list_knowledge_metadata=list_knowledge_metadata),
    )

    knowledge = context.get_knowledge_index(project_id=1, agent_id="agent-1", retrieve_summary=True, limit=3)

    assert [(item["type"], item["id"]) for item in knowledge] == [("link", 101), ("document", 1), ("document", 2)]
    assert [item["summary"] for item in knowledge] == [
        "agent link summary 101",
        "project document summary 1",
        "project document summary 2",
    ]
    assert metadata_ids == [101, 1, 2]
