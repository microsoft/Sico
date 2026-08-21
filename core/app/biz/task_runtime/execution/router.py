"""Execution backends for the task runtime.

The runtime separates *orchestration* (scheduling, retry, progress, join — owned
by :class:`~app.biz.task_runtime.manager.TaskManager`) from *execution*
(physically running one prepared :class:`TaskRun`). Everything on the execution
side implements a single tiny contract::

    class Executor(Protocol):
        async def run(self, run: TaskRun, store: RunStore) -> TaskResult: ...

Concrete executors:

- :class:`CapabilityExecutor` — one deterministic capability call, whatever
  provider owns it (builtin tool, skill action, later GUI / MCP). Where a
  command physically runs (host / docker / k8s) is decided one level down by
    :func:`~app.biz.task_runtime.execution.command.selection.select_backend`,
  so this *dispatch* layer never branches on the execution backend.
- ``SubAgentExecutor``       — a bounded LLM loop over a capability allow-list.

:class:`DispatchRouter` is itself an ``Executor``; it is the *only* executor the
``TaskManager`` holds. It matches on the closed two-member dispatch union — a
single deterministic call, or a bounded reasoning loop — which is the one
distinction that survives new capability sources.
"""

from __future__ import annotations

from ..domain.models import TaskResult, TaskRun
from ..domain.results import build_user_input_result
from ..storage.run_store import RunStore
from .contracts import Executor


class DispatchRouter:
    """Routes a run to the right concrete :class:`Executor`.

    The union is closed and has exactly two members, so this is one match rather
    than an extension point:

    1. ``dispatch.type == "sub_agent"`` → the sub-agent executor.
    2. ``dispatch.type == "capability"`` → the capability executor.

    Adding a capability *source* (GUI, MCP, a remote worker) adds a provider
    behind the capability executor, never a branch here. The execution *backend*
    (local / docker / k8s) is likewise not a routing dimension: it is resolved
    inside the handler via
    :func:`~app.biz.task_runtime.execution.command.selection.select_backend`.

    An unconfigured sub-agent executor yields a deterministic user-input failure
    rather than raising — the manager treats that as a normal failed run.
    """

    def __init__(self, capability: Executor, *, sub_agent: Executor | None = None) -> None:
        self._capability = capability
        self._sub_agent = sub_agent

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        if run.spec.kind == "sub_agent":
            if self._sub_agent is None:
                return await self._reject(
                    run,
                    store,
                    "No sub-agent executor is configured for this task runtime.",
                )
            return await self._sub_agent.run(run, store)
        return await self._capability.run(run, store)

    async def _reject(self, run: TaskRun, store: RunStore, message: str) -> TaskResult:
        token = await store.claim_run(run.run_id, "dispatch-router")
        result = build_user_input_result(run, message)
        await store.write_result(run.run_id, result, token)
        return result
