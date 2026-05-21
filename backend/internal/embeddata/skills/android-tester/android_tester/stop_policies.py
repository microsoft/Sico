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

from dataclasses import dataclass, field
from typing import Protocol

from android_tester.models import TaskStatus

_IGNORABLE_ACTIONS = frozenset({"scroll", "drag", "pressback"})


@dataclass(slots=True)
class StopContext:
    step: int
    consecutive_no_progress: int
    action_keys: list[str] = field(default_factory=list)


@dataclass(slots=True)
class StopDecision:
    status: TaskStatus
    reason: str


class StopPolicy(Protocol):
    def evaluate(self, context: StopContext) -> StopDecision | None:
        """Return a decision when the run should stop, else None."""


@dataclass(slots=True)
class MaxStepsPolicy:
    max_steps: int

    def evaluate(self, context: StopContext) -> StopDecision | None:
        if context.step > self.max_steps:
            return StopDecision(status=TaskStatus.FAILED,
                                reason="max steps reached")
        return None


@dataclass(slots=True)
class NoProgressPolicy:
    max_no_progress_steps: int

    def evaluate(self, context: StopContext) -> StopDecision | None:
        if (
            self.max_no_progress_steps >= 0
            and context.consecutive_no_progress >= self.max_no_progress_steps
        ):
            return StopDecision(status=TaskStatus.FAILED,
                                reason="no progress limit reached")
        return None


@dataclass(slots=True)
class RepetitiveActionPolicy:
    """Detect single-action repetition and multi-action cyclic patterns."""

    max_repetitions: int = 5

    def evaluate(self, context: StopContext) -> StopDecision | None:
        keys = context.action_keys
        if len(keys) < self.max_repetitions:
            return None
        if self._is_single_repetition(keys):
            return StopDecision(status=TaskStatus.FAILED,
                                reason="repetitive action detected")
        if self._is_cyclic_repetition(keys):
            return StopDecision(status=TaskStatus.FAILED,
                                reason="repetitive action cycle detected")
        return None

    def _is_single_repetition(self, keys: list[str]) -> bool:
        tail = keys[-self.max_repetitions :]
        if len(set(tail)) == 1 and not self._is_ignorable(tail[0]):
            return True
        return False

    def _is_cyclic_repetition(self, keys: list[str]) -> bool:
        max_window = self.max_repetitions * 3
        recent = keys[-max_window:]
        for pattern_len in range(2, (len(recent) // 3) + 1):
            if len(recent) < pattern_len * 3:
                continue
            tail = recent[-pattern_len * 3 :]
            pattern = tail[:pattern_len]
            if all(tail[i] == pattern[i % pattern_len]
                   for i in range(len(tail))):
                if not all(self._is_ignorable(k) for k in pattern):
                    return True
        return False

    @staticmethod
    def _is_ignorable(key: str) -> bool:
        action_name = key.split("-", 1)[0].lower()
        return action_name in _IGNORABLE_ACTIONS


def evaluate_policies(policies: list[StopPolicy],
                      context: StopContext,
                      ) -> StopDecision | None:
    for policy in policies:
        decision = policy.evaluate(context)
        if decision is not None:
            return decision
    return None
