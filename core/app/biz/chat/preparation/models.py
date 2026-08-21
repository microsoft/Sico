"""Neutral values exchanged by task input sources and the shared planner."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, TypeAlias

from app.biz.task_runtime.planning import PreparedTaskBatch, normalize_capability_id


@dataclass(frozen=True, slots=True)
class DirectCapability:
    """A deterministic call selected during preparation."""

    capability_id: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "capability_id", normalize_capability_id(self.capability_id))


@dataclass(frozen=True, slots=True)
class AgentInvocation:
    """A bounded agent loop selected during preparation."""

    profile_id: str
    capability_grants: tuple[str, ...] = ()
    max_model_turns: int | None = None

    def __post_init__(self) -> None:
        profile_id = self.profile_id.strip()
        if not profile_id:
            raise ValueError("profile_id must not be empty")
        if self.max_model_turns is not None and self.max_model_turns <= 0:
            raise ValueError("max_model_turns must be positive")
        grants = tuple(dict.fromkeys(normalize_capability_id(item) for item in self.capability_grants if item.strip()))
        object.__setattr__(self, "profile_id", profile_id)
        object.__setattr__(self, "capability_grants", grants)


ExecutionDecision: TypeAlias = DirectCapability | AgentInvocation


@dataclass(frozen=True, slots=True)
class WorkItem:
    """One format-neutral unit emitted by an input source."""

    item_id: str
    goal: str
    params: Mapping[str, Any] = field(default_factory=dict)
    title: str = ""
    prebound_decision: ExecutionDecision | None = None
    stage_hint: int | None = None
    sandbox_hint: str = ""
    allowed_capability_ids: frozenset[str] | None = None
    allowed_profile_ids: frozenset[str] | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.item_id.strip():
            raise ValueError("item_id must not be empty")
        if not self.goal.strip():
            raise ValueError("goal must not be empty")
        if self.stage_hint is not None and self.stage_hint < 0:
            raise ValueError("stage_hint must not be negative")


@dataclass(frozen=True, slots=True)
class PlannedWorkItem:
    """A work item after dispatch and execution stage have been decided."""

    source: WorkItem
    decision: ExecutionDecision
    stage: int = 0
    title: str = ""
    required_sandbox: tuple[str, ...] = ()
    selected_sandbox: str | None = None
    rationale: str = ""

    def __post_init__(self) -> None:
        if self.stage < 0:
            raise ValueError("stage must not be negative")
        if self.source.stage_hint is not None and self.stage != self.source.stage_hint:
            raise ValueError(
                f"planned stage {self.stage} conflicts with source stage_hint {self.source.stage_hint} "
                f"for {self.source.item_id!r}"
            )


@dataclass(frozen=True, slots=True)
class NeedsClarification:
    """Preparation understood part of the request but needs user input."""

    message: str
    code: str = "preparation_needs_clarification"
    details: Mapping[str, Any] = field(default_factory=dict)
    understood: tuple[str, ...] = ()
    missing: tuple[str, ...] = ()
    suggestions: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Rejected:
    """Preparation deterministically cannot execute the request."""

    message: str
    code: str = "preparation_rejected"
    details: Mapping[str, Any] = field(default_factory=dict)


class PreparationError(RuntimeError):
    """Operational preparation failure that is neither clarification nor rejection."""

    def __init__(self, message: str, *, code: str = "preparation_failed", details: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = dict(details or {})


PreparationOutcome: TypeAlias = PreparedTaskBatch | NeedsClarification | Rejected
