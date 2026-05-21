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

"""Abstract base class for document extractors."""

import logging
import os
import tempfile
from abc import ABC, abstractmethod
from urllib.parse import urlparse

import httpx

_LOGGER = logging.getLogger(__name__)

_DOWNLOAD_TIMEOUT = 120


class DocExtractor(ABC):
    """Abstract interface for extracting text from documents."""

    @abstractmethod
    async def extract(self, file_path: str) -> tuple[str, str]:
        """Extract document content from a local file.

        Args:
            file_path: Absolute path to the file on disk.

        Returns:
            A tuple of (full_text, summary).
        """

    async def extract_from_url(self, url: str) -> tuple[str, str]:
        """Extract document content from a URL.

        Default implementation downloads to a temp file and delegates to :meth:`extract`.
        Subclasses may override for more efficient URL-based extraction.

        Args:
            url: Public or SAS URL to the document.

        Returns:
            A tuple of (full_text, summary).
        """
        parsed = urlparse(url)
        suffix = os.path.splitext(parsed.path)[1] or ""

        _LOGGER.info("Downloading document from URL for extraction url=%s", url)
        async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT) as client:
            response = await client.get(url)
            response.raise_for_status()

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(tmp_fd, "wb") as f:
                f.write(response.content)
            return await self.extract(tmp_path)
        finally:
            os.unlink(tmp_path)
