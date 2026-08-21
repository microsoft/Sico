"""Composition root for chat task preparation."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .catalogue import CapabilityCatalogue, WorkspaceCapabilityCatalogue
from .planner import LlmTaskPlanner
from .service import DelegatePreparationService

if TYPE_CHECKING:
    from app.biz.task_runtime import AgentProfileResolver


def build_default_preparation_service(
    profile_resolver: "AgentProfileResolver",
    capability_catalogue: CapabilityCatalogue | None = None,
) -> DelegatePreparationService:
    return DelegatePreparationService(
        LlmTaskPlanner(),
        profile_resolver,
        capability_catalogue or WorkspaceCapabilityCatalogue(),
    )
