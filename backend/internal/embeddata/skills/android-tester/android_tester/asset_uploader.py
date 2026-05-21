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

"""Upload files via the SICO backend asset endpoint and return CDN URLs.

Uses ``POST /api/<app_name>/project/asset`` (multipart/form-data) which
handles blob storage internally and returns a ``sasUrl`` (CDN download
link).
"""

from __future__ import annotations

import logging
import mimetypes
from typing import Protocol, runtime_checkable

import httpx

logger = logging.getLogger(__name__)

_UPLOAD_URL_TEMPLATE = "{endpoint}/api/{app_name}/project/asset"


@runtime_checkable
class AssetUploader(Protocol):
    """Protocol for uploading image bytes and returning public URLs."""

    async def upload(self, data: bytes, name: str) -> str | None:
        """Upload *data* under *name* and return the URL, or ``None``."""
        ...


class DummyAssetUploader:
    """No-op uploader used when the backend is not configured."""

    async def upload(self, data: bytes, name: str) -> str | None:
        return None


class HttpAssetUploader:
    """Uploads images to the SICO backend asset endpoint."""

    def __init__(
        self,
        backend_url: str,
        app_name: str = "sico",
        timeout: float = 60,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._upload_url = _UPLOAD_URL_TEMPLATE.format(
            endpoint=backend_url.strip().rstrip("/"),
            app_name=app_name,
        )
        self._timeout = timeout
        self._headers = headers or {}

    async def upload(self, data: bytes, name: str) -> str | None:
        content_type, _ = mimetypes.guess_type(name)
        if not content_type:
            content_type = "image/jpeg"

        url = self._upload_url
        logger.info("upload file=%s url=%s", name, url)

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                url,
                headers=self._headers,
                files={"file": (name, data, content_type)},
            )
        resp.raise_for_status()
        body = resp.json()
        sas_url: str = body["data"]["sasUrl"]
        return sas_url


def build_asset_uploader(
    backend_url: str | None,
    *,
    app_name: str = "sico",
    timeout: float = 60,
    headers: dict[str, str] | None = None,
) -> AssetUploader:
    """Factory: returns an :class:`HttpAssetUploader` when
    *backend_url* is provided, otherwise a
    :class:`DummyAssetUploader`."""
    if backend_url:
        return HttpAssetUploader(
            backend_url, app_name=app_name,
            timeout=timeout, headers=headers,
        )
    logger.warning(
        "Asset upload disabled — no backend URL configured"
    )
    return DummyAssetUploader()
