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

"""Factory + override registry for :class:`TaskManager` instances.

Production callers receive a freshly constructed manager bound to the backend
store. Tests (or any caller that needs to inject a mock or share a manager
across calls within an async task) can override resolution by setting a factory
via :func:`set_task_manager_factory`. The override is stored in a
:class:`~contextvars.ContextVar` so concurrent asyncio tasks do not bleed
factories into one another.

``TaskManager`` is imported lazily inside :func:`default_task_manager` to avoid
a circular import (``manager.py`` re-exports the names defined here).
"""

from __future__ import annotations

import contextvars
import os
from collections.abc import Callable
from typing import TYPE_CHECKING

from .context import TurnContext

from .config import _resolve_max_concurrency
from .executors.base import DispatchRouter
from .store import RunStore
from .workspace import workspace_layout

if TYPE_CHECKING:
    from .manager import TaskManager


# Factory override for tests / non-default deployments. A ContextVar (rather
# than a module global) keeps each concurrent asyncio task on its own factory
# and stops tests from leaking overrides across each other.
_TASK_MANAGER_FACTORY: contextvars.ContextVar[Callable[[TurnContext], "TaskManager"] | None] = contextvars.ContextVar(
    "task_manager_factory", default=None
)


def default_task_manager(ctx: TurnContext) -> "TaskManager":
    """Return the ``TaskManager`` to use for a tool invocation.

    Honors a factory override set via :func:`set_task_manager_factory`;
    otherwise builds a fresh manager bound to the backend store.
    """
    override = _TASK_MANAGER_FACTORY.get()
    if override is not None:
        return override(ctx)
    from .artifact_store import default_artifact_store
    from .db_store import DBRunStore
    from .executors.command_backend import select_backend
    from .executors.skill_executor import SkillExecutor
    from .executors.sub_agent import ExecutorCapabilityInvoker, SubAgentExecutor
    from .executors.tool_executor import ToolExecutor
    from .manager import TaskManager
    from .skill_loader import SkillLoader
    from .store import FileRunStore
    from .sub_agent_llm import HubSubAgentLLM

    layout = workspace_layout()
    workspace_root = layout.workspace_path(ctx.agent_instance_id, ctx.username)
    # Keep this in sync with the cancel-reconcile fallback in
    # ``manager.cancel_turn_task_runtime_once`` (also ``workspace_root / "results"``).
    # Sidechain data lives under the per-user workspace so that read/context tools
    # (which only see the workspace tree) can inspect delegate-task artifacts.
    sidechain_root = workspace_root / "results"
    # Default to the backend-backed store so local + compose deployments behave the same;
    # set TASK_RUNTIME_RUN_STORE=file to fall back to per-turn filesystem storage in tests.
    if os.getenv("TASK_RUNTIME_RUN_STORE", "backend").strip().lower() in {"backend", "db", "mysql"}:
        store: RunStore = DBRunStore()
        sidechain_root.mkdir(parents=True, exist_ok=True)
    else:
        store = FileRunStore(sidechain_root)
    skill_loader = SkillLoader(workspace_root)
    artifact_store = default_artifact_store(sidechain_root / "artifacts")
    command_backend = select_backend()
    # Dispatch is unified through a DispatchRouter keyed purely on dispatch *kind*:
    # ``tool`` runs go to ToolExecutor, ``skill`` runs to SkillExecutor, and
    # ``sub_agent`` runs go to a bounded SubAgentExecutor - an LLM loop
    # (HubSubAgentLLM) over a capability allow-list whose calls are bridged back
    # to the tool/skill executors by ExecutorCapabilityInvoker. Both leaf
    # executors pick *where* their commands run (local/docker/k8s) via the
    # injected CommandBackend (command_backend.select_backend), so the
    # dispatch-kind axis and the backend axis stay orthogonal. The run coordinator
    # therefore never branches on kind.
    tool_executor = ToolExecutor(artifact_store=artifact_store, sandbox_backend=command_backend)
    skill_executor = SkillExecutor(skill_loader, artifact_store=artifact_store, sandbox_backend=command_backend)
    sub_agent_executor = SubAgentExecutor(
        HubSubAgentLLM(model=os.getenv("TASK_RUNTIME_SUBAGENT_MODEL", "").strip() or None, skill_loader=skill_loader),
        ExecutorCapabilityInvoker(tool_executor, skill_executor, store),
    )
    router = DispatchRouter(
        tool=tool_executor,
        skill=skill_executor,
        sub_agent=sub_agent_executor,
    )
    return TaskManager(
        store,
        router,
        max_concurrency=_resolve_max_concurrency(),
        sidechain_root=sidechain_root,
        skill_loader=skill_loader,
    )


def set_task_manager_factory(
    factory: Callable[[TurnContext], "TaskManager"] | None,
) -> contextvars.Token:
    """Install (or clear, when ``factory`` is ``None``) a task manager factory.

    Returns the :class:`~contextvars.Token` so callers can ``reset`` to the
    previous value, typically in a test teardown::

        token = set_task_manager_factory(lambda ctx: my_manager)
        try:
            ...
        finally:
            _TASK_MANAGER_FACTORY.reset(token)
    """
    return _TASK_MANAGER_FACTORY.set(factory)
