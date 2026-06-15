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

"""Execution backends for the task runtime.

The runtime separates *orchestration* (scheduling, retry, progress, join — owned
by :class:`~app.biz.task_runtime.manager.TaskManager`) from *execution*
(physically running one prepared :class:`TaskRun`). Everything on the execution
side implements a single tiny contract::

    class Executor(Protocol):
        async def run(self, run: TaskRun, store: RunStore) -> TaskResult: ...

Concrete executors:

- :class:`ToolExecutor`      — builtin tools (echo / file conversion /
  ``run_command``). Where a ``run_command`` physically runs (host / docker / k8s)
  is decided one level down by
  :func:`~app.biz.task_runtime.executors.command_backend.select_backend`,
  so this *dispatch* layer never branches on the execution backend.
- ``SubAgentExecutor``       — a bounded LLM loop over a capability allow-list.

:class:`DispatchRouter` is itself an ``Executor``; it is the *only* executor the
``TaskManager`` holds. It routes a run to the right concrete executor purely by
dispatch *kind* (tool / skill / sub_agent), so the manager never branches on
dispatch type. The orthogonal *backend* axis (local / docker / k8s) lives in
:mod:`~app.biz.task_runtime.executors.command_backend`.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..models import TaskResult, TaskRun
from ..results import build_user_input_result
from ..store import RunStore


@runtime_checkable
class Executor(Protocol):
    """Physically runs a single prepared run and persists its result.

    Implementations MUST claim the run via ``store.claim_run`` before mutating
    it and MUST call ``store.write_result`` exactly once with the fencing token
    they obtained. Returning the same ``TaskResult`` is for the scheduler's
    convenience; the store is the source of truth.
    """

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult: ...


class DispatchRouter:
    """Routes a run to the right concrete :class:`Executor`.

    Routing precedence (by dispatch *kind* only):

    1. ``dispatch.type == "sub_agent"`` → the sub-agent executor.
    2. ``dispatch.type == "skill"`` → the skill executor.
    3. everything else (tool) → the tool executor.

    The execution *backend* (local / docker / k8s) is intentionally not a routing
    dimension here: it is resolved inside the executor via
    :func:`~app.biz.task_runtime.executors.command_backend.select_backend`.

    An unconfigured sub-agent or skill executor yields a deterministic user-input
    failure rather than raising — the manager treats that as a normal failed run.
    """

    def __init__(
        self,
        tool: Executor,
        *,
        sub_agent: Executor | None = None,
        skill: Executor | None = None,
    ) -> None:
        self._tool = tool
        self._sub_agent = sub_agent
        self._skill = skill

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        if run.spec.kind == "sub_agent":
            if self._sub_agent is None:
                return await self._reject(
                    run,
                    store,
                    "No sub-agent executor is configured for this task runtime.",
                )
            return await self._sub_agent.run(run, store)
        if run.spec.kind == "skill":
            if self._skill is None:
                return await self._reject(
                    run,
                    store,
                    "No skill executor is configured for this task runtime.",
                )
            return await self._skill.run(run, store)
        return await self._tool.run(run, store)

    async def _reject(self, run: TaskRun, store: RunStore, message: str) -> TaskResult:
        token = await store.claim_run(run.run_id, "dispatch-router")
        result = build_user_input_result(run, message)
        await store.write_result(run.run_id, result, token)
        return result
