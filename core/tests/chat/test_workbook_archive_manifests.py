from __future__ import annotations

import json
from pathlib import Path

from app.biz.chat.source_context import (
    CaseIntent,
    CaseSourcePreference,
    infer_case_intent,
    infer_source_preference,
    render_prior_tabular_sources_section,
    render_case_source_resolution_section,
    render_available_source_manifests_section,
    resolve_case_sources,
)
from app.biz.source.persistence.legacy.workbook_case_snapshot_v1 import (
    LEGACY_CASE_SOURCES_DIR as CASE_SOURCES_DIR,
    LEGACY_PARSED_DOCUMENTS_DIR as PARSED_DOCUMENTS_DIR,
    extract_case_ids,
    legacy_manifest_paths,
)
from app.biz.source import WorkspaceSourceService


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


def test_current_attachment_does_not_hide_same_named_knowledge_source(tmp_path: Path) -> None:
    attachments = tmp_path / "attachments"
    knowledge = tmp_path / "knowledge" / "42"
    attachments.mkdir()
    knowledge.mkdir(parents=True)
    current = attachments / "cases.csv"
    historical = knowledge / "cases.csv"
    current.write_text("Case ID\nCUR-1\n", encoding="utf-8")
    historical.write_text("Case ID\nQA-1\n", encoding="utf-8")
    (attachments / "index.json").write_text(
        json.dumps([{"name": "cases.csv", "path": "attachments/cases.csv"}]),
        encoding="utf-8",
    )
    service = WorkspaceSourceService()
    service.index_path(tmp_path, "attachments/cases.csv", current)
    service.index_path(tmp_path, "knowledge/42/cases.csv", historical)

    resolution = resolve_case_sources(tmp_path, "QA-1的内容是什么？", current_attachment_names=("cases.csv",))

    assert resolution is not None
    assert any(candidate.paths == ("knowledge/42/cases.csv",) for candidate in resolution.candidates)


def test_source_manifest_section_includes_indexed_knowledge(tmp_path: Path) -> None:
    source = tmp_path / "knowledge" / "42" / "cases.csv"
    source.parent.mkdir(parents=True)
    source.write_text("Case ID,Steps\nQA-1,Open app\n", encoding="utf-8")
    WorkspaceSourceService().index_path(tmp_path, "knowledge/42/cases.csv", source)

    section = render_available_source_manifests_section(tmp_path, ())

    assert "Source manifests available" in section
    assert "knowledge/42/cases.csv" in section
    assert '"name": "table"' in section


def test_render_case_source_section_forbids_historical_parse(tmp_path: Path) -> None:
    _write_knowledge_index(tmp_path)
    _write_history_manifest(tmp_path, case_ids=["STCAQA-567"])

    section = render_case_source_resolution_section(tmp_path, "STCAQA-567的内容是什么？")

    assert "Case source resolver context" in section
    assert "history/turn-7/case_sources/parsed_documents/cases.md" in section
    assert "Do not call parse_document for historical attachments" in section
    assert '"ambiguous": true' in section


def test_project_knowledge_candidate_lists_tabular_paths(tmp_path: Path) -> None:
    _write_knowledge_index(tmp_path)
    source_dir = tmp_path / "knowledge" / "1" / "original"
    source_dir.mkdir(parents=True)
    (source_dir / "cases.xlsx").write_bytes(b"workbook")

    resolution = resolve_case_sources(tmp_path, "请执行 Project Knowledge 里的 STCAQA-567")

    assert resolution is not None
    project_candidates = [candidate for candidate in resolution.candidates if candidate.source_type == "project_knowledge"]
    assert len(project_candidates) == 1
    assert project_candidates[0].paths == ("knowledge/1/original/cases.xlsx",)
    assert project_candidates[0].confidence == "tabular_path"


def test_render_prior_tabular_sources_for_sheet_followup(tmp_path: Path) -> None:
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

    section = render_prior_tabular_sources_section(tmp_path, "跑rewritten_userdata")

    assert "Prior indexed tabular sources available" in section
    assert "type=tabular document source_ref" in section
    assert "rewritten_userdata" in section
    assert "history/turn-7/case_sources/parsed_documents/cases__sheet_rewritten_userdata.jsonl" in section


def test_render_prior_tabular_sources_for_localized_sheet_followup(tmp_path: Path) -> None:
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

    section = render_prior_tabular_sources_section(tmp_path, "跑 用户数据")

    assert "Prior indexed tabular sources available" in section
    assert "用户数据" in section


def test_legacy_manifest_paths_sort_turns_numerically(tmp_path: Path) -> None:
    for turn_id in (9, 10):
        source_dir = tmp_path / "history" / f"turn-{turn_id}" / CASE_SOURCES_DIR / PARSED_DOCUMENTS_DIR
        source_dir.mkdir(parents=True)
        (source_dir / "cases.json").write_text("{}", encoding="utf-8")

    paths = legacy_manifest_paths(tmp_path)

    assert [path.parts[-4] for path in paths] == ["turn-10", "turn-9"]


def test_source_snapshot_avoids_sheet_filename_collisions(tmp_path: Path) -> None:
    source = tmp_path / "cases.jsonl"
    source.write_text(
        "\n".join(
            (
                json.dumps({"sheet_name": "登录/用例", "values": {"Case ID": "QA-1"}}, ensure_ascii=False),
                json.dumps({"sheet_name": "登录_用例", "values": {"Case ID": "QA-2"}}, ensure_ascii=False),
            )
        ),
        encoding="utf-8",
    )

    manifest = WorkspaceSourceService().index_path(tmp_path, "attachments/cases.jsonl", source)

    snapshot_paths = [sheet.snapshot_path for sheet in manifest.sheets]
    assert len(snapshot_paths) == len(set(snapshot_paths)) == 2
    assert manifest.case_ids == ("QA-1", "QA-2")


def test_history_document_candidates_ignore_empty_case_id_indexes(tmp_path: Path) -> None:
    _write_history_manifest(tmp_path, case_ids=[])

    resolution = resolve_case_sources(tmp_path, "QA-567的内容是什么？")

    assert resolution is not None
    assert resolution.candidates == ()


def test_render_prior_tabular_sources_ignores_unstructured_legacy_manifest(tmp_path: Path) -> None:
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

    section = render_prior_tabular_sources_section(tmp_path, "跑rewritten_userdata")

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
