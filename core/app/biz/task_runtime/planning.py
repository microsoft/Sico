"""Stable planning surface for building task-runtime submissions.

Chat preparation and future planners import from this module rather than reaching
into the runtime's domain, capability-provider, or catalogue implementation.
Execution entrypoints remain on :mod:`app.biz.task_runtime`.
"""

from .capabilities.catalogue import builtin_descriptors, skill_descriptors
from .capabilities.ids import builtin_capability_id, normalize_capability_id, skill_capability_id
from .domain.models import (
    CapabilityDispatch,
    Dispatch,
    JoinStrategy,
    PreparedTaskBatch,
    SubAgentDispatch,
    TaskBatchInput,
    TaskSpec,
)
from .sandbox.types import SANDBOX_OSES, normalize_sandbox_hint
from .capabilities.loader import CapabilityCard
from .capabilities.tool_catalog import RUNTIME_TOOL_NAMES, RUNTIME_TOOLS, render_runtime_tool_catalog, runtime_tool_names_inline
from .sub_agent.profile import ProfileDescriptor, ProfileQuery, ceiling_allows, profile_descriptor_payload
from .capabilities.descriptors import CapabilityDescriptor, CatalogueQuery, ResolveContext

__all__ = [
    "CapabilityCard",
    "CapabilityDispatch",
    "CapabilityDescriptor",
    "CatalogueQuery",
    "Dispatch",
    "JoinStrategy",
    "PreparedTaskBatch",
    "ProfileDescriptor",
    "ProfileQuery",
    "RUNTIME_TOOLS",
    "RUNTIME_TOOL_NAMES",
    "SANDBOX_OSES",
    "SubAgentDispatch",
    "TaskBatchInput",
    "TaskSpec",
    "builtin_capability_id",
    "builtin_descriptors",
    "ceiling_allows",
    "normalize_capability_id",
    "normalize_sandbox_hint",
    "profile_descriptor_payload",
    "render_runtime_tool_catalog",
    "ResolveContext",
    "runtime_tool_names_inline",
    "skill_capability_id",
    "skill_descriptors",
]
