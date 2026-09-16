"""JSONL persistence for framework-neutral agent-loop events."""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import time
from dataclasses import asdict
from enum import Enum
from pathlib import Path
from typing import Any

from .events import AgentLoopEvent, ModelOutputDeltaEvent

_TRANSCRIPT_SCHEMA_VERSION = 1
_EVENT_SUFFIX = "Event"
_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


class AgentEventTranscript:
    """Append ordered loop events to one durable JSONL transcript."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = asyncio.Lock()
        self._pending: list[str] = []

    async def reset(self) -> None:
        async with self._lock:
            self._pending.clear()
            await asyncio.to_thread(_replace_with_empty_file, self.path)

    async def append(self, event: AgentLoopEvent) -> None:
        record = encode_agent_loop_event(event)
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"), default=_json_default) + "\n"
        async with self._lock:
            self._pending.append(line)
            if not isinstance(event, ModelOutputDeltaEvent) or len(self._pending) >= 32:
                await self._flush_locked()

    async def flush(self) -> None:
        async with self._lock:
            await self._flush_locked()

    async def _flush_locked(self) -> None:
        if not self._pending:
            return
        text = "".join(self._pending)
        self._pending.clear()
        await asyncio.to_thread(_append_text, self.path, text)


def encode_agent_loop_event(event: AgentLoopEvent) -> dict[str, Any]:
    """Encode one typed loop event without introducing a second event schema."""
    event_name = type(event).__name__
    if event_name.endswith(_EVENT_SUFFIX):
        event_name = event_name[: -len(_EVENT_SUFFIX)]
    return {
        "schema_version": _TRANSCRIPT_SCHEMA_VERSION,
        "event": _CAMEL_BOUNDARY.sub("_", event_name).lower(),
        "recorded_at_ms": time.time_ns() // 1_000_000,
        "data": asdict(event),
    }


def _append_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as transcript:
        transcript.write(text)
        transcript.flush()
        os.fsync(transcript.fileno())


def _replace_with_empty_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8"):
            pass
        os.replace(temp_path, path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def _json_default(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump(mode="json")
    if isinstance(value, Path):
        return str(value)
    return str(value)
