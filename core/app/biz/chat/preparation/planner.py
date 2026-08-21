"""Shared decision planner for every task input source."""

from __future__ import annotations

import json
import os
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import replace
from typing import Any, Literal, Protocol, TypeAlias

from json_schema_to_pydantic import SchemaError, create_model
from pydantic import BaseModel, ConfigDict, Field, ValidationError

import app.llmhubs
from app.biz.task_runtime.planning import CapabilityDescriptor, ProfileDescriptor, ceiling_allows, profile_descriptor_payload
from app.llmhubs.request_builder import build_llm_request

from .models import (
    AgentInvocation,
    DirectCapability,
    ExecutionDecision,
    NeedsClarification,
    PlannedWorkItem,
    PreparationError,
    Rejected,
    WorkItem,
)

_PLANNER_MODEL_ENV = "CHAT_TASK_PLANNER_MODEL"
_JSON_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)
_HOST_PROVIDED_ARGUMENTS = frozenset(("instructions", "task_id", "task_name", "title"))
_MAX_TASK_PLANNER_ITEMS = 100
_MAX_TASK_PLANNER_PAYLOAD_CHARS = 500_000


class _StrictArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlannedDecision(BaseModel):
    """One LLM decision for one unresolved work item."""

    model_config = ConfigDict(extra="forbid")

    item_id: str
    title: str = ""
    dispatch_type: Literal["capability", "sub_agent"]
    capability_id: str = ""
    profile_id: str = "default"
    max_model_turns: int | None = Field(default=None, ge=1)
    capability_grants: list[str] = Field(default_factory=list)
    stage: int = Field(default=0, ge=0)
    args_json: str = ""
    rationale: str = ""


class PlannerOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PlannedDecision]


PlanningResult: TypeAlias = tuple[PlannedWorkItem, ...] | NeedsClarification | Rejected
PlannerCall: TypeAlias = Callable[
    [str, Sequence[WorkItem], Sequence[PlannedWorkItem], tuple[CapabilityDescriptor, ...], tuple[ProfileDescriptor, ...]],
    Awaitable[PlannerOutput],
]


class TaskPlanner(Protocol):
    async def plan(
        self,
        batch_goal: str,
        items: Sequence[WorkItem],
        catalogue: tuple[CapabilityDescriptor, ...],
        profiles: tuple[ProfileDescriptor, ...],
    ) -> PlanningResult: ...


