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

"""Workspace filesystem layout port.

The runtime needs to know *where* on disk per-turn / per-user / per-skill
directories live, but it should not hard-depend on the host's concrete
``app.storage.fs`` module. This module defines the :class:`WorkspaceLayout`
protocol the runtime calls and an injection seam mirroring
:mod:`app.biz.task_runtime.factory`: a :class:`~contextvars.ContextVar` override
plus a lazily-built default that adapts the host's ``CHAT_FS`` / ``SKILLS_FS``.

Hosts (or tests) override the layout via :func:`set_workspace_layout`; the
default adapter imports ``app.storage.fs`` lazily so importing the runtime
package never pulls the host filesystem module at module load time. This keeps
the runtime free of top-level ``app.*`` coupling for the workspace-layout
concern.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from contextvars import Token


@runtime_checkable
class WorkspaceLayout(Protocol):
    """Resolves on-disk locations the runtime reads from / writes to."""

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int) -> Path:
        """Directory holding per-turn run state (sidechain results live under it)."""

    def workspace_path(self, agent_instance_id: int, username: str) -> Path:
        """The user's persistent chat workspace directory for an agent instance."""

    @property
    def chat_root(self) -> Path:
        """Root prefix of chat storage (used for host-path translation)."""

    @property
    def skill_root(self) -> Path:
        """Root prefix of staged skill storage (used for host-path translation)."""

    def skill_roots(
        self,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> list[tuple[str, int | str, Path]]:
        """``(scope_name, scope_id, root_path)`` for every provided non-empty scope."""

    def plan_exists(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int) -> bool:
        """Whether a persisted chat plan exists for the given turn / conversation."""


@dataclass(frozen=True)
class _StorageFsLayout:
    """Default :class:`WorkspaceLayout` adapting the host ``ChatFS`` / ``StorageFS``."""

    _chat_fs: Any
    _skills_fs: Any

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int) -> Path:
        return self._chat_fs.get_turn_path(agent_instance_id, username, turn_id)

    def workspace_path(self, agent_instance_id: int, username: str) -> Path:
        return self._chat_fs.get_workspace_path(agent_instance_id, username)

    @property
    def chat_root(self) -> Path:
        return self._chat_fs.root

    @property
    def skill_root(self) -> Path:
        return self._skills_fs.root

    def skill_roots(
        self,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> list[tuple[str, int | str, Path]]:
        return self._skills_fs.roots(
            project_id=project_id,
            agent_id=agent_id,
            agent_instance_id=agent_instance_id,
        )

    def plan_exists(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int) -> bool:
        return self._chat_fs.plan.exists(agent_instance_id, username, turn_id, conversation_id=conversation_id)


# Override slot for hosts / tests. A ContextVar (not a module global) so
# concurrent asyncio tasks each see their own layout and tests cannot leak
# overrides across each other — consistent with ``factory._TASK_MANAGER_FACTORY``.
_WORKSPACE_LAYOUT: contextvars.ContextVar[WorkspaceLayout | None] = contextvars.ContextVar("workspace_layout", default=None)

# Lazily-built default so module import never pulls ``app.storage.fs``.
_DEFAULT_LAYOUT: WorkspaceLayout | None = None


def workspace_layout() -> WorkspaceLayout:
    """Return the active :class:`WorkspaceLayout` (override if set, else default)."""
    override = _WORKSPACE_LAYOUT.get()
    if override is not None:
        return override
    global _DEFAULT_LAYOUT
    if _DEFAULT_LAYOUT is None:
        from app.storage.fs import CHAT_FS, SKILLS_FS

        _DEFAULT_LAYOUT = _StorageFsLayout(CHAT_FS, SKILLS_FS)
    return _DEFAULT_LAYOUT


def set_workspace_layout(layout: WorkspaceLayout | None) -> "Token[WorkspaceLayout | None]":
    """Install (or clear, when ``layout`` is ``None``) the workspace layout.

    Returns the :class:`~contextvars.Token` so callers can ``reset`` to the
    previous value, typically in a test teardown::

        token = set_workspace_layout(fake_layout)
        try:
            ...
        finally:
            reset_workspace_layout(token)
    """
    return _WORKSPACE_LAYOUT.set(layout)


def reset_workspace_layout(token: "Token[WorkspaceLayout | None]") -> None:
    """Reset the workspace-layout override to the value captured in ``token``."""
    _WORKSPACE_LAYOUT.reset(token)
