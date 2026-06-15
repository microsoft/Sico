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

import os
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from PIL import Image

from android_tester.retry import call_with_retry


def coerce_to_json(value: Any) -> Any:
    """Coerce non-JSON-native objects to a serializable form.

    Suitable for use as ``json.dumps(..., default=coerce_to_json)``.
    Dataclass instances become dicts; everything else falls back to
    ``str(value)``. The fallback is lossy (not round-trippable) but
    keeps logging tolerant of arbitrary payload values.
    """
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    return str(value)


def _extended_length(path: Path) -> Path:
    r"""Return *path* in Windows extended-length (``\\?\``) form.

    The legacy Win32 ``MAX_PATH`` limit (260 chars) makes deep cache
    paths fail to open even when each component is valid; the ``\\?\``
    prefix opts the path out of that limit. No-op on non-Windows or when
    the prefix is already present.
    """
    if os.name != "nt":
        return path
    raw = os.path.abspath(path)
    if raw.startswith("\\\\?\\"):
        return path
    return Path("\\\\?\\" + raw)


def write_file_atomically(
    path: Path, data: str, *, encoding: str = "utf-8",
) -> None:
    """Write text to *path* atomically via :func:`write_bytes_atomically`.

    The text is encoded with *encoding* and then written using the shared
    bytes-level atomic path for consistent behavior.
    """
    write_bytes_atomically(path, data.encode(encoding))


def write_bytes_atomically(path: Path, data: bytes) -> None:
    """Binary sibling of :func:`write_file_atomically`.

    Same atomicity, parent-creation, and Windows extended-length path
    handling — for raw bytes (e.g. images) instead of text.
    """
    parent = _extended_length(path.parent)
    parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=parent,
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        call_with_retry(
            lambda: os.replace(tmp, _extended_length(path)),
            on=PermissionError,
            max_retries=9,
            base_delay=0.005,
        )
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def convert_image_to_jpg(src: Path, *, quality: int = 85) -> Path:
    """Convert an image to JPEG, returning the new path.

    If *src* is already a JPEG the original path is returned unchanged.
    The JPEG file is written next to the source with a ``.jpg`` extension.
    """
    if src.suffix.lower() in (".jpg", ".jpeg"):
        return src

    dst = src.with_suffix(".jpg")
    with Image.open(src) as img:
        rgb = img.convert("RGB")
        rgb.save(dst, "JPEG", quality=quality)
    return dst


def get_image_size(path: Path) -> tuple[int, int]:
    """Return (width, height) of an image file."""
    with Image.open(path) as img:
        return img.size


def rescale_point(
    point: tuple[int, int],
    perceived_size: tuple[int, int],
    actual_size: tuple[int, int],
) -> tuple[int, int]:
    """Rescale a coordinate from the LLM's perceived image space
    to the actual screenshot space.

    Returns the point unchanged when sizes match or perceived
    dimensions are non-positive.
    """
    pw, ph = perceived_size
    aw, ah = actual_size
    if (pw, ph) == (aw, ah) or pw <= 0 or ph <= 0:
        return point
    x, y = point
    return round(x * aw / pw), round(y * ah / ph)


@asynccontextmanager
async def fetch_apk(source: str) -> AsyncIterator[Path]:
    """Yield a local filesystem :class:`Path` to the APK at *source*.

    *source* may be a local path or an ``http(s)://`` URL. URL sources
    are downloaded to a temporary file that is removed on exit; local
    paths are validated and yielded as-is.
    """
    scheme = urlparse(source).scheme
    fetch_method = _download_apk if scheme in {"http", "https"} else _local_apk
    async with fetch_method(source) as path:
        yield path


@asynccontextmanager
async def _download_apk(
    url: str,
    *,
    read_timeout: float = 120.0,
    connect_timeout: float = 20.0,
) -> AsyncIterator[Path]:
    """Download an APK to a temp file; remove it on exit."""
    timeout = httpx.Timeout(read_timeout, connect=connect_timeout)
    with tempfile.NamedTemporaryFile(
        suffix=".apk",
        delete_on_close=False
    ) as tmp:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            tmp.write(response.content)
        tmp.close()  # release the handle so adb can open the path on Windows
        yield Path(tmp.name)


@asynccontextmanager
async def _local_apk(source: str) -> AsyncIterator[Path]:
    """Validate and yield a local APK path."""
    path = Path(source).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"APK file not found: {source!r}")
    yield path