class LlmTaskPlanner:
    """Validate prebound decisions and plan every unresolved item in one LLM call."""

    def __init__(self, planner_call: PlannerCall | None = None) -> None:
        self._planner_call = planner_call or _run_planner

    async def plan(
        self,
        batch_goal: str,
        items: Sequence[WorkItem],
        catalogue: tuple[CapabilityDescriptor, ...],
        profiles: tuple[ProfileDescriptor, ...],
    ) -> PlanningResult:
        if not items:
            return Rejected("preparation produced no work items", code="preparation_no_items")
        duplicate_ids = _duplicates(item.item_id for item in items)
        if duplicate_ids:
            return Rejected(
                f"work item ids must be unique: {duplicate_ids}",
                code="preparation_duplicate_item_ids",
                details={"duplicate_item_ids": duplicate_ids},
            )

        descriptors = {descriptor.capability_id: descriptor for descriptor in catalogue}
        profile_index = {profile.profile_id: profile for profile in profiles}
        preplanned = _preplan_items(items, descriptors, profile_index)
        if isinstance(preplanned, (NeedsClarification, Rejected)):
            return preplanned
        planned, unresolved = preplanned
        if unresolved and not catalogue and not profiles:
            return Rejected(
                "no capability or sub-agent profile is available for unresolved work",
                code="preparation_no_available_execution",
            )
        if unresolved:
            llm_planned = await self._plan_unresolved(
                batch_goal,
                unresolved,
                tuple(planned.values()),
                catalogue,
                profiles,
                descriptors,
                profile_index,
            )
            if isinstance(llm_planned, (NeedsClarification, Rejected)):
                return llm_planned
            planned.update(llm_planned)

        return tuple(planned[item.item_id] for item in items)

    async def _plan_unresolved(  # noqa: PLR0913 - each argument is one immutable planning input.
        self,
        batch_goal: str,
        unresolved: list[WorkItem],
        prebound: tuple[PlannedWorkItem, ...],
        catalogue: tuple[CapabilityDescriptor, ...],
        profiles: tuple[ProfileDescriptor, ...],
        descriptors: Mapping[str, CapabilityDescriptor],
        profile_index: Mapping[str, ProfileDescriptor],
    ) -> dict[str, PlannedWorkItem] | NeedsClarification | Rejected:
        scope_issue = _planner_scope_issue(batch_goal, unresolved, prebound, catalogue, profiles)
        if scope_issue is not None:
            return scope_issue
        try:
            output = await self._planner_call(batch_goal, unresolved, prebound, catalogue, profiles)
        except PreparationError:
            raise
        except Exception as exc:  # noqa: BLE001 - normalize injected planner faults at the preparation boundary.
            raise PlannerCallError(f"planner LLM call failed: {exc}", code="task_planner_llm_failed") from exc
        output_by_id = {decision.item_id: decision for decision in output.items}
        expected_ids = [item.item_id for item in unresolved]
        if len(output.items) != len(unresolved) or set(output_by_id) != set(expected_ids):
            raise PlannerCallError(
                "planner output must contain exactly one decision for each unresolved work item",
                code="task_planner_invalid_output",
                details={"expected_item_ids": expected_ids, "received_item_ids": [item.item_id for item in output.items]},
            )
        planned: dict[str, PlannedWorkItem] = {}
        for item in unresolved:
            result = _planned_from_output(item, output_by_id[item.item_id], descriptors, profile_index)
            if isinstance(result, NeedsClarification):
                return result
            if isinstance(result, Rejected):
                if _is_source_argument_rejection(result, item):
                    return result
                raise PlannerCallError(str(result.message), code="task_planner_invalid_output", details=result.details)
            planned[item.item_id] = result
        return planned


class PlannerCallError(PreparationError):
    """The planner service or its structured response failed operationally."""


def _preplan_items(
    items: Sequence[WorkItem],
    descriptors: Mapping[str, CapabilityDescriptor],
    profiles: Mapping[str, ProfileDescriptor],
) -> tuple[dict[str, PlannedWorkItem], list[WorkItem]] | NeedsClarification | Rejected:
    planned: dict[str, PlannedWorkItem] = {}
    unresolved: list[WorkItem] = []
    for item in items:
        decision = item.prebound_decision
        if decision is None:
            unresolved.append(item)
            continue
        result = _validate_planned_item(
            item,
            decision,
            stage=item.stage_hint or 0,
            title=item.title,
            rationale="prebound by source caller",
            descriptors=descriptors,
            profiles=profiles,
        )
        if isinstance(result, (NeedsClarification, Rejected)):
            return result
        planned[item.item_id] = result
    return planned, unresolved


def _planned_from_output(
    item: WorkItem,
    raw: PlannedDecision,
    descriptors: Mapping[str, CapabilityDescriptor],
    profiles: Mapping[str, ProfileDescriptor],
) -> PlannedWorkItem | NeedsClarification | Rejected:
    decoded = _decode_arguments(raw.args_json)
    if isinstance(decoded, Rejected):
        return decoded
    decision = _decision_from_output(raw)
    if isinstance(decision, Rejected):
        return decision
    source = replace(item, params={**decoded, **dict(item.params)})
    return _validate_planned_item(
        source,
        decision,
        stage=raw.stage,
        title=raw.title,
        rationale=raw.rationale,
        descriptors=descriptors,
        profiles=profiles,
    )


