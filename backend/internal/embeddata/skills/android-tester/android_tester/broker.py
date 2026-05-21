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
    asyncio workers (e.g. a stdout progress broker shared by a batch
    runner).
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
