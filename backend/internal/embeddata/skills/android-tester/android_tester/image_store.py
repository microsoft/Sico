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

"""In-memory image type and pluggable storage backends."""

from __future__ import annotations

import base64
import io
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import httpx
from PIL import Image as _PILImage

from android_tester.asset_uploader import AssetUploader

logger = logging.getLogger(__name__)

_HTTP_FALLBACK_TIMEOUT_S = 10.0


class Image:
    """In-memory image: bytes, mime, pixel size, and an optional uri.

    ``uri`` is unset until the image has been persisted by an
    :class:`ImageStore`. Stores typically set it in place.
    """

    __slots__ = ("_data", "mime", "size", "uri")

    def __init__(
        self,
        *,
        data: bytes,
        mime: str,
        size: tuple[int, int],
        uri: str | None = None,
    ) -> None:
        self._data = data
        self.mime = mime
        self.size = size
        self.uri = uri

    async def read(self) -> bytes:
        try:
            return await self._read()
        except OSError as exc:
            raise RuntimeError(f"Failed to fetch image from {self.uri}: "
                                f"{exc}") from exc

    async def _read(self) -> bytes:
        """Return the image bytes.

        If the in-memory bytes have been released by :meth:`drop`,
        attempt to recover them from :attr:`uri`:

        * ``http(s)://`` URLs are fetched asynchronously.
        * ``file://`` URLs and bare filesystem paths are read from disk.

        Returns ``b''`` if the bytes cannot be recovered.
        """
        if self._data:
            return self._data
        if not self.uri:
            return b""

        scheme = self._get_url_scheme()
        match scheme:
            case "http" | "https":
                return await self._read_from_http()
            case "file" | "":
                return await self._read_from_filesystem(scheme)
            case _:
                raise ValueError(f"Unsupported URI scheme in {self.uri!r}")

    def _get_url_scheme(self) -> str:
        if not self.uri:
            return ""
        scheme = urlparse(self.uri).scheme
        # On Windows, ``urlparse("C:/foo/bar").scheme`` returns ``"c"``
        if len(scheme) <= 1:
            return ""
        return scheme

    @property
    def is_remote(self) -> bool:
        """True if :attr:`uri` is a remote URL (``http``/``https``)."""
        return self._get_url_scheme() in ("http", "https")

    async def _read_from_http(self) -> bytes:
        if not self.uri:
            return b""

        async with httpx.AsyncClient(
            timeout=_HTTP_FALLBACK_TIMEOUT_S,
        ) as client:
            resp = await client.get(self.uri)
            resp.raise_for_status()
            return resp.content

    async def _read_from_filesystem(self, scheme: str) -> bytes:
        if not self.uri:
            return b""

        # Local path (with or without file:// scheme)
        path = Path(
            url2pathname(urlparse(self.uri).path)
            if scheme == "file"
            else self.uri,
        )
        if path.is_file():
            return path.read_bytes()
        return b""

    def drop_data_cache(self) -> None:
        """Release the in-memory bytes.

        :attr:`uri` is preserved so :meth:`read` can recover the
        bytes from disk if the store wrote them locally. Use this
        once the image is no longer needed in hot paths (e.g. after
        LLM inference) to keep peak memory bounded.
        """
        self._data = b""

    def __str__(self) -> str:
        """Render as URI if persisted, else as a ``data:`` URL.
        """
        if self.uri:
            return self.uri
        if self._data:
            b64 = base64.b64encode(self._data).decode("ascii")
            return f"data:{self.mime};base64,{b64}"
        return "<unstored image>"

    @classmethod
    def from_png_bytes(cls, data: bytes) -> Image:
        """Wrap raw PNG bytes; reads dimensions from the image header."""
        with _PILImage.open(io.BytesIO(data)) as img:
            size = img.size
        return cls(data=data, mime="image/png", size=size)

    def to_jpeg(self, *, quality: int = 85) -> Image:
        """Return a JPEG copy of this image (or *self* if already JPEG)."""
        if self.mime == "image/jpeg":
            return self
        out = io.BytesIO()
        with _PILImage.open(io.BytesIO(self._data)) as img:
            img.convert("RGB").save(out, "JPEG", quality=quality)
            size = img.size
        return Image(data=out.getvalue(), mime="image/jpeg", size=size)


class ImageStore(ABC):
    """Persists an :class:`Image`; stamps :attr:`Image.uri` and returns it."""

    @abstractmethod
    async def put(self, image: Image, *, name: str) -> Image:
        """Persist *image* under *name* and return it with ``uri`` set.

        *name* is a store-relative identifier; implementations are
        free to interpret it as a path, key, or blob id.
        """


class LocalImageStore(ImageStore):
    """Writes images to a directory on disk and stamps the local path.

    .. note::
       :meth:`put` mutates the input :class:`Image` in place by
       setting :attr:`Image.uri` to the on-disk path.
    """

    def __init__(self, root: Path) -> None:
        self._root = Path(root).resolve()

    async def put(self, image: Image, *, name: str) -> Image:
        path = (self._root / name).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(await image.read())
        image.uri = str(path)
        return image


class UploadingImageStore(ImageStore):
    """Uploads image bytes and stamps ``uri`` with the returned URL.

    Nothing is written locally; the bytes go straight to *uploader*.

    .. note::
       :meth:`put` mutates the input :class:`Image` in place by
       setting :attr:`Image.uri` to the uploader's returned URL
       (when the upload succeeds).
    """

    def __init__(self, uploader: AssetUploader) -> None:
        self._uploader = uploader

    async def put(self, image: Image, *, name: str) -> Image:
        url = await self._uploader.upload(await image.read(), name)
        if url:
            image.uri = url
        return image