def _validate_planned_item(  # noqa: PLR0911, PLR0913 - fail-fast outcomes keep validation reasons precise.
    item: WorkItem,
    decision: ExecutionDecision,
    *,
    stage: int,
    title: str,
    rationale: str,
    descriptors: Mapping[str, CapabilityDescriptor],
    profiles: Mapping[str, ProfileDescriptor],
) -> PlannedWorkItem | NeedsClarification | Rejected:
    if item.stage_hint is not None and stage != item.stage_hint:
        return Rejected(
            f"planned stage {stage} conflicts with source stage_hint {item.stage_hint} for {item.item_id!r}",
            code="preparation_stage_conflict",
            details={"item_id": item.item_id, "stage_hint": item.stage_hint, "planned_stage": stage},
        )
    if isinstance(decision, DirectCapability):
        if item.allowed_capability_ids is not None and decision.capability_id not in item.allowed_capability_ids:
            return Rejected(
                f"capability {decision.capability_id!r} is outside the source allow-list",
                code="preparation_disallowed_capability",
                details={"item_id": item.item_id, "capability_id": decision.capability_id},
            )
        descriptor = descriptors.get(decision.capability_id)
        if descriptor is None:
            return Rejected(
                f"capability {decision.capability_id!r} is not available to the caller",
                code="preparation_unknown_capability",
                details={"item_id": item.item_id, "capability_id": decision.capability_id},
            )
        arguments = _validate_arguments(item, descriptor)
        if isinstance(arguments, (NeedsClarification, Rejected)):
            return arguments
        item = replace(item, params=arguments)
        sandbox = _sandbox_selection(item, descriptor.required_sandbox)
        if isinstance(sandbox, Rejected):
            return sandbox
        required_sandbox, selected_sandbox = sandbox
    else:
        if item.allowed_profile_ids is not None and decision.profile_id not in item.allowed_profile_ids:
            return Rejected(
                f"sub-agent profile {decision.profile_id!r} is outside the source allow-list",
                code="preparation_disallowed_profile",
                details={"item_id": item.item_id, "profile_id": decision.profile_id},
            )
        profile = profiles.get(decision.profile_id)
        if profile is None:
            return Rejected(
                f"sub-agent profile {decision.profile_id!r} is not available to the caller",
                code="preparation_unknown_profile",
                details={"item_id": item.item_id, "profile_id": decision.profile_id},
            )
        grants = decision.capability_grants
        if item.allowed_capability_ids is not None:
            disallowed = sorted(set(grants) - set(item.allowed_capability_ids))
            if disallowed:
                return Rejected(
                    f"sub-agent grants exceed the source allow-list for {item.item_id!r}",
                    code="preparation_invalid_agent_grants",
                    details={"item_id": item.item_id, "disallowed_capabilities": disallowed},
                )
        unknown = sorted({grant for grant in grants if grant not in descriptors})
        outside_ceiling = sorted({grant for grant in grants if not ceiling_allows(profile.capability_ceiling, grant)})
        if unknown or outside_ceiling:
            return Rejected(
                f"sub-agent grants are outside the available catalogue or profile ceiling for {item.item_id!r}",
                code="preparation_invalid_agent_grants",
                details={"item_id": item.item_id, "unknown_capabilities": unknown, "outside_profile_ceiling": outside_ceiling},
            )
        decision = replace(decision, capability_grants=tuple(grants))
        sandbox = _agent_sandbox_selection(item, tuple(descriptors[grant] for grant in grants))
        if isinstance(sandbox, Rejected):
            return sandbox
        required_sandbox, selected_sandbox = sandbox

    try:
        return PlannedWorkItem(
            source=item,
            decision=decision,
            stage=stage,
            title=title,
            required_sandbox=required_sandbox,
            selected_sandbox=selected_sandbox,
            rationale=rationale,
        )
    except ValueError as exc:
        return Rejected(str(exc), code="preparation_invalid_plan", details={"item_id": item.item_id})


