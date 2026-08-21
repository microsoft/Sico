"""Upload files through the configured storage provider."""

from __future__ import annotations

import logging
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote as url_quote

from app.utils.uploads import post_file

_LOGGER = logging.getLogger(__name__)

_DEFAULT_PATH_PREFIX = "default_space"
_STORAGE_TYPE_AZURE_BLOB = "azure_blob"
_STORAGE_TYPE_SEAWEEDFS = "seaweedfs"


def _azure_cdn_url(blob_path: str, container: str, cdn_endpoint: str) -> str:
    segments = blob_path.split("/")
    escaped = "/".join(url_quote(segment, safe="") for segment in segments)
    return f"{cdn_endpoint}/{url_quote(container, safe='')}/{escaped}"


def _get_azure_blob_client(endpoint: str, container: str):
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import ContainerClient

    account_url = endpoint
    if not account_url.startswith("http"):
        account_url = f"https://{account_url}"
    return ContainerClient(
        account_url=account_url,
        container_name=container,
        credential=DefaultAzureCredential(),
    )


def upload_file(file_path: Path, project_id: int) -> dict[str, Any]:
    if not file_path.exists():
        raise FileNotFoundError(f"file not found: {file_path}")

    original_name = file_path.name
    extension = file_path.suffix or ".bin"
    object_key = f"{uuid.uuid4().hex}{extension}"
    blob_path = f"{_DEFAULT_PATH_PREFIX}/{project_id}/{object_key}"

    content_type, _ = mimetypes.guess_type(str(file_path))
    if not content_type:
        content_type = "application/octet-stream"

    data = file_path.read_bytes()
    _LOGGER.info(
        "upload_file_to_blob project_id=%s file=%s blob_path=%s content_type=%s",
        project_id,
        original_name,
        blob_path,
        content_type,
    )

    storage_type = os.getenv("STORAGE_TYPE", _STORAGE_TYPE_SEAWEEDFS).strip().lower()
    if storage_type == _STORAGE_TYPE_SEAWEEDFS:
        return _upload_to_seaweedfs(
            data=data,
            object_key=object_key,
            blob_path=blob_path,
            original_name=original_name,
            content_type=content_type,
        )
    if storage_type == _STORAGE_TYPE_AZURE_BLOB:
        return _upload_to_azure_blob(
            data=data,
            object_key=object_key,
            blob_path=blob_path,
            original_name=original_name,
            content_type=content_type,
        )
    raise RuntimeError(f"unknown STORAGE_TYPE: {storage_type}")


def _upload_to_seaweedfs(
    *,
    data: bytes,
    object_key: str,
    blob_path: str,
    original_name: str,
    content_type: str,
) -> dict[str, Any]:
    endpoint = os.getenv("SEAWEEDFS_ENDPOINT", "").rstrip("/")
    if not endpoint:
        raise RuntimeError("SEAWEEDFS_ENDPOINT must be set")

    filer_url = f"{endpoint}/{blob_path}"
    response = post_file(
        filer_url,
        file_name=object_key,
        data=data,
        content_type=content_type,
        timeout=60,
    )
    if response.status_code not in {200, 201}:
        raise RuntimeError(f"SeaweedFS upload failed with status {response.status_code}: {response.text}")

    return _upload_result(
        cdn_url=filer_url,
        blob_path=blob_path,
        object_key=object_key,
        original_name=original_name,
        size_bytes=len(data),
    )


def _upload_to_azure_blob(
    *,
    data: bytes,
    object_key: str,
    blob_path: str,
    original_name: str,
    content_type: str,
) -> dict[str, Any]:
    endpoint = os.getenv("AZURE_BLOB_ENDPOINT", "").rstrip("/")
    container = os.getenv("AZURE_BLOB_CONTAINER", "")
    cdn_endpoint = os.getenv("AZURE_BLOB_CDN_ENDPOINT", "").rstrip("/")
    if not endpoint or not container or not cdn_endpoint:
        raise RuntimeError("AZURE_BLOB_ENDPOINT, AZURE_BLOB_CONTAINER, and AZURE_BLOB_CDN_ENDPOINT must be set")

    from azure.storage.blob import ContentSettings

    blob_client = _get_azure_blob_client(endpoint, container).get_blob_client(blob_path)
    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )

    return _upload_result(
        cdn_url=_azure_cdn_url(blob_path, container, cdn_endpoint),
        blob_path=blob_path,
        object_key=object_key,
        original_name=original_name,
        size_bytes=len(data),
    )


def _upload_result(
    *,
    cdn_url: str,
    blob_path: str,
    object_key: str,
    original_name: str,
    size_bytes: int,
) -> dict[str, Any]:
    return {
        "cdn_url": cdn_url,
        "blob_path": blob_path,
        "object_key": object_key,
        "file_name": original_name,
        "size_bytes": size_bytes,
    }
