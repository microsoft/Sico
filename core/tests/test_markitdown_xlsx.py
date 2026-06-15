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
