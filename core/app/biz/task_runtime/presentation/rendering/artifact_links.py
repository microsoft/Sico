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

"""Artifact label / public URL helpers shared by views and tool_payload."""

from __future__ import annotations

import os
from typing import Any


def _is_report_artifact(artifact: dict[str, Any]) -> bool:
    artifact_type = str(artifact.get("type") or "").lower()
    if artifact_type == "report":
        return True
    name = str(artifact.get("name") or "").lower()
    return name.endswith((".md", ".html", ".htm"))


def _is_report_artifact_ref(artifact: Any) -> bool:
    if hasattr(artifact, "model_dump"):
        return _is_report_artifact(artifact.model_dump(mode="json"))
    return False


def _artifact_link_label(artifact: Any, *, run_label: bool = False) -> str:
    if _is_report_artifact_ref(artifact):
        return "Run report" if run_label else "Report"
    return "Generated artifact"


def _artifact_link_line(artifact: Any, *, run_label: bool = False) -> str:
    return f"{_artifact_link_label(artifact, run_label=run_label)}: {_public_artifact_url(artifact.uri)}"


def _public_artifact_url(uri: str) -> str:
    if uri.startswith("/storage/"):
        base_url = os.getenv("SICO_PUBLIC_BASE_URL", "").strip().rstrip("/")
        if not base_url:
            base_url = f"http://localhost:{os.getenv('SICO_PORT', '8080')}"
        return f"{base_url}{uri}"
    return uri
