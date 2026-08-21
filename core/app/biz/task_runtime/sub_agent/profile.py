"""Agent profile resolution for the sub-agent runtime.

A profile is the *behaviour configuration* of a sub-agent run: the system
prompt that shapes its reasoning, the capability ceiling that bounds what it may
call, and invocation/completion policies. The resolver exposes two
entry points — one for planning (what profiles exist?) and one for execution
(give me the full config for this id).

The only implementation shipped today is :class:`StaticAgentProfileResolver`,
a dict-backed mapping registered at composition root. Unknown or unmapped
profile ids are **deterministically rejected** — there is no silent fallback to
a "default" profile.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, fields, is_dataclass
from typing import TYPE_CHECKING, Literal, Protocol, TypeAlias

from ..capabilities.descriptors import ResolveContext

if TYPE_CHECKING:
    from ..capabilities.descriptors import CapabilityDescriptor
    from ..domain.models import TaskRun
    from .loop import CapabilityCall, FinalAnswer, Observation


ALL_CAPABILITIES: Literal["*"] = "*"
CapabilityCeiling: TypeAlias = frozenset[str] | Literal["*"]


def ceiling_allows(ceiling: CapabilityCeiling, capability_id: str) -> bool:
    """Whether a profile ceiling contains one explicitly requested capability."""
    return ceiling == ALL_CAPABILITIES or capability_id in ceiling


@dataclass(frozen=True, slots=True)
class InvocationPolicyContext:
    """Execution facts available when a model proposes a capability call."""

    run: TaskRun
    profile_id: str
    step: int
    descriptor: CapabilityDescriptor
    history: tuple[Observation, ...]


@dataclass(frozen=True, slots=True)
class InvocationPolicyDecision:
    """Whether one proposed capability call may proceed."""

    allowed: bool
    reason: str = ""

    def __post_init__(self) -> None:
        if not isinstance(self.allowed, bool):
            raise ValueError("allowed must be a bool")


class InvocationPolicy(Protocol):
    """Profile-specific gate evaluated before a capability is invoked."""

    async def evaluate(
        self,
        context: InvocationPolicyContext,
        call: CapabilityCall,
    ) -> InvocationPolicyDecision: ...


@dataclass(frozen=True, slots=True)
class CompletionPolicyContext:
    """Execution facts available when a model proposes a final answer."""

    run: TaskRun
    profile_id: str
    step: int
    history: tuple[Observation, ...]


@dataclass(frozen=True, slots=True)
class CompletionPolicyDecision:
    """How the host should handle a model's completion proposal."""

    outcome: Literal["accept", "continue", "reject"]
    reason: str = ""

    def __post_init__(self) -> None:
        if self.outcome not in {"accept", "continue", "reject"}:
            raise ValueError(f"unknown completion policy outcome {self.outcome!r}")


class CompletionPolicy(Protocol):
    """Independently decides whether a model-proposed answer is terminal."""

    async def evaluate(
        self,
        context: CompletionPolicyContext,
        proposal: FinalAnswer,
    ) -> CompletionPolicyDecision: ...


@dataclass(frozen=True, slots=True)
class AcceptModelCompletionPolicy:
    """Preserve the general profile's current model-declared completion semantics."""

    async def evaluate(
        self,
        context: CompletionPolicyContext,
        proposal: FinalAnswer,
    ) -> CompletionPolicyDecision:
        return CompletionPolicyDecision(outcome="accept")


@dataclass(frozen=True, slots=True)
class ProfileDescriptor:
    """Planning-visible metadata — no prompt, no policy objects."""

    profile_id: str
    when_to_use: str
    capability_ceiling: CapabilityCeiling


def profile_descriptor_payload(descriptor: ProfileDescriptor) -> dict[str, object]:
    """Project one descriptor into the exact metadata exposed to planners."""
    ceiling = descriptor.capability_ceiling
    return {
        "profile_id": descriptor.profile_id,
        "when_to_use": descriptor.when_to_use,
        "capability_ceiling": ceiling if ceiling == ALL_CAPABILITIES else sorted(ceiling),
    }


