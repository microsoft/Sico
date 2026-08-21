"""One structured model call for ambiguous table-to-capability binding plans."""

from __future__ import annotations

import json
import os
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, ValidationError

import app.llmhubs
from app.biz.task_runtime.planning import CapabilityDescriptor
from app.biz.source import NormalizedRow, TabularDocument, TabularSheet
from app.llmhubs.request_builder import build_llm_request

from ..models import NeedsClarification, PreparationError
from .binding import BindingPlan, BindingRule


@dataclass(frozen=True, slots=True)
class TabularPlanningContext:
    document: TabularDocument
    sheet: TabularSheet
    rows: tuple[NormalizedRow, ...]
    descriptors: tuple[CapabilityDescriptor, ...]
    context_id: str = ""

    @property
    def planning_id(self) -> str:
        return self.context_id or self.sheet.table_id


class BindingDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parameter: str
    source: Literal["column", "document_path", "sheet_name", "row_index", "source_row", "case_id", "goal", "title"]
    column: str = ""
    transform: Literal["identity", "string_to_integer", "string_to_number", "json"] = "identity"


class TablePlanDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    table_id: str
    outcome: Literal["binding", "needs_clarification"] = "binding"
    capability_id: str = ""
    bindings: list[BindingDecision] = Field(default_factory=list)
    clarification: str = ""


class TabularPlannerOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tables: list[TablePlanDecision]


TabularPlannerCall: TypeAlias = Callable[
    [str, Sequence[TabularPlanningContext]],
    Awaitable[TabularPlannerOutput],
]

_MAX_TABULAR_PLANNER_TABLES = 50
_MAX_TABULAR_PLANNER_PAYLOAD_CHARS = 500_000
_MAX_SAMPLE_CELL_CHARS = 500


class LlmTabularPlanner:
    def __init__(self, planner_call: TabularPlannerCall | None = None) -> None:
        self._planner_call = planner_call or _run_planner

    async def plan(
        self,
        batch_goal: str,
        contexts: Sequence[TabularPlanningContext],
    ) -> dict[str, BindingPlan] | NeedsClarification:
        if len(contexts) > _MAX_TABULAR_PLANNER_TABLES:
            return _planner_scope_limit(len(contexts))
        payload = _planner_payload(batch_goal, contexts)
        payload_chars = len(json.dumps(payload, ensure_ascii=False, default=str))
        if payload_chars > _MAX_TABULAR_PLANNER_PAYLOAD_CHARS:
            return _planner_scope_limit(len(contexts), payload_chars=payload_chars)
        try:
            output = await self._planner_call(batch_goal, contexts)
        except PreparationError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise PreparationError(
                f"tabular planner failed: {exc}",
                code="tabular_planner_failed",
            ) from exc
        expected = {context.planning_id for context in contexts}
        by_table = {decision.table_id: decision for decision in output.tables}
        if len(output.tables) != len(contexts) or set(by_table) != expected:
            raise PreparationError(
                "tabular planner must return exactly one plan for each table",
                code="tabular_planner_invalid_output",
                details={"expected": sorted(expected), "received": [item.table_id for item in output.tables]},
            )
        clarifications = [decision for decision in output.tables if decision.outcome == "needs_clarification"]
        if clarifications:
            return NeedsClarification(
                clarifications[0].clarification or "tabular execution capability is ambiguous",
                code="tabular_capability_clarification",
                details={
                    "tables": [
                        {
                            "table_id": decision.table_id,
                            "message": decision.clarification,
                            "candidate_capability_ids": [
                                descriptor.capability_id
                                for descriptor in next(
                                    context for context in contexts if context.planning_id == decision.table_id
                                ).descriptors
                            ],
                        }
                        for decision in clarifications
                    ]
                },
                missing=("target execution capability",),
                suggestions=("Clarify the target platform or provide capability_ids explicitly.",),
            )
        plans: dict[str, BindingPlan] = {}
        for context in contexts:
            decision = by_table[context.planning_id]
            descriptors = {descriptor.capability_id: descriptor for descriptor in context.descriptors}
            descriptor = descriptors.get(decision.capability_id) if decision.outcome == "binding" else None
            if descriptor is None:
                raise PreparationError(
                    f"tabular planner selected unavailable capability {decision.capability_id!r}",
                    code="tabular_planner_invalid_output",
                )
            rules = _validated_binding_rules(decision, context.sheet, descriptor)
            plans[decision.table_id] = BindingPlan(capability_id=decision.capability_id, rules=rules)
        return plans


def _planner_scope_limit(table_count: int, *, payload_chars: int | None = None) -> NeedsClarification:
    details: dict[str, Any] = {
        "table_count": table_count,
        "max_tables": _MAX_TABULAR_PLANNER_TABLES,
        "max_payload_chars": _MAX_TABULAR_PLANNER_PAYLOAD_CHARS,
    }
    if payload_chars is not None:
        details["payload_chars"] = payload_chars
    return NeedsClarification(
        "ambiguous tabular scope is too large for one binding-planner call",
        code="tabular_planner_scope_limit",
        details=details,
        missing=("explicit capability_ids or parameter_bindings",),
        suggestions=("Split capability scopes or provide explicit table bindings.",),
    )


