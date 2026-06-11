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

import asyncio
import logging
import re
from pathlib import Path

import requests

from app.document import build_doc_extractor
from app.pb.knowledge.knowledge import (
    ExtractDocumentResponse,
    GetDocumentDetailsRequest,
    GetDocumentDetailsResponse,
    GetKnowledgePlaybookDetailsGrpcRequest,
    GetKnowledgePlaybookDetailsGrpcResponse,
    KnowledgeDocument,
    KnowledgeDocumentType,
    KnowledgeServiceBase,
)
from app.storage.fs import KNOWLEDGE_DOCUMENT_FS, KNOWLEDGE_LINK_FS
from app.utils.response import failed_response, success_response


class KnowledgeService(KnowledgeServiceBase):
    """Minimal gRPC surface for knowledge extraction triggers."""

    def __init__(self) -> None:
        self._logger = logging.getLogger(__name__)
        self._extractor = build_doc_extractor(self._logger)

    async def extract_document(self, message: KnowledgeDocument) -> ExtractDocumentResponse:  # type: ignore[override]
        # Log full payload to confirm the request hit the service.
        self._logger.info("ExtractDocument request received: %s", message.to_dict())

        if message.document_type == KnowledgeDocumentType.LINK:
            link_url = (message.link_url or "").strip()
            if not link_url:
                self._logger.warning("No link_url for LINK knowledge id=%s", message.id)
                return failed_response(ExtractDocumentResponse(message="missing link_url"))
            try:
                await self._persist_link(message, link_url)
            except Exception as exc:  # pragma: no cover - defensive for filesystem operations
                self._logger.error("Failed to persist link knowledge id=%s error=%s", message.id, exc)
                return failed_response(ExtractDocumentResponse(message=str(exc)))
            return success_response(ExtractDocumentResponse(message="received"))

        if message.document_type != KnowledgeDocumentType.FILE:
            self._logger.info(
                "Skipping knowledge extraction for unsupported document type id=%s type=%s",
                message.id,
                getattr(message.document_type, "name", None),
            )
            return success_response(ExtractDocumentResponse(message="received"))

        return await self._extract_file_document(message)

    async def _extract_file_document(self, message: KnowledgeDocument) -> ExtractDocumentResponse:
        """Handle extraction for FILE-type knowledge documents."""
        if not self._extractor:
            self._logger.info(
                "Document extractor not configured; skipping extraction id=%s",
                message.id,
            )
            return failed_response(ExtractDocumentResponse(message="document extractor not configured"))

        attachment = message.attachment
        file_url = ""
        if attachment is not None:
            file_url = (attachment.sas_url or attachment.uri or "").strip()

        if not file_url:
            self._logger.warning(
                "No attachment URL found; skipping extraction id=%s",
                message.id,
            )
            return failed_response(ExtractDocumentResponse(message="missing attachment url"))

        try:
            full_text, summary = await self._extractor.extract_from_url(file_url)
            await self._persist_original_document(message, file_url)
            self._logger.info(
                "Knowledge extraction succeeded id=%s full_text_length=%d summary_length=%d\n%s\n\n%s",
                message.id,
                len(full_text),
                len(summary),
                full_text,
                summary,
            )
            await self._persist_extraction(message, full_text, summary)
        except Exception as exc:  # pragma: no cover - defensive for external service
            self._logger.error("Knowledge extraction failed id=%s error=%s", message.id, exc)
            return failed_response(ExtractDocumentResponse(message=str(exc)))

        return success_response(ExtractDocumentResponse(message="received"))

    async def _persist_original_document(self, message: KnowledgeDocument, file_url: str) -> None:
        attachment = message.attachment
        raw_name = getattr(attachment, "name", "") if attachment is not None else ""
        name = _safe_original_attachment_name(raw_name)

        def _download_and_write() -> str:
            resp = requests.get(file_url, timeout=60)
            resp.raise_for_status()
            return str(
                KNOWLEDGE_DOCUMENT_FS.write_bytes(
                    message.id,
                    f"original/{name}",
                    resp.content,
                    project_id=message.project_id,
                    agent_id=message.agent_id,
                )
            )

        try:
            path = await asyncio.to_thread(_download_and_write)
            self._logger.info("Persisted original knowledge document id=%s path=%s", message.id, path)
        except Exception as exc:
            self._logger.warning(
                "Failed to persist original knowledge document id=%s name=%s err=%s",
                message.id,
                name,
                exc,
            )

    async def get_document_details(
        self,
        message: GetDocumentDetailsRequest,
    ) -> GetDocumentDetailsResponse:  # type: ignore[override]
        self._logger.info(
            "GetDocumentDetails request received id=%s project_id=%s agent_id=%s",
            message.document_id,
            message.project_id,
            message.agent_id,
        )

        if not message.project_id and not message.agent_id:
            return failed_response(GetDocumentDetailsResponse(message="one of project_id or agent_id is required"))
        if message.project_id and message.agent_id:
            return failed_response(GetDocumentDetailsResponse(message="only one of project_id or agent_id should be provided"))

        def _read_files() -> tuple[str, str]:
            summary = KNOWLEDGE_DOCUMENT_FS.read_text(
                message.document_id,
                "summary.md",
                project_id=message.project_id,
                agent_id=message.agent_id,
            )
            full_text = KNOWLEDGE_DOCUMENT_FS.read_text(
                message.document_id,
                "full.md",
                project_id=message.project_id,
                agent_id=message.agent_id,
            )
            return full_text, summary

        try:
            full_text, summary = await asyncio.to_thread(_read_files)
            self._logger.info(
                "GetDocumentDetails succeeded id=%s full_text_length=%d summary_length=%d",
                message.document_id,
                len(full_text),
                len(summary),
            )
            return success_response(
                GetDocumentDetailsResponse(
                    summary=summary,
                    full_text=full_text,
                )
            )
        except Exception as exc:  # pragma: no cover - defensive for filesystem operations
            self._logger.error(
                "GetDocumentDetails failed id=%s error=%s",
                message.document_id,
                exc,
            )
            return failed_response(GetDocumentDetailsResponse(message=str(exc)))

    async def get_playbook_details(
        self, message: GetKnowledgePlaybookDetailsGrpcRequest
    ) -> GetKnowledgePlaybookDetailsGrpcResponse:  # type: ignore[override]
        """Return playbook content from NFS storage via experience service."""
        self._logger.info(
            "GetPlaybookDetails request received playbook_id=%s project_id=%s agent_instance_id=%s",
            message.playbook_id,
            message.project_id,
            message.agent_instance_id,
        )

        try:
            from app.experiences.service import read_playbook

            content = await read_playbook(
                agent_instance_id=message.agent_instance_id,
            )
            self._logger.info(
                "GetPlaybookDetails succeeded playbook_id=%s content_length=%d",
                message.playbook_id,
                len(content),
            )
            return success_response(GetKnowledgePlaybookDetailsGrpcResponse(content=content))
        except Exception as exc:
            self._logger.error(
                "GetPlaybookDetails failed playbook_id=%s error=%s",
                message.playbook_id,
                exc,
            )
            return failed_response(GetKnowledgePlaybookDetailsGrpcResponse(), msg=str(exc))


    async def _persist_extraction(self, message: KnowledgeDocument, full_text: str, summary: str) -> None:
        """Write extraction outputs to storage."""

        def _write_files() -> str:
            full_path = KNOWLEDGE_DOCUMENT_FS.write_text(
                message.id,
                "full.md",
                full_text or "",
                project_id=message.project_id,
                agent_id=message.agent_id,
            )
            KNOWLEDGE_DOCUMENT_FS.write_text(
                message.id,
                "summary.md",
                summary or "",
                project_id=message.project_id,
                agent_id=message.agent_id,
            )
            return str(full_path.parent)

        target_dir = ""

        try:
            target_dir = await asyncio.to_thread(_write_files)
            self._logger.info(
                "Knowledge extraction persisted id=%s path=%s",
                message.id,
                target_dir,
            )
        except Exception as exc:  # pragma: no cover - defensive for filesystem operations
            self._logger.error(
                "Failed to persist knowledge extraction id=%s path=%s error=%s",
                message.id,
                target_dir or "",
                exc,
            )

    async def _persist_link(self, message: KnowledgeDocument, link_url: str) -> None:
        """Write link URL to storage as link.md."""

        def _write_file() -> str:
            path = KNOWLEDGE_LINK_FS.write_text(
                message.id,
                "link.md",
                link_url,
                project_id=message.project_id,
                agent_id=message.agent_id,
            )
            return str(path.parent)

        target_dir = await asyncio.to_thread(_write_file)
        self._logger.info(
            "Link knowledge persisted id=%s path=%s",
            message.id,
            target_dir,
        )


def _safe_original_attachment_name(name: str) -> str:
    safe = Path(name or "").name.strip()
    if not safe:
        return "original"
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", safe).strip(" ._") or "original"
