"""Runtime-local naming helpers.

Pure, stateless string transforms with no host dependencies. The runtime
vendors them here instead of importing from ``app.utils``, keeping
:mod:`app.biz.task_runtime` free of ``app.*`` imports for leaf utilities.
"""

from __future__ import annotations

import re
from typing import Any

_DNS_UNSAFE_RE = re.compile(r"[^a-z0-9-]+")
_MULTI_DASH_RE = re.compile(r"-+")


def sanitize_dns_label(value: Any, *, max_len: int = 48, default: str = "u") -> str:
    """Coerce ``value`` into a DNS-1123-style label (lowercase alnum + dashes)."""
    sanitized = str(value).lower().replace("@", "-at-").replace("_", "-").replace(".", "-")
    sanitized = _DNS_UNSAFE_RE.sub("-", sanitized).strip("-")
    sanitized = _MULTI_DASH_RE.sub("-", sanitized)
    return sanitized[:max_len].rstrip("-") or default
