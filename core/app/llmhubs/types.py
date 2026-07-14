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

"""request/response types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class InputContent:
    type: str = ""
    text: str = ""
    image_base64: str = ""
    image_url: str = ""
    detail: str = ""
    file_url: str = ""
    file_base64: str = ""
    media_type: str = ""
    call_id: str = ""
    name: str = ""
    arguments: str | dict[str, Any] | None = None
    result: Any | None = None
    output: dict[str, Any] | None = None  # computer_call_output nested data
    actions: list[dict[str, Any]] | None = None  # computer_call actions
    # Opaque per-provider passthrough (e.g. the original Gemini ``Part``); shared
    # layers only transport it, only the owning adapter interprets it.
    provider_metadata: dict[str, Any] | None = None


@dataclass
class Input:
    role: str = "user"
    content: list[InputContent] = field(default_factory=list)


@dataclass
class Request:
    model: str = ""
    instructions: str = ""
    inputs: list[Input] = field(default_factory=list)
    options: dict[str, Any] = field(default_factory=dict)
    tools: list[dict[str, Any]] = field(default_factory=list)
    previous_response_id: str = ""  # Responses API stateful continuation


@dataclass
class OutputItem:
    type: str = "text"
    text: str = ""
    json: dict[str, Any] | None = None
    call_id: str = ""
    name: str = ""
    arguments: str | dict[str, Any] | None = None
    result: Any | None = None
    actions: list[dict[str, Any]] | None = None  # computer_call actions
    annotations: list[dict[str, Any]] | None = None  # url_citation annotations
    action: dict[str, Any] | None = None  # web_search_call action metadata
    # Opaque per-provider passthrough (e.g. the original Gemini ``Part``); shared
    # layers only transport it, only the owning adapter interprets it.
    provider_metadata: dict[str, Any] | None = None


@dataclass
class Artifact:
    artifact_type: str = ""
    mime_type: str = ""
    filename: str = ""
    storage_uri: str = ""
    download_url: str = ""


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class Trace:
    provider_template_type: int = 0
    model: str = ""
    latency_ms: int = 0


@dataclass
class Response:
    outputs: list[OutputItem] = field(default_factory=list)
    artifacts: list[Artifact] = field(default_factory=list)
    payload: dict[str, Any] = field(default_factory=dict)
    usage: Usage = field(default_factory=Usage)
    trace: Trace = field(default_factory=Trace)
    code: int = 0
    msg: str = ""

    @property
    def text(self) -> str:
        """Return concatenated text from all text outputs (V1 compatibility)."""
        parts = [o.text for o in self.outputs if o.type == "text" and o.text]
        return "\n".join(parts)


@dataclass
class StreamChunk:
    """A single incremental piece of a streaming response."""
    delta: str = ""
    outputs: list[OutputItem] = field(default_factory=list)
    finish_reason: str | None = None
    usage: Usage | None = None


@dataclass
class ModelRegistryEntry:
    """Unified model definition — loaded from YAML (built-in) or DB (dynamic)."""

    model_key: str
    display_name: str
    model_type: int  # 1=text, 2=multimodal, 3=artifact
    provider_template_type: int  # 1-7
    agent_id: str = ""
    status: int = 1  # 1=active, 2=disabled
    is_builtin: bool = False
    description: str = ""
    icon_uri: str = ""
    io_profile: dict[str, Any] = field(default_factory=dict)
    config: dict[str, Any] = field(default_factory=dict)
    secrets: dict[str, str] = field(default_factory=dict)
