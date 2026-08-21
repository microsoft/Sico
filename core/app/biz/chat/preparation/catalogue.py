"""Caller-aware descriptor snapshots for task preparation."""

from __future__ import annotations

import logging
from typing import Protocol

from app.biz.task_runtime.planning import (
    CapabilityDescriptor,
    CatalogueQuery,
    builtin_descriptors,
    skill_descriptors,
)
from app.tools.common import ToolContext

from .models import PreparationError

_LOGGER = logging.getLogger(__name__)


class CapabilityCatalogue(Protocol):
    """Read-only planning port; it never resolves executable bindings."""

    async def list_descriptors(
        self,
        context: ToolContext,
        query: CatalogueQuery,
    ) -> tuple[CapabilityDescriptor, ...]: ...


class WorkspaceCapabilityCatalogue:
    """Default builtin/skill catalogue scoped by the per-turn workspace."""

    async def list_descriptors(
        self,
        context: ToolContext,
        query: CatalogueQuery,
    ) -> tuple[CapabilityDescriptor, ...]:
        if not _caller_matches(context, query):
            return ()
        descriptors: list[CapabilityDescriptor] = []
        if not query.providers or "builtin" in query.providers:
            descriptors.extend(descriptor for descriptor in builtin_descriptors() if query.matches(descriptor))
        if not query.providers or "skill" in query.providers:
            descriptors.extend(_skill_descriptors(context, query))
        if query.limit is not None and query.limit >= 0:
            descriptors = descriptors[: query.limit]
        return tuple(descriptors)


def _skill_descriptors(context: ToolContext, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
    loader = context.skill_loader
    if loader is None:
        return ()
    try:
        cards = loader.list_cards(visibility="any" if query.include_internal else "public")
    except Exception as exc:  # noqa: BLE001 - normalize source faults at the planning boundary.
        _LOGGER.warning("planning_skill_catalogue_failed", exc_info=True)
        raise PreparationError(
            f"skill capability catalogue is unavailable: {exc}",
            code="capability_catalogue_failed",
            details={"provider": "skill"},
        ) from exc
    return tuple(descriptor for descriptor in skill_descriptors(cards) if query.matches(descriptor))


def _caller_matches(context: ToolContext, query: CatalogueQuery) -> bool:
    caller = query.caller
    return (
        (not caller.username or caller.username == context.username)
        and (not caller.agent_instance_id or caller.agent_instance_id == int(context.agent_instance_id or 0))
        and (not caller.project_id or caller.project_id == context.project_id)
    )
