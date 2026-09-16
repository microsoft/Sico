"""Stable planning surface for building task-runtime submissions.

Chat preparation and future planners import from this module rather than reaching
into the runtime's domain, capability-provider, or catalogue implementation.
Execution entrypoints remain on :mod:`app.biz.task_runtime`.
"""

from .capabilities.catalogue import builtin_descriptors, skill_descriptors
from .capabilities.linux_workstation import linux_workstation_descriptors
from .capabilities.sandbox import (
    render_sandbox_delegation_section,
    sandbox_capability_descriptors,
    sandbox_capability_provider_ids,
)
from .capabilities.ids import (
    CapabilitySelector,
    builtin_capability_id,
    expand_capability_selectors,
    normalize_capability_id,
    normalize_capability_selector,
    parse_capability_selector,
    skill_capability_id,
)
from .domain.models import (
    CapabilityDispatch,
    Dispatch,
    JoinStrategy,
    PreparedTaskBatch,
    SubAgentDispatch,
    TaskBatchInput,
    TaskSpec,
)
from .guides import SkillGuideRef
from .sandbox.types import SANDBOX_OSES, normalize_sandbox_hint
from .capabilities.loader import CapabilityCard
from .capabilities.tool_catalog import (
    RUNTIME_TOOL_NAMES,
    RUNTIME_TOOLS,
    SUB_AGENT_BASELINE_TOOL_NAMES,
    render_runtime_tool_catalog,
    runtime_tool_names_inline,
)
from .sub_agent.profile import ProfileDescriptor, ProfileQuery, ceiling_allows, profile_descriptor_payload
from .capabilities.descriptors import CapabilityDescriptor, CatalogueQuery, ResolveContext

__all__ = [
    "CapabilityCard",
    "CapabilityDispatch",
    "CapabilityDescriptor",
    "CapabilitySelector",
    "CatalogueQuery",
    "Dispatch",
    "JoinStrategy",
    "PreparedTaskBatch",
    "ProfileDescriptor",
    "ProfileQuery",
    "RUNTIME_TOOLS",
    "RUNTIME_TOOL_NAMES",
    "SANDBOX_OSES",
    "SUB_AGENT_BASELINE_TOOL_NAMES",
    "SkillGuideRef",
    "SubAgentDispatch",
    "TaskBatchInput",
    "TaskSpec",
    "linux_workstation_descriptors",
    "builtin_capability_id",
    "builtin_descriptors",
    "ceiling_allows",
    "expand_capability_selectors",
    "normalize_capability_id",
    "normalize_capability_selector",
    "normalize_sandbox_hint",
    "profile_descriptor_payload",
    "render_runtime_tool_catalog",
    "render_sandbox_delegation_section",
    "ResolveContext",
    "runtime_tool_names_inline",
    "sandbox_capability_descriptors",
    "sandbox_capability_provider_ids",
    "parse_capability_selector",
    "skill_capability_id",
    "skill_descriptors",
]
