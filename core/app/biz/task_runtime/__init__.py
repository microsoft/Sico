"""Task runtime — durable batch execution for agent capability / sub-agent runs.

This package's **public API** is exactly the names re-exported here:

- Entrypoints: :class:`TaskManager`, :func:`default_task_manager`,
  :func:`set_task_manager_factory`, :func:`cancel_turn_task_runtime_once`,
    :func:`default_agent_profile_resolver`,
    :func:`reconcile_stale_task_runtime_once`,
    :func:`run_task_runtime_startup_reconciler`.
- Extension points (protocols a host implements/injects): :class:`RunStore`
  (persistence), :class:`Executor` (execution backend),
  :class:`CapabilityProvider` (a source of executable capabilities) together
  with :class:`CapabilityHandler` and the types their entry points exchange.
- Domain models: the dataclasses/enums describing a batch, run, spec and result.

Everything else (the ``orchestration``, ``presentation``, ``events``, ``sandbox``,
and ``sub_agent`` internals plus concrete ``storage`` and ``execution`` adapters)
may change without notice. Import from those submodules only when extending the
runtime itself.
"""

from .sub_agent.profile import (
    ALL_CAPABILITIES,
    AgentProfile,
    AgentProfileResolver,
    ProfileDescriptor,
    ProfileQuery,
    ProfileVisibilityPolicy,
    StaticAgentProfileResolver,
)
from .sub_agent.profile_loader import default_agent_profile_resolver
from .capabilities.descriptors import (
    CapabilityBinding,
    CapabilityContext,
    CapabilityDescriptor,
    CapabilityHandler,
    CapabilityProvider,
    CatalogueQuery,
    ResolveContext,
)
from .execution.contracts import Executor
from .factory import default_task_manager, set_task_manager_factory
from .manager import (
    TaskManager,
    cancel_turn_task_runtime_once,
)
from .orchestration.recovery import reconcile_stale_task_runtime_once, run_task_runtime_startup_reconciler
from .domain.models import (
    ArtifactRef,
    BatchRecord,
    BatchResult,
    BatchResultDigest,
    BatchStatus,
    ErrorClass,
    TaskResult,
    TaskResultDigest,
    TaskRun,
    TaskSpec,
    TaskStatus,
    compute_idempotency_key,
)
from .storage.run_store import RunStore

__all__ = [
    # Entrypoints
    "TaskManager",
    "default_task_manager",
    "set_task_manager_factory",
    "cancel_turn_task_runtime_once",
    "default_agent_profile_resolver",
    "reconcile_stale_task_runtime_once",
    "run_task_runtime_startup_reconciler",
    # Extension points (protocols)
    "RunStore",
    "Executor",
    # ... and everything implementing a capability provider needs: the two
    # protocols it satisfies, the types its entry points take and return.
    "CapabilityProvider",
    "CapabilityHandler",
    "CapabilityDescriptor",
    "CapabilityBinding",
    "CapabilityContext",
    "CatalogueQuery",
    "ResolveContext",
    # ... and agent profile resolution.
    "ALL_CAPABILITIES",
    "AgentProfile",
    "AgentProfileResolver",
    "ProfileDescriptor",
    "ProfileQuery",
    "ProfileVisibilityPolicy",
    "StaticAgentProfileResolver",
    # Domain models
    "ArtifactRef",
    "BatchRecord",
    "BatchResult",
    "BatchResultDigest",
    "BatchStatus",
    "ErrorClass",
    "TaskResult",
    "TaskResultDigest",
    "TaskRun",
    "TaskSpec",
    "TaskStatus",
    "compute_idempotency_key",
]