@dataclass(frozen=True, slots=True)
class AgentProfile:
    """Execution-time behavior, capability bounds, and policy for a sub-agent."""

    profile_id: str
    system_prompt: str
    capability_ceiling: CapabilityCeiling
    invocation_policies: tuple[InvocationPolicy, ...] = ()
    completion_policy: CompletionPolicy = AcceptModelCompletionPolicy()

    def __post_init__(self) -> None:
        if not self.profile_id.strip():
            raise ValueError("profile_id must not be empty")
        for policy in (*self.invocation_policies, self.completion_policy):
            _validate_declarative_policy(policy)


@dataclass(frozen=True, slots=True)
class ProfileQuery:
    """Subset request for :meth:`AgentProfileResolver.list_profiles`."""

    caller: ResolveContext = ResolveContext()
    search: str = ""
    limit: int | None = None


class AgentProfileResolver(Protocol):
    """Two-entry protocol: planning lists descriptors, execution resolves full profiles."""

    def list_profiles(self, query: ProfileQuery) -> tuple[ProfileDescriptor, ...]: ...

    def resolve(self, profile_id: str) -> AgentProfile | None: ...


class ProfileVisibilityPolicy(Protocol):
    """Caller-aware planning visibility for registered profiles."""

    def is_visible(self, descriptor: ProfileDescriptor, caller: ResolveContext) -> bool: ...


@dataclass(frozen=True, slots=True)
class AllProfilesVisible:
    def is_visible(self, descriptor: ProfileDescriptor, caller: ResolveContext) -> bool:
        return True


class StaticAgentProfileResolver:
    """Dict-backed implementation — the only one until GUI profiles land (Area 6)."""

    def __init__(
        self,
        profiles: Mapping[str, AgentProfile],
        *,
        descriptors: Mapping[str, ProfileDescriptor],
        visibility_policy: ProfileVisibilityPolicy | None = None,
    ) -> None:
        if profiles.keys() != descriptors.keys():
            raise ValueError("profile and descriptor ids must match")
        for profile_id, profile in profiles.items():
            descriptor = descriptors[profile_id]
            if profile_id != profile.profile_id or profile_id != descriptor.profile_id:
                raise ValueError(f"profile registration key {profile_id!r} must match its profile and descriptor ids")
            if profile.capability_ceiling != descriptor.capability_ceiling:
                raise ValueError(f"profile {profile_id!r} must use the same capability ceiling for planning and execution")
        self._profiles = dict(profiles)
        self._descriptors = dict(descriptors)
        self._visibility_policy = visibility_policy or AllProfilesVisible()

    def list_profiles(self, query: ProfileQuery) -> tuple[ProfileDescriptor, ...]:
        descriptors: list[ProfileDescriptor] = []
        for desc in self._descriptors.values():
            if not self._visibility_policy.is_visible(desc, query.caller):
                continue
            if query.search:
                haystack = f"{desc.profile_id}\n{desc.when_to_use}".lower()
                if query.search.lower() not in haystack:
                    continue
            descriptors.append(desc)
        if query.limit is not None and query.limit >= 0:
            descriptors = descriptors[: query.limit]
        return tuple(descriptors)

    def resolve(self, profile_id: str) -> AgentProfile | None:
        return self._profiles.get(profile_id)


def _validate_declarative_policy(policy: object) -> None:
    """Require policy construction state to be stable and content-identifiable."""
    if isinstance(policy, type) or not is_dataclass(policy):
        raise ValueError(f"policy {type(policy).__name__} must be a dataclass instance")
    dataclass_params = getattr(type(policy), "__dataclass_params__", None)
    if dataclass_params is None or not dataclass_params.frozen:
        raise ValueError(f"policy {type(policy).__name__} must be a frozen dataclass")
    parameters = {field.name: getattr(policy, field.name) for field in fields(policy)}
    _validate_json_value(parameters, path=type(policy).__name__)


def _validate_json_value(value: object, *, path: str) -> None:
    if value is None or isinstance(value, (bool, int, float, str)):
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _validate_json_value(item, path=f"{path}[{index}]")
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"policy parameter {path} must use string mapping keys")
            _validate_json_value(item, path=f"{path}.{key}")
        return
    raise ValueError(f"policy parameter {path} must be JSON-compatible, got {type(value).__name__}")
