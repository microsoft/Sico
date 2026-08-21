"""Custom Binary API adapter (provider_template_type=5)."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from app.biz.reverse_grpc.llmhubs import ReverseLLMHubService
from app.llmhubs.adapters.http_json import HttpJsonAdapter, _jsonpath_extract
from app.llmhubs.types import (
    ModelRegistryEntry,
    Artifact,
    Request,
    Response,
)

logger = logging.getLogger(__name__)

_CONTENT_DISPOSITION_FILENAME = re.compile(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', re.IGNORECASE)


class HttpBinaryAdapter(HttpJsonAdapter):
    """Configurable adapter for HTTP endpoints returning binary artifacts."""

    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        base_url = entry.config.get("base_url", "").rstrip("/")
        path = entry.config.get("path", "")
        timeout = self._resolve_timeout(request, entry)

        body = self._build_upstream_body(request, entry)

        headers = {"Content-Type": "application/json"}
        headers.update(self._build_auth_headers(entry))
        headers.update(entry.config.get("default_headers", {}))

        url = f"{base_url}{path}" if path else base_url
        resp = await self._post(url, json=body, headers=headers, timeout=timeout)

        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            data = resp.json()
            return self._extract_artifact_from_json(data, entry)
        else:
            mime_type = self._resolve_mime_type(content_type)
            filename = self._resolve_filename(resp.headers.get("content-disposition", ""), entry)
            artifact_type = entry.config.get("response_extraction", {}).get("artifact_type", "binary")

            try:
                uploaded = await asyncio.to_thread(
                    ReverseLLMHubService.get_instance().upload_artifact,
                    content=resp.content,
                    filename=filename,
                    content_type=mime_type,
                    path_prefix=f"llmhubs/{entry.model_key}",
                    artifact_type=artifact_type,
                )
            except Exception as exc:
                logger.exception("failed to upload binary artifact via reverse gRPC")
                raise RuntimeError("failed to upload binary artifact via reverse gRPC") from exc

            artifact = Artifact(
                artifact_type=uploaded.artifact_type or artifact_type,
                mime_type=uploaded.content_type or mime_type,
                filename=uploaded.filename or filename,
                storage_uri=uploaded.storage_uri,
                download_url=uploaded.download_url,
            )
            return Response(
                artifacts=[artifact],
                payload={
                    "mime_type": artifact.mime_type,
                    "filename": artifact.filename,
                    "storage_uri": artifact.storage_uri,
                    "download_url": artifact.download_url,
                },
            )

    @staticmethod
    def _extract_artifact_from_json(data: dict[str, Any], entry: ModelRegistryEntry) -> Response:
        extraction: dict[str, Any] = entry.config.get("response_extraction", {})

        download_url_path = extraction.get("download_url_path", "")
        download_url = _jsonpath_extract(data, download_url_path) if download_url_path else ""

        artifact = Artifact(
            artifact_type=extraction.get("artifact_type", ""),
            mime_type=extraction.get("mime_type", ""),
            filename=extraction.get("filename", ""),
            download_url=str(download_url) if download_url else "",
        )

        return Response(artifacts=[artifact], payload=data)

    @staticmethod
    def _resolve_mime_type(content_type: str) -> str:
        mime_type = content_type.split(";", 1)[0].strip()
        return mime_type or "application/octet-stream"

    @staticmethod
    def _resolve_filename(content_disposition: str, entry: ModelRegistryEntry) -> str:
        match = _CONTENT_DISPOSITION_FILENAME.search(content_disposition)
        if match:
            filename = match.group(1).strip()
            if filename:
                return filename

        extraction = entry.config.get("response_extraction", {})
        filename = str(extraction.get("filename", "")).strip()
        if filename:
            return filename
        return f"{entry.model_key}-artifact"
