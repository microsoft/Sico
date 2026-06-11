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

from app.biz.chat.adapters.workbook.archive import (
    CASE_SOURCES_DIR,
    PARSED_DOCUMENTS_DIR,
    extract_case_ids,
    _archive_workbook_case_sources,
)
from app.biz.chat.adapters.workbook.manifests import (
    CaseIntent,
    CaseSourcePreference,
    infer_case_intent,
    infer_source_preference,
    is_prior_workbook_execution_reference,
    prior_case_source_manifest_paths,
    render_prior_parsed_workbook_sources_section,
    render_case_source_resolution_section,
    resolve_case_sources,
)


def test_extract_case_ids_deduplicates_and_normalizes() -> None:
    assert extract_case_ids("stcaqa-567 and STCAQA-567, ABC-1") == ("STCAQA-567", "ABC-1")


def test_intent_and_source_preference_are_separate() -> None:
    assert infer_case_intent("STCAQA-567的内容是什么？") is CaseIntent.INSPECT
    assert infer_source_preference("STCAQA-567的内容是什么？") is CaseSourcePreference.UNSPECIFIED
    assert infer_case_intent("请执行STCAQA-567这条case") is CaseIntent.EXECUTE
    assert infer_source_preference("Project Knowledge 里的 STCAQA-567 内容") is CaseSourcePreference.PROJECT_KNOWLEDGE


def test_resolve_case_sources_marks_project_and_history_ambiguous(tmp_path: Path) -> None:
    _write_knowledge_index(tmp_path)
    _write_history_manifest(tmp_path, case_ids=["STCAQA-567"])

    resolution = resolve_case_sources(tmp_path, "STCAQA-567的内容是什么？")

    assert resolution is not None
    assert resolution.intent is CaseIntent.INSPECT
    assert resolution.source_preference is CaseSourcePreference.UNSPECIFIED
    assert resolution.ambiguous
    assert {candidate.source_type for candidate in resolution.candidates} == {"project_knowledge", "history_attachment"}


def test_render_case_source_section_forbids_historical_parse(tmp_path: Path) -> None:
    _write_knowledge_index(tmp_path)
    _write_history_manifest(tmp_path, case_ids=["STCAQA-567"])

    section = render_case_source_resolution_section(tmp_path, "STCAQA-567的内容是什么？")

    assert "Case source resolver context" in section
    assert "history/turn-7/case_sources/parsed_documents/cases.md" in section
    assert "Do not call parse_document for historical attachments" in section
    assert '"ambiguous": true' in section


def test_project_knowledge_candidate_lists_workbook_paths(tmp_path: Path) -> None:
    _write_knowledge_index(tmp_path)
    source_dir = tmp_path / "knowledge" / "1" / "original"
    source_dir.mkdir(parents=True)
    (source_dir / "cases.xlsx").write_bytes(b"workbook")

    resolution = resolve_case_sources(tmp_path, "请执行 Project Knowledge 里的 STCAQA-567")

    assert resolution is not None
    project_candidates = [candidate for candidate in resolution.candidates if candidate.source_type == "project_knowledge"]
    assert len(project_candidates) == 1
    assert project_candidates[0].paths == ("knowledge/1/original/cases.xlsx",)
    assert project_candidates[0].confidence == "workbook_path"


