"""Output broker protocol and transport implementations.

A broker is a thin transport: it accepts a structured event (an event
name plus a payload) and ships it somewhere — stdout, a JSONL file,
the network, etc.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import UTC, datetime
from typing import IO, Any, Protocol, runtime_checkable

from android_tester.utils import coerce_to_json

logger = logging.getLogger(__name__)


def _utc_iso() -> str:
    return datetime.now(UTC).isoformat()


@runtime_checkable
class OutputBroker(Protocol):
    """Minimal transport contract: emit a single named event."""

    async def emit(self, event: str, **payload: Any) -> None: ...


class JsonlBroker:
    """Emits each event as a single JSON line to a text stream.

    The stream is not owned by the broker; the caller is responsible
    for opening and closing it. A lock guards ``write``/``flush`` so
    a single broker instance can be safely shared across concurrent
    asyncio tasks.
    """

    def __init__(self, stream: IO[str] | None = None) -> None:
        self._stream: IO[str] = (
            stream if stream is not None else sys.stdout
        )
        self._write_lock = asyncio.Lock()

    async def emit(self,
                   event: str,
                   **payload: Any,
                   ) -> None:
        record: dict[str, Any] = {
            "event": event,
            "timestamp": _utc_iso(),
        }
        for key, value in payload.items():
            if value is None:
                continue
            record[key] = value
        message = json.dumps(
            record, ensure_ascii=False, default=coerce_to_json,
        ) + "\n"
        async with self._write_lock:
            self._stream.write(message)
            self._stream.flush()
