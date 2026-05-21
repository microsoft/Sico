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

from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from PIL import Image


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