def test_render_prior_parsed_workbook_sources_for_sheet_followup(tmp_path: Path) -> None:
    source_dir = tmp_path / "history" / "turn-7" / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
    source_dir.mkdir(parents=True)
    (source_dir / "cases__sheet_rewritten_userdata.jsonl").write_text(
        json.dumps({"title": "case one"}),
        encoding="utf-8",
    )
    (source_dir / "cases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "source": "parse_document",
                "file_path": "attachments/rewritten_edge_case 1.xlsx",
                "workbook_manifest": {
                    "sheets": [
                        {"name": "summary", "kind": "summary", "data_rows": 20},
                        {"name": "rewritten_userdata", "kind": "data", "data_rows": 36},
                    ]
                },
                "workbook_case_sources": [
                    {
                        "sheet_name": "rewritten_userdata",
                        "kind": "data",
                        "case_count": 36,
                        "case_source_path": "cases__sheet_rewritten_userdata.jsonl",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    section = render_prior_parsed_workbook_sources_section(tmp_path, "跑rewritten_userdata")

    assert "Prior parsed workbook sources available" in section
    assert "workbook_cases.source_path" in section
    assert "rewritten_userdata" in section
    assert "history/turn-7/case_sources/parsed_documents/cases__sheet_rewritten_userdata.jsonl" in section


def test_render_prior_parsed_workbook_sources_for_localized_sheet_followup(tmp_path: Path) -> None:
    source_dir = tmp_path / "history" / "turn-7" / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
    source_dir.mkdir(parents=True)
    (source_dir / "cases__sheet_user_data.jsonl").write_text(json.dumps({"title": "case one"}), encoding="utf-8")
    (source_dir / "cases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "source": "workbook_attachment",
                "file_path": "attachments/cases.xlsx",
                "workbook_manifest": {"sheets": [{"name": "用户数据", "kind": "data", "data_rows": 2}]},
                "workbook_case_sources": [
                    {
                        "sheet_name": "用户数据",
                        "kind": "data",
                        "case_count": 2,
                        "case_source_path": "cases__sheet_user_data.jsonl",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    section = render_prior_parsed_workbook_sources_section(tmp_path, "跑 用户数据")

    assert "Prior parsed workbook sources available" in section
    assert "用户数据" in section


def test_prior_workbook_reference_uses_turn_store_for_generic_sheet_name(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    source_dir = workspace / "history" / "turn-7" / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
    source_dir.mkdir(parents=True)
    (source_dir / "cases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "file_path": "attachments/cases.xlsx",
                "workbook_manifest": {"sheets": [{"name": "用户数据", "kind": "data", "data_rows": 2}]},
                "workbook_case_sources": [{"sheet_name": "用户数据", "case_count": 2, "case_source_path": "cases.jsonl"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "app.biz.chat.adapters.workbook.manifests.CHAT_FS.get_workspace_path",
        lambda _agent_instance_id, _username: workspace,
    )

    assert is_prior_workbook_execution_reference(
        agent_instance_id=1,
        username="alice",
        current_turn_id=11,
        message="跑 用户数据",
    )


def test_prior_case_source_manifest_paths_sort_turns_numerically(tmp_path: Path) -> None:
    for turn_id in (9, 10):
        source_dir = tmp_path / "history" / f"turn-{turn_id}" / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
        source_dir.mkdir(parents=True)
        (source_dir / "cases.json").write_text("{}", encoding="utf-8")

    paths = prior_case_source_manifest_paths(tmp_path)

    assert [path.parts[-4] for path in paths] == ["turn-10", "turn-9"]


def test_archive_workbook_case_sources_avoids_sheet_filename_collisions(tmp_path: Path) -> None:
    archived = _archive_workbook_case_sources(
        tmp_path,
        "cases",
        [
            {"sheet_name": "登录/用例", "cases": [{"case_id": "QA-1"}]},
            {"sheet_name": "登录_用例", "cases": [{"case_id": "QA-2"}]},
        ],
    )

    source_names = [source["case_source_path"] for source in archived]
    assert len(source_names) == len(set(source_names))
    assert [json.loads((tmp_path / source_name).read_text(encoding="utf-8"))["case_id"] for source_name in source_names] == [
        "QA-1",
        "QA-2",
    ]


def test_history_document_candidates_ignore_empty_case_id_indexes(tmp_path: Path) -> None:
    _write_history_manifest(tmp_path, case_ids=[])

    resolution = resolve_case_sources(tmp_path, "QA-567的内容是什么？")

    assert resolution is not None
    assert resolution.candidates == ()


def test_render_prior_parsed_workbook_sources_ignores_unstructured_legacy_manifest(tmp_path: Path) -> None:
    source_dir = tmp_path / "history" / "turn-7" / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
    source_dir.mkdir(parents=True)
    (source_dir / "legacy.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "source": "parse_document",
                "file_path": "attachments/rewritten_edge_case 1.xlsx",
                "workbook_manifest": {"sheets": [{"name": "rewritten_userdata", "kind": "data", "data_rows": 36}]},
                "workbook_case_sources": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    section = render_prior_parsed_workbook_sources_section(tmp_path, "跑rewritten_userdata")

    assert section == ""


def _write_knowledge_index(workspace: Path) -> None:
    knowledge_dir = workspace / "knowledge"
    knowledge_dir.mkdir(parents=True)
    (knowledge_dir / "index.json").write_text(json.dumps([{"id": 1, "name": "case library"}]), encoding="utf-8")


def _write_history_manifest(workspace: Path, *, case_ids: list[str]) -> None:
    source_dir = workspace / "history" / "turn-7" / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
    source_dir.mkdir(parents=True)
    (source_dir / "cases.md").write_text("STCAQA-567: expected content", encoding="utf-8")
    (source_dir / "cases.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "source": "parse_document",
                "file_path": "attachments/cases.xlsx",
                "archived_markdown_path": "cases.md",
                "case_ids": case_ids,
                "content_truncated": False,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
