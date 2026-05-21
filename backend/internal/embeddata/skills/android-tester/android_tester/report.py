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

"""HTML report rendering helpers.

Provides :class:`StepRecord` for collecting per-step data and
:func:`render_report` for producing a self-contained HTML string
from a Jinja2 template.

Images referenced via HTTP(S) are kept as remote URLs.  Local file
paths are embedded as base64 data URIs so the report stays portable.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader

from android_tester.image_store import Image

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "data"
_TEMPLATE_NAME = "report.html.j2"


def _format_duration(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def _format_label(description: str) -> str:
    return (
        description.replace("-", " ")
        .replace("_", " ")
        .title()
    )


_SCREENSHOT_LABELS = {
    "before-action": "Before",
    "after-action": "After",
}


def _screenshot_label(description: str) -> str:
    return _SCREENSHOT_LABELS.get(description, _format_label(description))


def _format_telemetry_value(value: Any) -> str:
    if isinstance(value, dict):
        return ", ".join(
            f"{k}={v}" for k, v in value.items()
        )
    return str(value)


async def _resolve_image_src(image: Image) -> str:
    """
    Return *image.uri* as-is for remote URLs, or a base64 data URI built
    from the in-memory bytes.
    """
    if image.uri and image.is_remote:
        return image.uri
    b64 = base64.b64encode(await image.read()).decode("ascii")
    return f"data:{image.mime};base64,{b64}"


@dataclass(slots=True)
class StepRecord:
    step: int
    screenshots: list[tuple[Image, str]] = field(default_factory=list)
    operator: str | None = None
    reflector: str | None = None
    errors: list[str] = field(default_factory=list)


def _build_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=True,
    )
    env.filters["format_label"] = _format_label
    env.filters["screenshot_label"] = _screenshot_label
    env.filters["fmt_telemetry"] = _format_telemetry_value
    return env


_jinja_env = _build_env()


async def render_report(
    steps: dict[int, StepRecord],
    task_id: str,
    duration: float,
    status: str,
    start_ts: str,
    task_name: str | None = None,
    instruction: str | None = None,
    device_id: str | None = None,
    reason: str | None = None,
    telemetry: dict[str, Any] | None = None,
) -> str:
    """Return a self-contained HTML report string."""
    sorted_steps = [steps[k] for k in sorted(steps)]

    # If a step has no after-action screenshot, use the next step's
    # before-action screenshot as a stand-in.
    for i, rec in enumerate(sorted_steps):
        has_after = any(d == "after-action" for _, d in rec.screenshots)
        if not has_after and i + 1 < len(sorted_steps):
            next_before = next(
                ((s, d) for s, d in sorted_steps[i + 1].screenshots
                 if d == "before-action"),
                None,
            )
            if next_before:
                src, _ = next_before
                rec.screenshots.append((src, "after-action"))

    # Resolve image sources (remote URL or base64)
    for rec in sorted_steps:
        rec.screenshots = [
            (await _resolve_image_src(src), desc)
            for src, desc in rec.screenshots
        ]

    template = _jinja_env.get_template(_TEMPLATE_NAME)
    return template.render(
        task_id=task_id,
        status=status,
        task_name=task_name,
        instruction=instruction,
        device_id=device_id,
        reason=reason,
        duration_fmt=_format_duration(duration),
        start_ts=start_ts,
        steps=sorted_steps,
        telemetry=telemetry,
    )
