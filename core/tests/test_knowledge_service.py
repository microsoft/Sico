from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.knowledge import service as knowledge_service_module
from app.biz.knowledge.service import KnowledgeService
from app.document import markitdown
from app.document.markitdown import MarkitdownDocExtractor
from app.pb.common.common import Attachment
from app.pb.knowledge.knowledge import GetDocumentDetailsRequest, KnowledgeDocument, KnowledgeDocumentType


class FakeExtractor:
    async def extract_from_url(self, url: str) -> tuple[str, str]:
        assert url == "https://blob.example/spec.pdf"
        return "full text", "summary"


class FakeLinkExtractor:
    def __init__(self) -> None:
        self.markdown = ""

    async def extract_utf8_markdown(self, file_path: str) -> tuple[str, str]:
        path = Path(file_path)
        assert path.suffix == ".md"
        self.markdown = path.read_text(encoding="utf-8")
        return "full link text", "link summary"


class FakeResponse:
    content = b"pdf bytes"

    def raise_for_status(self) -> None:
        return None


@pytest.mark.asyncio
@pytest.mark.parametrize("document_type", [KnowledgeDocumentType.FILE, KnowledgeDocumentType.LINK])
async def test_extract_document_logs_only_metadata(
    caplog: pytest.LogCaptureFixture, document_type: KnowledgeDocumentType
) -> None:
    signed_url = "https://blob.example/spec.pdf?sig=fixture-secret"
    service = object.__new__(KnowledgeService)
    service._logger = logging.getLogger(knowledge_service_module.__name__)
    service._extractor = None
    message = KnowledgeDocument(
        id=7,
        project_id=3,
        document_type=document_type,
        link_url=signed_url,
        attachment=Attachment(name="private-document-name", uri=signed_url, sas_url=signed_url),
    )

    with caplog.at_level(logging.INFO, logger=knowledge_service_module.__name__):
        response = await service.extract_document(message)

    assert response.code != 0
    assert f"ExtractDocument request received id=7 project_id=3 agent_id= type={document_type.name}" in caplog.messages
    assert signed_url not in caplog.text
    assert "fixture-secret" not in caplog.text
    assert "private-document-name" not in caplog.text


