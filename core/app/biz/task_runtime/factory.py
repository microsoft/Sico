"""Factory + override registry for :class:`TaskManager` instances.

Production callers receive a freshly constructed manager bound to the backend
store. Tests (or any caller that needs to inject a mock or share a manager
across calls within an async task) can override resolution by setting a factory
via :func:`set_task_manager_factory`. The override is stored in a
:class:`~contextvars.ContextVar` so concurrent asyncio tasks do not bleed
factories into one another.

The dependency is one-way: this composition root imports ``TaskManager``;
``manager.py`` never imports the factory.
"""

from __future__ import annotations

import contextvars
import os
from collections.abc import Callable

from .context import TurnContext

from .config import _resolve_max_concurrency
from .execution.router import DispatchRouter
from .manager import TaskManager
from .storage.run_store import RunStore
from .workspace.layout import workspace_layout


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
    from .storage.artifact_store import default_artifact_store
    from .capabilities.builtin import BuiltinCapabilityProvider
    from .capabilities.resolver import CapabilityResolver
    from .capabilities.skill import SkillCapabilityProvider
    from .storage.db_store import DBRunStore
    from .capabilities.executor import CapabilityExecutor
    from .execution.command.limiter import limit_backend
    from .execution.command.selection import select_backend
    from .capabilities.loader import SkillLoader
    from .storage.file_store import FileRunStore
    from .sub_agent.executor import SubAgentExecutor
    from .sub_agent.invoker import RunCapabilityInvoker
    from .sub_agent.llm import HubSubAgentLLM
    from .sub_agent.profile_loader import default_agent_profile_resolver

    layout = workspace_layout()
    workspace_root = layout.workspace_path(ctx.agent_instance_id, ctx.username, conversation_id=ctx.conversation_id)
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
    command_backend = limit_backend(select_backend())
    # Dispatch is a closed two-member union: a deterministic ``capability`` call
    # or a bounded ``sub_agent`` loop. Every capability source - the runtime's own
    # payloads, registered skills, and later GUI / MCP - is a provider behind one
    # CapabilityResolver, so adding a source never adds a dispatch kind or a
    # routing branch. Both providers pick *where* their commands run
    # (local/docker/k8s) via the injected CommandBackend, keeping the capability
    # axis and the backend axis orthogonal.
    resolver = CapabilityResolver(
        (
            BuiltinCapabilityProvider(artifact_store=artifact_store, command_backend=command_backend),
            SkillCapabilityProvider(skill_loader, artifact_store=artifact_store, command_backend=command_backend),
        )
    )
    capability_executor = CapabilityExecutor(resolver)
    profile_resolver = default_agent_profile_resolver()
    sub_agent_executor = SubAgentExecutor(
        _sub_agent_loop_engine(HubSubAgentLLM(model=os.getenv("TASK_RUNTIME_SUBAGENT_MODEL", "").strip() or None)),
        RunCapabilityInvoker(capability_executor, resolver, store),
        profile_resolver=profile_resolver,
    )
    router = DispatchRouter(capability=capability_executor, sub_agent=sub_agent_executor)
    return TaskManager(
        store,
        router,
        max_concurrency=_resolve_max_concurrency(),
        sidechain_root=sidechain_root,
        skill_loader=skill_loader,
    )


def _sub_agent_loop_engine(model):
    from .sub_agent.loop import LangGraphAgentLoopEngine, MafAgentLoopEngine, NativeAgentLoopEngine

    provider = os.getenv("TASK_RUNTIME_AGENT_LOOP", "native").strip().lower()
    if provider == "native":
        return NativeAgentLoopEngine(model)
    if provider == "langgraph":
        return LangGraphAgentLoopEngine(model)
    if provider == "maf":
        return MafAgentLoopEngine(model)
    raise ValueError(f"Unsupported TASK_RUNTIME_AGENT_LOOP provider {provider!r}.")


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
