"""Reusable semantic projections over canonical tabular rows."""

from __future__ import annotations

import re
from typing import Protocol

from ..models import NormalizedRow, TabularDocument, TabularRow, TabularSheet, normalize_header

_CASE_ID_HEADERS = frozenset(("id", "case_id", "test_case_id", "testcase_id", "tc_id", "用例id", "用例编号"))
_TITLE_HEADERS = frozenset(("title", "case_title", "test_case", "testcase", "test_title", "name", "标题", "用例标题"))
_STEPS_HEADERS = frozenset(("steps", "test_steps", "action", "actions", "操作步骤", "测试步骤", "步骤"))
_EXPECTED_HEADERS = frozenset(("expected", "expected_result", "expected_results", "预期结果", "期望结果"))
_CASE_ID_RE = re.compile(r"(?<![A-Z0-9])[A-Z][A-Z0-9]{1,20}-\d+(?![A-Z0-9])", re.IGNORECASE)


class RowNormalizer(Protocol):
    normalizer_id: str

    def confidence(self, sheet: TabularSheet) -> float: ...

    def normalize(self, document: TabularDocument, sheet: TabularSheet) -> tuple[NormalizedRow, ...]: ...


class TestCaseNormalizer:
    normalizer_id = "testcase_v1"

    def confidence(self, sheet: TabularSheet) -> float:
        headers = set(sheet.normalized_headers)
        has_id = bool(headers & _CASE_ID_HEADERS)
        has_title = bool(headers & _TITLE_HEADERS)
        has_steps = bool(headers & _STEPS_HEADERS)
        has_expected = bool(headers & _EXPECTED_HEADERS)
        if has_steps and has_expected and (has_id or has_title):
            return 1.0
        if has_id and has_title and (has_steps or has_expected):
            return 0.9
        return 0.0

    def normalize(self, document: TabularDocument, sheet: TabularSheet) -> tuple[NormalizedRow, ...]:
        return tuple(_testcase_row(document, sheet, row) for row in sheet.rows)


class GenericRowNormalizer:
    normalizer_id = "generic_row_v1"

    def confidence(self, sheet: TabularSheet) -> float:
        return 0.01

    def normalize(self, document: TabularDocument, sheet: TabularSheet) -> tuple[NormalizedRow, ...]:
        return tuple(_generic_row(document, sheet, row) for row in sheet.rows)


class NormalizerSelector:
    def __init__(self) -> None:
        self._testcase = TestCaseNormalizer()
        self._generic = GenericRowNormalizer()

    def select(self, sheet: TabularSheet) -> RowNormalizer:
        return self._testcase if self._testcase.confidence(sheet) >= 0.8 else self._generic


def case_id_for_row(row: TabularRow) -> str:
    return _first(row, _CASE_ID_HEADERS) or _case_id_from_values(row)


def _testcase_row(document: TabularDocument, sheet: TabularSheet, row: TabularRow) -> NormalizedRow:
    case_id = case_id_for_row(row)
    title = _first(row, _TITLE_HEADERS) or case_id or f"{sheet.name} row {row.data_row_index}"
    return _normalized(document, sheet, row, title=title, case_id=case_id, normalizer_id="testcase_v1")


def _generic_row(document: TabularDocument, sheet: TabularSheet, row: TabularRow) -> NormalizedRow:
    title = f"{sheet.name} row {row.data_row_index}"
    case_id = case_id_for_row(row)
    return _normalized(document, sheet, row, title=title, case_id=case_id, normalizer_id="generic_row_v1")


def _normalized(
    document: TabularDocument,
    sheet: TabularSheet,
    row: TabularRow,
    *,
    title: str,
    case_id: str,
    normalizer_id: str,
) -> NormalizedRow:
    lines = [
        f"Tabular source: {document.source_ref}",
        f"Sheet: {sheet.name}",
        f"Data row: {row.data_row_index}",
        f"Source row: {row.source_row}",
    ]
    if case_id:
        lines.append(f"Case ID: {case_id}")
    lines.append("Row fields:")
    lines.extend(f"- {header}: {value}" for header, value in row.display_values.items() if value)
    return NormalizedRow(
        source_ref=document.source_ref,
        source_id=document.source_id,
        table_id=sheet.table_id,
        sheet_name=sheet.name,
        source_row=row.source_row,
        data_row_index=row.data_row_index,
        title=title,
        goal="\n".join(lines),
        case_id=case_id,
        values=row.values,
        display_values=row.display_values,
        normalizer_id=normalizer_id,
        materialized_ref=document.materialized_ref or document.source_ref,
    )


def _first(row: TabularRow, names: frozenset[str]) -> str:
    for header, value in row.display_values.items():
        if normalize_header(header) in names and value.strip():
            return value.strip()
    return ""


def _case_id_from_values(row: TabularRow) -> str:
    for value in row.display_values.values():
        if match := _CASE_ID_RE.search(value):
            return match.group(0)
    return ""