def _validated_binding_rules(
    decision: TablePlanDecision,
    sheet: TabularSheet,
    descriptor: CapabilityDescriptor,
) -> dict[str, BindingRule]:
    parameters = [binding.parameter for binding in decision.bindings]
    if len(parameters) != len(set(parameters)):
        raise PreparationError(
            "tabular planner returned duplicate parameter bindings",
            code="tabular_planner_invalid_output",
            details={"table_id": decision.table_id},
        )
    raw_properties = descriptor.parameter_schema.get("properties")
    properties = raw_properties if isinstance(raw_properties, Mapping) else {}
    if unknown := sorted(set(parameters) - set(properties)):
        raise PreparationError(
            f"tabular planner bound unknown capability parameters: {unknown}",
            code="tabular_planner_invalid_output",
            details={"table_id": decision.table_id, "unknown_parameters": unknown},
        )
    invalid_columns = sorted(
        {binding.column for binding in decision.bindings if binding.source == "column" and binding.column not in sheet.headers}
    )
    if invalid_columns:
        raise PreparationError(
            f"tabular planner referenced unknown columns: {invalid_columns}",
            code="tabular_planner_invalid_output",
            details={"table_id": decision.table_id, "unknown_columns": invalid_columns},
        )
    return {binding.parameter: _binding_rule(binding) for binding in decision.bindings}


def _binding_rule(decision: BindingDecision) -> BindingRule:
    return BindingRule(
        source=decision.source,
        column=decision.column,
        transform=decision.transform,
    )


_SYSTEM_PROMPT = """\
You map parsed tables onto executable capabilities. For every supplied table,
choose exactly one capability from that table's candidate list only when the
table and batch goal contain sufficient evidence. If multiple candidates remain
plausible, return outcome=needs_clarification with one focused question instead
of guessing. For a binding outcome, bind parameters to real columns or the
listed built-in row/document sources. Do not invent columns, capability ids,
normalizers, transforms, or per-row values. Leave bindings empty when exact
schema/header matching and built-in sources are sufficient. Reply only with JSON
matching the requested schema.
"""


async def _run_planner(
    batch_goal: str,
    contexts: Sequence[TabularPlanningContext],
) -> TabularPlannerOutput:
    payload = _planner_payload(batch_goal, contexts)
    request = build_llm_request(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)}]},
        ],
        model=_model_name(),
        response_format=TabularPlannerOutput,
    )
    try:
        response = await app.llmhubs.generate(request=request)
    except Exception as exc:  # noqa: BLE001
        raise PreparationError(f"tabular planner LLM call failed: {exc}", code="tabular_planner_failed") from exc
    if response.code != 0:
        raise PreparationError(response.msg or "tabular planner LLM call failed", code="tabular_planner_failed")
    structured = next((output.json for output in response.outputs if output.json is not None), None)
    if structured is None:
        text = response.outputs[0].text if response.outputs else response.text
        try:
            structured = json.loads(text or "")
        except json.JSONDecodeError as exc:
            raise PreparationError("tabular planner returned invalid JSON", code="tabular_planner_invalid_output") from exc
    try:
        return TabularPlannerOutput.model_validate(structured)
    except ValidationError as exc:
        raise PreparationError(
            "tabular planner response failed schema validation",
            code="tabular_planner_invalid_output",
            details={"errors": exc.errors(include_url=False)},
        ) from exc


def _table_payload(context: TabularPlanningContext) -> dict[str, Any]:
    return {
        "table_id": context.planning_id,
        "source_ref": context.document.source_ref,
        "sheet_name": context.sheet.name,
        "headers": list(context.sheet.headers),
        "row_kind": "testcase" if context.rows and context.rows[0].normalizer_id == "testcase_v1" else "generic",
        "sample_rows": [
            {header: value[:_MAX_SAMPLE_CELL_CHARS] for header, value in row.display_values.items()}
            for row in context.rows[:3]
        ],
        "candidate_capability_ids": [descriptor.capability_id for descriptor in context.descriptors],
        "built_in_sources": ["document_path", "sheet_name", "row_index", "source_row", "case_id", "goal", "title"],
    }


def _planner_payload(batch_goal: str, contexts: Sequence[TabularPlanningContext]) -> dict[str, Any]:
    descriptors = {
        descriptor.capability_id: descriptor
        for context in contexts
        for descriptor in context.descriptors
    }
    return {
        "batch_goal": batch_goal,
        "capabilities": [_descriptor_payload(descriptor) for descriptor in descriptors.values()],
        "tables": [_table_payload(context) for context in contexts],
    }


def _descriptor_payload(descriptor: CapabilityDescriptor) -> dict[str, Any]:
    return {
        "capability_id": descriptor.capability_id,
        "description": descriptor.description,
        "when_to_use": descriptor.when_to_use,
        "parameter_schema": dict(descriptor.parameter_schema),
    }


def _model_name() -> str | None:
    value = os.getenv("CHAT_TABULAR_PLANNER_MODEL") or os.getenv("CHAT_TASK_PLANNER_MODEL")
    return value.strip() or None if value else None