def _validate_arguments(
    item: WorkItem,
    descriptor: CapabilityDescriptor,
) -> dict[str, Any] | NeedsClarification | Rejected:
    schema = descriptor.parameter_schema
    properties = schema.get("properties")
    known = set(properties) if isinstance(properties, Mapping) else set()
    required = {str(name) for name in schema.get("required", ()) if str(name)}
    missing = sorted(name for name in required if name not in item.params and name not in _HOST_PROVIDED_ARGUMENTS)
    if missing:
        return NeedsClarification(
            f"{descriptor.capability_id} is missing required argument(s): {missing}",
            code="preparation_missing_arguments",
            details={"item_id": item.item_id, "capability_id": descriptor.capability_id, "missing_arguments": missing},
            understood=(f"Selected capability {descriptor.capability_id}",),
            missing=tuple(missing),
        )
    if known:
        unknown = sorted(name for name in item.params if name not in known)
        if unknown:
            return Rejected(
                f"{descriptor.capability_id} received unknown argument(s): {unknown}",
                code="preparation_invalid_arguments",
                details={
                    "item_id": item.item_id,
                    "capability_id": descriptor.capability_id,
                    "unknown_arguments": unknown,
                    "allowed_arguments": sorted(known),
                },
            )
    validation_schema = dict(schema)
    validation_schema["required"] = sorted(required - _HOST_PROVIDED_ARGUMENTS)
    try:
        argument_model = create_model(
            validation_schema,
            base_model_type=_StrictArguments,
            allow_undefined_type=True,
        )
    except (SchemaError, TypeError, ValueError) as exc:
        return Rejected(
            f"capability {descriptor.capability_id!r} has an invalid parameter schema: {exc}",
            code="preparation_invalid_capability_schema",
            details={"item_id": item.item_id, "capability_id": descriptor.capability_id},
        )
    try:
        normalized = argument_model.model_validate(dict(item.params)).model_dump(exclude_none=True)
    except ValidationError as exc:
        return Rejected(
            f"{descriptor.capability_id} arguments do not match its parameter schema",
            code="preparation_invalid_arguments",
            details={
                "item_id": item.item_id,
                "capability_id": descriptor.capability_id,
                "validation_errors": [_schema_error(error) for error in exc.errors(include_url=False)],
            },
        )
    return normalized


def _schema_error(error: dict[str, Any]) -> dict[str, Any]:
    error_type = str(error.get("type") or "")
    return {
        "path": ".".join(str(part) for part in error.get("loc", ())),
        "rule": _schema_rule(error_type),
        "message": str(error.get("msg") or "invalid value"),
    }


def _schema_rule(error_type: str) -> str:
    if error_type.endswith("_type") or error_type.endswith("_parsing"):
        return "type"
    if error_type == "literal_error":
        return "enum"
    if error_type in {"greater_than", "greater_than_equal"}:
        return "minimum"
    if error_type in {"less_than", "less_than_equal"}:
        return "maximum"
    return error_type


def _is_source_argument_rejection(rejection: Rejected, item: WorkItem) -> bool:
    if rejection.code != "preparation_invalid_arguments":
        return False
    source_arguments = set(item.params)
    unknown = rejection.details.get("unknown_arguments")
    if isinstance(unknown, list) and source_arguments.intersection(map(str, unknown)):
        return True
    validation_errors = rejection.details.get("validation_errors")
    if not isinstance(validation_errors, list):
        return False
    for error in validation_errors:
        if not isinstance(error, Mapping):
            continue
        root = str(error.get("path") or "").partition(".")[0]
        if root in source_arguments:
            return True
    return False


def _sandbox_selection(
    item: WorkItem,
    required_sandbox: tuple[str, ...],
) -> tuple[tuple[str, ...], str | None] | Rejected:
    hint = item.sandbox_hint.strip()
    if hint and hint not in required_sandbox:
        return Rejected(
            f"sandbox {hint!r} is incompatible with the selected capability for {item.item_id!r}",
            code="preparation_incompatible_sandbox",
            details={"item_id": item.item_id, "requested_sandbox": hint, "allowed_sandboxes": list(required_sandbox)},
        )
    return tuple(required_sandbox), hint or None


