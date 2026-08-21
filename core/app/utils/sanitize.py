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
