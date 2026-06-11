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
from types import SimpleNamespace

import pytest

from app.biz.knowledge import service as knowledge_service_module
from app.biz.knowledge.service import KnowledgeService
from app.pb.common.common import Attachment
from app.pb.knowledge.knowledge import KnowledgeDocument, KnowledgeDocumentType


class FakeExtractor:
    async def extract_from_url(self, url: str) -> tuple[str, str]:
        assert url == "https://blob.example/spec.pdf"
        return "full text", "summary"


class FakeResponse:
    content = b"pdf bytes"

    def raise_for_status(self) -> None:
        return None


@pytest.mark.asyncio
async def test_extract_file_document_persists_original_document(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    writes: dict[str, object] = {}
    service = object.__new__(KnowledgeService)
    service._logger = SimpleNamespace(
        info=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
    )
    service._extractor = FakeExtractor()

    def fake_get(url: str, timeout: int) -> FakeResponse:
        assert url == "https://blob.example/spec.pdf"
        assert timeout == 60
        return FakeResponse()

    def fake_write_bytes(resource_id: int, filename: str, content: bytes, **kwargs) -> Path:
        writes["bytes"] = (resource_id, filename, content, kwargs)
        return tmp_path / filename

    def fake_write_text(resource_id: int, filename: str, content: str, **kwargs) -> Path:
        writes.setdefault("texts", []).append((resource_id, filename, content, kwargs))
        return tmp_path / filename

    monkeypatch.setattr(knowledge_service_module.requests, "get", fake_get)
    monkeypatch.setattr(knowledge_service_module.KNOWLEDGE_DOCUMENT_FS, "write_bytes", fake_write_bytes)
    monkeypatch.setattr(knowledge_service_module.KNOWLEDGE_DOCUMENT_FS, "write_text", fake_write_text)

    response = await service.extract_document(
        KnowledgeDocument(
            id=7,
            project_id=3,
            document_type=KnowledgeDocumentType.FILE,
            attachment=Attachment(name="spec.pdf", sas_url="https://blob.example/spec.pdf"),
        )
    )

    assert response.code == 0
    assert writes["bytes"] == (7, "original/spec.pdf", b"pdf bytes", {"project_id": 3, "agent_id": ""})
    assert (7, "full.md", "full text", {"project_id": 3, "agent_id": ""}) in writes["texts"]
    assert (7, "summary.md", "summary", {"project_id": 3, "agent_id": ""}) in writes["texts"]