"""Stable source-inspection failures shared by read and execution consumers."""

from __future__ import annotations

from typing import Any


class SourceError(ValueError):
    def __init__(self, message: str, *, code: str = "source_failed", details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}
