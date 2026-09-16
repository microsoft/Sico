"""Resolve a skill action's declared execution placement for one run."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Protocol

from ...sandbox.types import SandboxType
from .linux_workstation import LinuxWorkstationCommandBackend
from .contracts import CommandBackend
from .limiter import limit_backend
from .selection import active_backend_kind, backend_resource_key

if TYPE_CHECKING:
    from app.biz.skill.resolver import ResolvedExecutionRequirement
    from ...domain.models import TaskRun


class CommandBackendResolutionError(ValueError):
    """The action requests an execution placement unavailable for this run."""


class CommandBackendResolver(Protocol):
    def resolve(self, requirement: ResolvedExecutionRequirement, run: TaskRun) -> CommandBackend: ...


class SkillCommandBackendResolver:
    """Keep ``any`` on the configured worker and enforce explicit placement."""

    def __init__(
        self,
        configured_backend: CommandBackend,
        *,
        factories: Mapping[str, Callable[[], CommandBackend]] | None = None,
        linux_workstation_factory: Callable[[TaskRun], CommandBackend] | None = None,
    ) -> None:
        self._configured_backend = configured_backend
        configured_kind = active_backend_kind()
        configured_placement = {"k8s": "kubernetes", "runner": "docker"}.get(configured_kind, configured_kind)
        self._factories = (
            dict(factories) if factories is not None else {configured_placement: lambda: self._configured_backend}
        )
        self._linux_workstation_factory = linux_workstation_factory or LinuxWorkstationCommandBackend.from_run

    def resolve(self, requirement: ResolvedExecutionRequirement, run: TaskRun) -> CommandBackend:
        placement = requirement.backend
        if placement == "any":
            return self._configured_backend
        if placement == SandboxType.LINUX_WORKSTATION.value:
            if run.sandbox is None:
                raise CommandBackendResolutionError(
                    "execution backend 'linux_workstation' requires an acquired Linux Workstation sandbox lease"
                )
            if run.sandbox.type != SandboxType.LINUX_WORKSTATION.value:
                raise CommandBackendResolutionError(
                    "execution backend 'linux_workstation' requires lease type "
                    f"'linux_workstation', got {run.sandbox.type!r}"
                )
            return self._linux_workstation_factory(run)
        factory = self._factories.get(placement)
        if factory is None:
            raise CommandBackendResolutionError(f"execution backend {placement!r} is unavailable")
        try:
            backend = factory()
        except Exception as exc:
            raise CommandBackendResolutionError(f"execution backend {placement!r} is unavailable: {exc}") from exc
        resource_kind = "k8s" if placement == "kubernetes" else placement
        if backend is self._configured_backend:
            return backend
        return limit_backend(backend, key=backend_resource_key(resource_kind))
