import csv
from pathlib import Path

import pytest

from app.document import markitdown
from app.document.markitdown import MarkitdownDocExtractor


@pytest.mark.asyncio
async def test_native_csv_snapshot_preserves_case_steps_and_unicode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "query.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["ID", "Title", "Test Step", "Step Action", "Step Expected"])
        writer.writerow(["101", 'Case, "quoted" \u4e2d\u6587', "", "", ""])
        writer.writerow(["101", 'Case, "quoted" \u4e2d\u6587', "1", "First\nSecond x\u00b2", "Expected, result"])

    async def fake_summary(full_text: str) -> str:
        assert "101" in full_text
        assert "\u4e2d\u6587" in full_text
        assert "x\u00b2" in full_text
        assert "Expected, result" in full_text
        return "offline summary"

    monkeypatch.setattr(markitdown, "_generate_summary_via_llm", fake_summary)
    full_text, summary = await MarkitdownDocExtractor().extract(str(path))
    assert full_text.count("101") == 2
    assert "Step Action" in full_text
    assert summary == "offline summary"
