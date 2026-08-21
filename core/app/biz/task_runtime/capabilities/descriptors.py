"""The capability contract: what a capability *is*, independent of where it came from.

Every executable thing the runtime can dispatch — a builtin tool, a resolved
skill action, tomorrow a GUI action or an MCP server's tool — is described by
one :class:`CapabilityDescriptor` and executed through one
:class:`CapabilityHandler`. A :class:`CapabilityProvider` is the only thing that
knows the difference.

The interface is shaped after **remote** capability sources rather than the
local ones that exist today, because the local shape is a strict subset:

* ``resolve`` is ``async`` and may return ``None`` — a remote source can be
  unreachable, and a capability can be revoked between planning and execution,
  so a binding is never cached across a run boundary.
* ``list_descriptors`` takes a query and returns a **subset** — a single server
  may expose hundreds of tools, so "return the whole catalogue" is not an
  option a caller can rely on.

Three orthogonal descriptor fields answer three different questions, and no
consumer should infer one from another:

===================== ================================== =========================
field                 question                           consumer
===================== ================================== =========================
``required_sandbox``  which environments may it run in?  scheduling / sandbox lease
``workspace_access``  may it see / write the workspace?  mount construction
``effect``            does it change external state?     invocation policy
===================== ================================== =========================

``required_sandbox`` is a *candidate set*, not a count: it names every OS the
capability can run on, empty when it needs no sandbox. Which one a given task
actually gets is a scheduling decision (made once, against live capacity) that
lands in ``TaskSpec.selected_sandbox``; the descriptor only bounds it. That
split is what keeps the chain one-directional — the descriptor declares what is
allowed, the submitter picks inside it, and the executor verifies the pick is
still inside it without ever re-picking.

``workspace_access`` is a *declaration*, enforced where it can be: the command
backend builds the mount from it, so anything a capability runs out-of-process
is genuinely confined. An in-process handler still receives
:attr:`CapabilityContext.workspace` and is trusted to honour what it declared —
there is no in-process filesystem sandbox behind it.

``effect`` is mandatory and has no default on purpose: a policy that must
observe before every mutation can only be fail-closed if "forgetting to
declare" is impossible. A provider that cannot tell declares ``"mutate"``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Protocol, runtime_checkable

from ..sandbox.types import SANDBOX_OSES
from . import ids

if TYPE_CHECKING:
    from ..domain.models import TaskResult, TaskRun
    from ..sandbox.types import SandboxOS

CapabilityEffect = Literal["read", "mutate"]
WorkspaceAccess = Literal["none", "read_only", "read_write"]
CapabilityVisibility = Literal["public", "internal"]

_WORKSPACE_ACCESS_VALUES: frozenset[str] = frozenset(("none", "read_only", "read_write"))
_EFFECT_VALUES: frozenset[str] = frozenset(("read", "mutate"))
_VISIBILITY_VALUES: frozenset[str] = frozenset(("public", "internal"))

#: JSON-Schema annotation marking a parameter whose value must be kept out of
#: the persisted run. See :func:`split_sensitive_arguments`.
#:
#: **What is guaranteed:** the value never reaches ``TaskSpec.args``, and the
#: executor removes literal occurrences of it from the result text it writes —
#: replacing them in place, or redacting the whole field when the value is too
#: short to match unambiguously.
#:
#: **What is not:** a provider that transforms or encodes a secret before
#: reporting it owns that redaction — exact-match scrubbing cannot follow it.
#: And the split runs on the *nested* path only, where the sub-agent invoker
#: builds a child run from an LLM-chosen call. A top-level task arrives from the
#: planner with its arguments already inside the ``TaskSpec`` the submitter
#: persists, so a sensitive parameter there would still be stored verbatim;
#: closing that needs a secret transport surviving retry and recovery (the
#: private attribute used here does not), which is preparation-layer work. Until
#: then: do not declare ``sensitive`` on a capability top-level planning can reach.
SENSITIVE_SCHEMA_KEY = "sensitive"
REDACTED_PLACEHOLDER = "<redacted>"


@dataclass(frozen=True, slots=True)
class CapabilityDescriptor:
    """Everything planning and policy need to know about one capability."""

    capability_id: str
    parameter_schema: Mapping[str, Any]
    required_sandbox: tuple["SandboxOS", ...]
    workspace_access: WorkspaceAccess
    effect: CapabilityEffect
    description: str = ""
    when_to_use: str = ""
    visibility: CapabilityVisibility = "public"

    def __post_init__(self) -> None:
        """Reject a descriptor a provider should never have produced.

        ``Literal`` binds nothing at runtime and a provider is third-party code,
        so the fail-closed fields are checked here or not at all: an
        unrecognised ``visibility`` slips past the ``internal`` test and reaches
        the planner as public, and an unrecognised ``effect`` would fail open in
        any observe-before-mutate policy.
        """
        provider, local = ids.split_capability_id(self.capability_id)
        if not provider or not local:
            raise ValueError(
                f"capability_id must be namespaced as '<provider>{ids.CAPABILITY_ID_SEPARATOR}<name>', got {self.capability_id!r}"
            )
        if not isinstance(self.parameter_schema, Mapping):
            raise ValueError(
                f"{self.capability_id}: parameter_schema must be a mapping, got {type(self.parameter_schema).__name__}"
            )
        if self.workspace_access not in _WORKSPACE_ACCESS_VALUES:
            raise ValueError(f"{self.capability_id}: unknown workspace_access {self.workspace_access!r}")
        if self.effect not in _EFFECT_VALUES:
            raise ValueError(f"{self.capability_id}: unknown effect {self.effect!r}")
        if self.visibility not in _VISIBILITY_VALUES:
            raise ValueError(f"{self.capability_id}: unknown visibility {self.visibility!r}")
        if unknown := [os_name for os_name in self.required_sandbox if os_name not in SANDBOX_OSES]:
            raise ValueError(f"{self.capability_id}: unknown required_sandbox {unknown!r}")

    @property
    def provider_id(self) -> str:
        return ids.provider_of(self.capability_id)

    @property
    def workspace_is_writable(self) -> bool:
        """Whether the shared workspace may be mounted writable for this call.

        One rule for every provider: anything short of ``read_write`` gets a
        read-only mount, so durable output has exactly one home (the per-run
        result directory).
        """
        return self.workspace_access == "read_write"


@dataclass(frozen=True, slots=True)
class CapabilityContext:
    """Everything a handler needs to run one call.

    ``arguments`` holds the **real** values, including any the descriptor marked
    ``sensitive`` — those never appear in ``run.spec.args``, which is persisted
    verbatim. ``workspace`` / ``run_dir`` / ``result_dir`` are resolved once by the
    executor so handlers consume paths rather than each rebuilding them from
    identity fields.

    Two things the handler contract requires are carried by the runtime rather
    than by a field of their own, and are named here so nobody adds a duplicate:

    * **Cancellation** arrives as ordinary coroutine cancellation. A handler
      that holds a resource must release it on :class:`asyncio.CancelledError`.
    * **The call budget** — timeout, attempts, executor class — is
      ``run.execution_policy``.
    """

    run: "TaskRun"
    descriptor: CapabilityDescriptor
    arguments: Mapping[str, Any]
    workspace: Path
    run_dir: Path
    result_dir: Path
    started_at: int
    input_paths: tuple[Path, ...] = ()


@dataclass(frozen=True, slots=True)
class ResolveContext:
    """Caller identity a provider needs to authorise and bind a capability.

    Remote providers use it to pick credentials and to reject a capability the
    caller may no longer reach; local providers ignore most of it.
    """

    username: str = ""
    agent_instance_id: int = 0
    project_id: int = 0
    run_id: str = ""

    @classmethod
    def from_run(cls, run: "TaskRun") -> "ResolveContext":
        return cls(
            username=run.username,
            agent_instance_id=run.agent_instance_id,
            project_id=run.project_id,
            run_id=run.run_id,
        )


@dataclass(frozen=True, slots=True)
class CatalogueQuery:
    """A *subset* request. Callers must not assume the full catalogue fits.

    ``caller`` is what lets a provider return an *authorised* subset rather than
    everything it knows about; a remote source has no other way to tell whose
    catalogue it is building. :meth:`matches` deliberately ignores it — it does
    the mechanical filtering every provider shares, while authorisation stays
    with the provider that owns the credentials.
    """

    caller: ResolveContext = field(default_factory=ResolveContext)
    providers: tuple[str, ...] = ()
    search: str = ""
    limit: int | None = None
    include_internal: bool = False

    def matches(self, descriptor: CapabilityDescriptor) -> bool:
        if self.providers and descriptor.provider_id not in self.providers:
            return False
        if descriptor.visibility == "internal" and not self.include_internal:
            return False
        if self.search:
            haystack = f"{descriptor.capability_id}\n{descriptor.description}\n{descriptor.when_to_use}".lower()
            if self.search.lower() not in haystack:
                return False
        return True


class CapabilityHandler(Protocol):
    """Runs one resolved capability call and reports its terminal result."""

    async def execute(self, context: CapabilityContext) -> "TaskResult": ...


@dataclass(frozen=True, slots=True)
class CapabilityBinding:
    """A descriptor paired with the handler that can execute it right now."""

    descriptor: CapabilityDescriptor
    handler: CapabilityHandler


@runtime_checkable
class CapabilityProvider(Protocol):
    """One source of capabilities.

    ``provider_id`` is the namespace every capability this provider owns is
    prefixed with, so ids stay unambiguous as sources multiply.
    """

    provider_id: str

    async def resolve(self, capability_id: str, context: ResolveContext) -> CapabilityBinding | None: ...

    async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]: ...


# ---------------------------------------------------------------------------
# Sensitive parameters
# ---------------------------------------------------------------------------


def sensitive_parameter_names(parameter_schema: Mapping[str, Any]) -> frozenset[str]:
    """Names the schema annotated with ``sensitive: true``."""
    properties = parameter_schema.get("properties")
    if not isinstance(properties, Mapping):
        return frozenset()
    return frozenset(
        name for name, node in properties.items() if isinstance(node, Mapping) and node.get(SENSITIVE_SCHEMA_KEY) is True
    )


def split_sensitive_arguments(
    arguments: Mapping[str, Any],
    parameter_schema: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Split call arguments into a persistable half and a secret half.

    The first return value is safe to write into ``TaskSpec.args`` (and therefore
    into the run snapshot the backend stores verbatim); the second must only ever
    travel in :class:`CapabilityContext`.
    """
    secret_names = sensitive_parameter_names(parameter_schema)
    if not secret_names:
        return dict(arguments), {}
    public: dict[str, Any] = {}
    secret: dict[str, Any] = {}
    for name, value in arguments.items():
        if name in secret_names:
            public[name] = REDACTED_PLACEHOLDER
            secret[name] = value
        else:
            public[name] = value
    return public, secret
