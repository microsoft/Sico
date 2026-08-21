from __future__ import annotations

from pathlib import Path

import pytest
from openpyxl import Workbook

from app.document import markitdown
from app.document.markitdown import MarkitdownDocExtractor


@pytest.mark.asyncio
async def test_markitdown_extracts_xlsx(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    workbook_path = tmp_path / "case.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Cases"
    sheet.append(["title", "description"])
    sheet.append(["Open Edge", "Tap menu and verify sync settings."])
    workbook.save(workbook_path)

    async def fake_summary(full_text: str) -> str:
        return full_text[:20]

    monkeypatch.setattr(markitdown, "_generate_summary_via_llm", fake_summary)

    full_text, summary = await MarkitdownDocExtractor().extract(str(workbook_path))

    assert "# Cases" in full_text
    assert "| title | description |" in full_text
    assert "| Open Edge | Tap menu and verify sync settings. |" in full_text
    assert summary == full_text[:20]