@pytest.mark.asyncio
async def test_extract_file_document_persists_original_document(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    writes: dict[str, object] = {}
    logged: list[tuple[object, ...]] = []
    service = object.__new__(KnowledgeService)
    service._logger = SimpleNamespace(
        info=lambda *args, **_kwargs: logged.append(args),
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
    assert all("full text" not in entry and "summary" not in entry for entry in logged)


@pytest.mark.asyncio
async def test_extract_link_document_fetches_extracts_and_persists_markdown(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    writes: list[tuple[int, str, str, dict[str, object]]] = []
    extractor = FakeLinkExtractor()
    service = object.__new__(KnowledgeService)
    service._logger = SimpleNamespace(
        info=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
    )
    service._extractor = extractor

    async def fake_fetch_url_as_markdown(url: str) -> dict[str, str]:
        assert url == "https://example.com/article"
        return {"error_message": "", "content": "# Fetched article\n\nBody"}

    def fake_write_text(resource_id: int, filename: str, content: str, **kwargs: object) -> Path:
        writes.append((resource_id, filename, content, kwargs))
        return tmp_path / filename

    monkeypatch.setattr(knowledge_service_module, "fetch_url_as_markdown", fake_fetch_url_as_markdown, raising=False)
    monkeypatch.setattr(knowledge_service_module.KNOWLEDGE_LINK_FS, "write_text", fake_write_text)

    response = await service.extract_document(
        KnowledgeDocument(
            id=8,
            project_id=3,
            document_type=KnowledgeDocumentType.LINK,
            link_url="https://example.com/article",
        )
    )

    assert response.code == 0
    assert extractor.markdown == "# Fetched article\n\nBody"
    assert writes == [
        (8, "link.md", "https://example.com/article", {"project_id": 3, "agent_id": ""}),
        (8, "full.md", "full link text", {"project_id": 3, "agent_id": ""}),
        (8, "summary.md", "link summary", {"project_id": 3, "agent_id": ""}),
    ]


@pytest.mark.asyncio
async def test_extract_link_document_preserves_utf8_after_ascii_detection_sample(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fetched_markdown = (
        "# Function calling\n\n" + ("This is an ASCII-only paragraph about function tools and schemas.\n\n" * 100) + "Café 中文"
    )
    assert fetched_markdown[:4096].isascii()
    writes: dict[str, str] = {}
    service = object.__new__(KnowledgeService)
    service._logger = SimpleNamespace(
        info=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
    )
    service._extractor = MarkitdownDocExtractor()

    async def fake_fetch_url_as_markdown(url: str) -> dict[str, str]:
        assert url == "https://example.com/unicode-markdown"
        return {
            "error_message": "",
            "content": fetched_markdown,
            "title": "Function calling | OpenAI API",
        }

    async def fake_summary(full_text: str) -> str:
        assert full_text == fetched_markdown
        return "offline summary"

    def fake_write_text(_resource_id: int, filename: str, content: str, **_kwargs: object) -> Path:
        writes[filename] = content
        return tmp_path / filename

    monkeypatch.setattr(knowledge_service_module, "fetch_url_as_markdown", fake_fetch_url_as_markdown)
    monkeypatch.setattr(markitdown, "_generate_summary_via_llm", fake_summary)
    monkeypatch.setattr(knowledge_service_module.KNOWLEDGE_LINK_FS, "write_text", fake_write_text)

    response = await service.extract_document(
        KnowledgeDocument(
            id=10,
            project_id=3,
            document_type=KnowledgeDocumentType.LINK,
            link_url="https://example.com/unicode-markdown",
        )
    )

    assert response.code == 0
    assert response.title == "Function calling | OpenAI API"
    assert writes == {
        "link.md": "https://example.com/unicode-markdown",
        "full.md": fetched_markdown,
        "summary.md": "offline summary",
    }


@pytest.mark.asyncio
async def test_extract_link_document_returns_failed_response_when_fetch_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    service = object.__new__(KnowledgeService)
    service._logger = SimpleNamespace(
        info=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
    )
    service._extractor = FakeLinkExtractor()

    async def fake_fetch_url_as_markdown(url: str) -> dict[str, str]:
        assert url == "https://example.com/missing"
        return {"error_message": "Request failed with status code: 404", "content": ""}

    def fail_write(*_args: object, **_kwargs: object) -> Path:
        raise AssertionError("failed link ingestion must not persist artifacts")

    monkeypatch.setattr(knowledge_service_module, "fetch_url_as_markdown", fake_fetch_url_as_markdown)
    monkeypatch.setattr(knowledge_service_module.KNOWLEDGE_LINK_FS, "write_text", fail_write)

    response = await service.extract_document(
        KnowledgeDocument(
            id=9,
            project_id=3,
            document_type=KnowledgeDocumentType.LINK,
            link_url="https://example.com/missing",
        )
    )

    assert response.code != 0
    assert response.message == "Request failed with status code: 404"


@pytest.mark.asyncio
async def test_get_link_document_details_reads_link_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    service = object.__new__(KnowledgeService)
    service._logger = SimpleNamespace(
        info=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
    )

    def fail_document_read(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("link details must not read document storage")

    def fake_link_read(resource_id: int, filename: str, **kwargs: object) -> str:
        assert resource_id == 8
        assert kwargs == {"project_id": 3, "agent_id": ""}
        return {"summary.md": "link summary", "full.md": "full link text"}[filename]

    monkeypatch.setattr(knowledge_service_module.KNOWLEDGE_DOCUMENT_FS, "read_text", fail_document_read)
    monkeypatch.setattr(knowledge_service_module.KNOWLEDGE_LINK_FS, "read_text", fake_link_read)

    response = await service.get_document_details(
        GetDocumentDetailsRequest(
            document_id=8,
            project_id=3,
            document_type=KnowledgeDocumentType.LINK,
        )
    )

    assert response.code == 0
    assert response.summary == "link summary"
    assert response.full_text == "full link text"