def _agent_sandbox_selection(
    item: WorkItem,
    descriptors: tuple[CapabilityDescriptor, ...],
) -> tuple[tuple[str, ...], str | None] | Rejected:
    constrained = [set(descriptor.required_sandbox) for descriptor in descriptors if descriptor.required_sandbox]
    if not constrained:
        return _sandbox_selection(item, ())
    compatible = set.intersection(*constrained)
    if not compatible:
        return Rejected(
            f"sub-agent grants for {item.item_id!r} do not share a compatible sandbox",
            code="preparation_incompatible_agent_grants",
            details={"item_id": item.item_id},
        )
    ordered = tuple(os_name for os_name in descriptors[0].required_sandbox if os_name in compatible)
    if not ordered:
        ordered = tuple(sorted(compatible))
    return _sandbox_selection(item, ordered)


def _decision_from_output(raw: PlannedDecision) -> ExecutionDecision | Rejected:
    if raw.dispatch_type == "capability":
        if not raw.capability_id.strip():
            return Rejected(
                f"planner decision for {raw.item_id!r} requires capability_id",
                code="task_planner_invalid_output",
            )
        return DirectCapability(raw.capability_id)
    return AgentInvocation(raw.profile_id, tuple(raw.capability_grants), raw.max_model_turns)


def _decode_arguments(args_json: str) -> dict[str, Any] | Rejected:
    if not args_json.strip():
        return {}
    try:
        decoded = json.loads(args_json)
    except json.JSONDecodeError as exc:
        return Rejected(f"planner args_json is invalid JSON: {exc}", code="task_planner_invalid_output")
    if not isinstance(decoded, dict):
        return Rejected("planner args_json must decode to an object", code="task_planner_invalid_output")
    return decoded


def _duplicates(values: Sequence[str] | Any) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


_PLANNER_SYSTEM_PROMPT = """\
You plan a batch of durable tasks. For each unresolved work item, choose exactly
one namespaced capability or one sub-agent profile from the supplied catalogues.
Return one decision per unresolved item, preserving item_id. A capability call
must provide literal JSON arguments matching its parameter_schema. A sub-agent
is appropriate only when execution needs a bounded observe/reason/act loop;
keep its grants inside both the supplied catalogue and profile ceiling.

Items sharing a stage run in parallel. Higher stages wait for every lower stage
to settle. Respect every stage_hint exactly and use higher stages only for real
producer/consumer dependencies. Reply with schema-matching JSON only.
"""


async def _run_planner(
    batch_goal: str,
    unresolved: Sequence[WorkItem],
    prebound: Sequence[PlannedWorkItem],
    catalogue: tuple[CapabilityDescriptor, ...],
    profiles: tuple[ProfileDescriptor, ...],
) -> PlannerOutput:
    payload = _planner_payload(batch_goal, unresolved, prebound, catalogue, profiles)
    payload_text = _planner_payload_text(payload)
    request = build_llm_request(
        [
            {"role": "system", "content": _PLANNER_SYSTEM_PROMPT},
            {"role": "user", "content": [{"type": "text", "text": payload_text}]},
        ],
        model=_model_name(),
        response_format=PlannerOutput,
    )
    try:
        response = await app.llmhubs.generate(request=request)
    except Exception as exc:  # noqa: BLE001
        raise PlannerCallError(f"planner LLM call failed: {exc}", code="task_planner_llm_failed") from exc
    if response.code != 0:
        raise PlannerCallError(
            f"planner LLM returned non-zero code: {response.msg}",
            code="task_planner_llm_failed",
            details={"code": response.code, "msg": response.msg},
        )
    structured = _structured_response(response)
    try:
        return PlannerOutput.model_validate(structured)
    except ValidationError as exc:
        raise PlannerCallError(
            f"planner LLM response failed schema validation: {exc.errors()}",
            code="task_planner_invalid_output",
            details={"raw": structured},
        ) from exc


