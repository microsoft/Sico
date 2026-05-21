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

import re
from typing import Any

_MEM0_WHITESPACE_RE = re.compile(r"\s+")
_MULTI_DASH_RE = re.compile(r"-+")
_MULTI_UNDERSCORE_RE = re.compile(r"_+")
_DNS_UNSAFE_RE = re.compile(r"[^a-z0-9-]+")
_TOOL_NAME_UNSAFE_RE = re.compile(r"[^a-zA-Z0-9_-]+")


def sanitize_mem0_entity_id(value: Any) -> str | None:
    if value is None:
        return None
    sanitized = _MEM0_WHITESPACE_RE.sub("_", str(value).strip())
    return sanitized or None


def sanitize_user_id(user_id: str) -> str:
    return user_id.replace("@", "_at_").replace(":", "_")


def sanitize_dns_label(value: Any, *, max_len: int = 48, default: str = "u") -> str:
    sanitized = str(value).lower().replace("@", "-at-").replace("_", "-").replace(".", "-")
    sanitized = _DNS_UNSAFE_RE.sub("-", sanitized).strip("-")
    sanitized = _MULTI_DASH_RE.sub("-", sanitized)
    return sanitized[:max_len].rstrip("-") or default


def sanitize_tool_name(value: Any, *, default: str = "tool") -> str:
    sanitized = _TOOL_NAME_UNSAFE_RE.sub("_", str(value).strip())
    sanitized = _MULTI_UNDERSCORE_RE.sub("_", sanitized).strip("_-")
    return sanitized or default
