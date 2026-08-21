"""Protocol implemented by every concrete task-run executor."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..domain.models import TaskResult, TaskRun
from ..storage.run_store import RunStore


@runtime_checkable
class Executor(Protocol):
    """Claim, execute, and persist exactly one prepared run."""

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult: ...