def _structured_response(response: Any) -> Any:
    for output in response.outputs or ():
        if getattr(output, "json", None) is not None:
            return output.json
    text = response.outputs[0].text if response.outputs else ""
    text = text or getattr(response, "text", "") or ""
    if not text:
        raise PlannerCallError("planner LLM returned an empty response", code="task_planner_invalid_output")
    match = _JSON_FENCE_PATTERN.match(text.strip())
    payload = match.group(1).strip() if match else text.strip()
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise PlannerCallError(
            f"planner LLM response is not valid JSON: {exc}",
            code="task_planner_invalid_output",
            details={"raw_preview": text[:200]},
        ) from exc


def _work_item_payload(item: WorkItem) -> dict[str, Any]:
    return {
        "item_id": item.item_id,
        "goal": item.goal,
        "params": dict(item.params),
        "stage_hint": item.stage_hint,
        "sandbox_hint": item.sandbox_hint,
        "allowed_capability_ids": sorted(item.allowed_capability_ids) if item.allowed_capability_ids is not None else None,
        "allowed_profile_ids": sorted(item.allowed_profile_ids) if item.allowed_profile_ids is not None else None,
    }


def _planned_item_payload(item: PlannedWorkItem) -> dict[str, Any]:
    decision = item.decision
    return {
        "item_id": item.source.item_id,
        "goal": item.source.goal,
        "title": item.title or item.source.title,
        "params": dict(item.source.params),
        "dispatch_type": "sub_agent" if isinstance(decision, AgentInvocation) else "capability",
        "target": decision.profile_id if isinstance(decision, AgentInvocation) else decision.capability_id,
        "stage": item.stage,
    }


def _planner_payload(
    batch_goal: str,
    unresolved: Sequence[WorkItem],
    prebound: Sequence[PlannedWorkItem],
    catalogue: tuple[CapabilityDescriptor, ...],
    profiles: tuple[ProfileDescriptor, ...],
) -> dict[str, Any]:
    return {
        "batch_goal": batch_goal,
        "unresolved_items": [_work_item_payload(item) for item in unresolved],
        "prebound_items": [_planned_item_payload(item) for item in prebound],
        "capabilities": [_descriptor_payload(descriptor) for descriptor in catalogue],
        "profiles": [profile_descriptor_payload(profile) for profile in profiles],
    }


def _planner_scope_issue(
    batch_goal: str,
    unresolved: Sequence[WorkItem],
    prebound: Sequence[PlannedWorkItem],
    catalogue: tuple[CapabilityDescriptor, ...],
    profiles: tuple[ProfileDescriptor, ...],
) -> NeedsClarification | None:
    payload = _planner_payload(batch_goal, unresolved, prebound, catalogue, profiles)
    payload_chars = len(_planner_payload_text(payload))
    if len(unresolved) <= _MAX_TASK_PLANNER_ITEMS and payload_chars <= _MAX_TASK_PLANNER_PAYLOAD_CHARS:
        return None
    return NeedsClarification(
        "unresolved instruction scope is too large for one task-planner call",
        code="task_planner_scope_limit",
        details={
            "unresolved_item_count": len(unresolved),
            "max_unresolved_items": _MAX_TASK_PLANNER_ITEMS,
            "payload_chars": payload_chars,
            "max_payload_chars": _MAX_TASK_PLANNER_PAYLOAD_CHARS,
        },
        missing=("narrower unresolved instruction scope or explicit dispatch bindings",),
        suggestions=("Prebind capability_id/profile_id where known, or reduce the instruction scope.",),
    )


def _planner_payload_text(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _descriptor_payload(descriptor: CapabilityDescriptor) -> dict[str, Any]:
    return {
        "capability_id": descriptor.capability_id,
        "description": descriptor.description,
        "when_to_use": descriptor.when_to_use,
        "parameter_schema": dict(descriptor.parameter_schema),
        "required_sandbox": list(descriptor.required_sandbox),
    }


def _model_name() -> str | None:
    value = os.getenv(_PLANNER_MODEL_ENV)
    return value.strip() or None if value else None
