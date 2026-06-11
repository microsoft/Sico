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

"""Per-turn timing telemetry for the chat service.

Records the wall-clock cost of each chat-turn pipeline stage (route, intent
check, prompt build, agent build, stream submit, response drain, …) and emits a
single structured log line per turn. These stages are chat-specific, so the
telemetry lives next to the chat service rather than in the task runtime.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from app.biz.chat.types import ChatRouteMode

_LOGGER = logging.getLogger(__name__)

_T = TypeVar("_T")

_TIMING_STAGES = (
    "route_ms",
    "intent_check_ms",
    "prompt_build_ms",
    "workspace_init_ms",
    "user_message_build_ms",
    "tools_build_ms",
    "agent_build_ms",
    "stream_submit_ms",
    "response_drain_ms",
    "turn_total_ms",
)


@dataclass
class TurnTimings:
    started_at: float = field(default_factory=time.perf_counter)
    stages: dict[str, int] = field(default_factory=dict)

    def record(self, stage: str, started_at: float) -> None:
        self.stages[stage] = int((time.perf_counter() - started_at) * 1000)

    def log(self, *, conversation_id: int, turn_id: int, route: ChatRouteMode) -> None:
        elapsed_ms = int((time.perf_counter() - self.started_at) * 1000)
        payload = {stage: self.stages.get(stage, 0) for stage in _TIMING_STAGES}
        _LOGGER.info(
            "chat_turn_runtime_timing conversation_id=%s turn_id=%s route=%s elapsed_ms=%s stages=%s",
            conversation_id,
            turn_id,
            route.value,
            elapsed_ms,
            payload,
        )


def begin_turn() -> TurnTimings:
    return TurnTimings()


def time_sync(timings: TurnTimings, stage: str, func: Callable[..., _T], *args: Any, **kwargs: Any) -> _T:
    started_at = time.perf_counter()
    result = func(*args, **kwargs)
    timings.record(stage, started_at)
    return result


async def time_awaitable(timings: TurnTimings, stage: str, awaitable: Awaitable[_T]) -> _T:
    started_at = time.perf_counter()
    result = await awaitable
    timings.record(stage, started_at)
    return result
