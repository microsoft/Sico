from __future__ import annotations

from dataclasses import dataclass

from app.biz.task_runtime.domain.models import TaskRun
from app.biz.task_runtime.sub_agent.loop import CapabilityCall, Observation


@dataclass(frozen=True, slots=True)
class RuntimeTraceSnapshot:
    parent_run_id: str
    child_run_id: str
    call_id: str
    capability_id: str
    backend: str
    lease_id: str
    guide_version: str | None = None
    guide_content_hash: str | None = None

    @classmethod
    def capture_nested_call(
        cls,
        parent: TaskRun,
        child: TaskRun,
        call: CapabilityCall,
        observation: Observation,
        *,
        guide_version: str | None = None,
        guide_content_hash: str | None = None,
    ) -> RuntimeTraceSnapshot:
        return cls(
            parent_run_id=parent.run_id,
            child_run_id=observation.run_id or child.run_id,
            call_id=observation.call_id or call.call_id,
            capability_id=child.spec.capability_id,
            backend=child.executor,
            lease_id=child.sandbox.sandbox_id if child.sandbox is not None else "",
            guide_version=guide_version,
            guide_content_hash=guide_content_hash,
        )
