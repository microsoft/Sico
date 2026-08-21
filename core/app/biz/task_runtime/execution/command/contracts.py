"""Command specifications, backend protocols, and shared path/env projection."""

from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from ...workspace.layout import workspace_layout

DEFAULT_BACKEND_TIMEOUT_SECONDS = 0


@dataclass(frozen=True)
class CommandMount:
    name: str
    host_path: str
    mount_path: str
    read_only: bool = False


def readonly_input_mounts(paths: Iterable[Path]) -> list[CommandMount]:
    roots = dict.fromkeys(path.parent for path in paths)
    return [
        CommandMount(
            name=f"source-input-{index}",
            host_path=str(root),
            mount_path=str(root),
            read_only=True,
        )
        for index, root in enumerate(roots)
    ]


@dataclass(frozen=True)
class CommandSpec:
    argv: list[str]
    image: str = ""
    cwd: str = ""
    env: dict[str, str] = field(default_factory=dict)
    mounts: list[CommandMount] = field(default_factory=list)
    timeout_seconds: int = DEFAULT_BACKEND_TIMEOUT_SECONDS
    pod_name: str = ""
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class CommandResult:
    return_code: int
    stdout: str = ""
    stderr: str = ""
    system_error: str = ""


def truncate_stream(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n...[truncated]"


class CommandBackend(Protocol):
    async def run(self, spec: CommandSpec) -> CommandResult: ...

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession: ...


class CommandSession(Protocol):
    async def run(self, spec: CommandSpec) -> CommandResult: ...

    async def aclose(self) -> None: ...


class StatelessSession:
    """No-op session wrapper for backends whose commands are independent."""

    def __init__(self, backend: CommandBackend) -> None:
        self._backend = backend

    async def run(self, spec: CommandSpec) -> CommandResult:
        return await self._backend.run(spec)

    async def aclose(self) -> None:
        return None


def to_host_path(path: str | Path) -> str:
    """Translate a core-visible workspace or skill path to its host path."""
    resolved = Path(path).resolve()
    layout = workspace_layout()
    mapped = _mapped_host_path(resolved, root=layout.chat_root, base_env="TASK_RUNTIME_CONTAINER_HOSTPATH_BASE")
    if mapped != resolved:
        return str(mapped)
    return str(_mapped_host_path(resolved, root=layout.skill_root, base_env="TASK_RUNTIME_SKILL_HOSTPATH_BASE"))


def _mapped_host_path(path: Path, *, root: Path, base_env: str) -> Path:
    base = os.getenv(base_env, "").strip()
    if not base:
        return path
    try:
        relative = path.relative_to(root.resolve())
    except ValueError:
        return path
    return Path(base) / relative


def container_env(spec_env: dict[str, str]) -> dict[str, str]:
    """Merge explicitly allowlisted deployment settings into a command container."""
    env = dict(spec_env)
    if index := os.getenv("UV_DEFAULT_INDEX"):
        env.setdefault("UV_DEFAULT_INDEX", index)
    return env
