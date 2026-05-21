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

"""Upload asset tool and helpers.

Uploads files to SeaweedFS via the filer's HTTP API and returns URLs the
frontend can resolve through the same-origin ``/storage`` reverse-proxy path
served by sico-nginx.

Mirrors the backend SeaweedFS storage layer
(``backend/internal/infra/storage/seaweedfs.go``):

  - Object path: ``default_space/{project_id}/{object_key}``
  - Filer URL:   ``{SEAWEEDFS_ENDPOINT}/default_space/{project_id}/{object_key}``

The raw filer URL is returned as ``cdn_url``. Inside the docker/kind network
this points at the cluster-internal filer hostname; sico-nginx rewrites such
URLs to same-origin ``/storage/...`` paths via ``sub_filter`` so that
browsers can fetch them.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Any

import requests

_LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (mirrors backend SEAWEEDFS_ENDPOINT env var)
# ---------------------------------------------------------------------------

_DEFAULT_PATH_PREFIX = "default_space"


def _seaweedfs_endpoint() -> str:
    endpoint = os.getenv("SEAWEEDFS_ENDPOINT", "").rstrip("/")
    if not endpoint:
        raise RuntimeError("SEAWEEDFS_ENDPOINT must be set")
    return endpoint


def _build_filer_url(endpoint: str, blob_path: str) -> str:
    return f"{endpoint}/{blob_path.lstrip('/')}"


def upload_file_to_blob(file_path: Path, project_id: int) -> dict[str, Any]:
    """Upload a local file to SeaweedFS and return metadata.

    Args:
        file_path: Absolute path to the file on disk.
        project_id: Project ID used as the blob namespace.

    Returns:
        Dict with keys: cdn_url, blob_path, object_key, file_name, size_bytes.

    Raises:
        FileNotFoundError: If *file_path* does not exist.
        RuntimeError: If SeaweedFS is not configured or the upload fails.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"file not found: {file_path}")

    original_name = file_path.name
    ext = file_path.suffix or ".bin"
    unique_id = uuid.uuid4().hex
    object_key = f"{unique_id}{ext}"
    blob_path = f"{_DEFAULT_PATH_PREFIX}/{project_id}/{object_key}"

    content_type, _ = mimetypes.guess_type(str(file_path))
    if not content_type:
        content_type = "application/octet-stream"

    data = file_path.read_bytes()

    endpoint = _seaweedfs_endpoint()
    filer_url = _build_filer_url(endpoint, blob_path)

    _LOGGER.info(
        "upload_file_to_blob project_id=%s file=%s blob_path=%s content_type=%s",
        project_id, original_name, blob_path, content_type,
    )

    # SeaweedFS filer accepts a multipart POST where the part name is "file".
    # See backend/internal/infra/storage/seaweedfs.go PutObject.
    response = requests.post(
        filer_url,
        files={"file": (object_key, data, content_type)},
        timeout=60,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(
            f"SeaweedFS upload failed with status {response.status_code}: {response.text}"
        )

    return {
        "cdn_url": filer_url,
        "blob_path": blob_path,
        "object_key": object_key,
        "file_name": original_name,
        "size_bytes": len(data),
    }
