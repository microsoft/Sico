"""Single source of truth for the runtime's wall-clock timestamp helper."""

from __future__ import annotations

import time


def now_ms() -> int:
    """Current wall-clock time as integer milliseconds since the epoch."""
    return int(time.time() * 1000)
