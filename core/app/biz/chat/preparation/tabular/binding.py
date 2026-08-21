"""Bind one validated table-level mapping plan across every selected row."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from json_schema_to_pydantic import SchemaError, create_model
from pydantic import BaseModel, ConfigDict, ValidationError

from app.biz.task_runtime.planning import CapabilityDescriptor
from app.biz.source import NormalizedRow, TabularSheet, normalize_header

from ..models import NeedsClarification, Rejected

BindingSource = Literal[
    "column",
    "document_path",
    "sheet_name",
    "row_index",
    "source_row",
    "case_id",
    "goal",
    "title",
    "literal",
]


class _Arguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class BindingRule:
    source: BindingSource
    column: str = ""
    value: Any = None
    transform: str = "identity"


@dataclass(frozen=True, slots=True)
class BindingPlan:
    capability_id: str
    rules: Mapping[str, BindingRule]


@dataclass(frozen=True, slots=True)
class BoundRow:
    row: NormalizedRow
    arguments: Mapping[str, Any]
    evidence: Mapping[str, str]


class ArgumentBinder:
    def infer_plan(
        self,
        descriptor: CapabilityDescriptor,
        sheet: TabularSheet,
        explicit: Mapping[str, BindingRule] | None = None,
    ) -> BindingPlan | NeedsClarification | Rejected:
        properties = _properties(descriptor)
        explicit = explicit or {}
        unknown = sorted(set(explicit) - set(properties))
        if unknown:
            return Rejected(
                f"parameter bindings target unknown capability parameters: {unknown}",
                code="tabular_invalid_bindings",
                details={"capability_id": descriptor.capability_id, "unknown_parameters": unknown},
            )
        invalid_columns = sorted(
            {rule.column for rule in explicit.values() if rule.source == "column" and rule.column not in sheet.headers}
        )
        if invalid_columns:
            return Rejected(
                f"parameter bindings reference unknown columns: {invalid_columns}",
                code="tabular_invalid_bindings",
                details={
                    "capability_id": descriptor.capability_id,
                    "unknown_columns": invalid_columns,
                    "headers": list(sheet.headers),
                },
            )
        rules: dict[str, BindingRule] = dict(explicit)
        ambiguous: dict[str, list[str]] = {}
        for parameter, schema in properties.items():
            if parameter in rules:
                continue
            candidates = _column_candidates(parameter, schema, sheet)
            if len(candidates) == 1:
                rules[parameter] = BindingRule(source="column", column=candidates[0])
            elif len(candidates) > 1:
                ambiguous[parameter] = candidates
            elif builtin := _builtin_rule(parameter):
                rules[parameter] = builtin
        required = {str(name) for name in descriptor.parameter_schema.get("required", ())}
        missing = sorted(required - set(rules))
        if missing or ambiguous:
            return NeedsClarification(
                "tabular columns could not be mapped unambiguously to the selected capability",
                code="tabular_binding_required",
                details={
                    "capability_id": descriptor.capability_id,
                    "headers": list(sheet.headers),
                    "missing_parameters": missing,
                    "ambiguous_parameters": ambiguous,
                },
                missing=tuple(missing or ambiguous),
                suggestions=tuple(f"Map {parameter!r} to one of {columns}" for parameter, columns in ambiguous.items()),
            )
        return BindingPlan(capability_id=descriptor.capability_id, rules=rules)

    def bind(
        self,
        descriptor: CapabilityDescriptor,
        rows: Sequence[NormalizedRow],
        plan: BindingPlan,
    ) -> tuple[BoundRow, ...] | NeedsClarification | Rejected:
        if plan.capability_id != descriptor.capability_id:
            return Rejected("binding plan capability does not match the selected descriptor", code="tabular_invalid_bindings")
        try:
            model = create_model(
                dict(descriptor.parameter_schema),
                base_model_type=_Arguments,
                allow_undefined_type=True,
            )
        except (SchemaError, TypeError, ValueError) as exc:
            return Rejected(
                f"capability parameter schema cannot be used for tabular binding: {exc}",
                code="preparation_invalid_capability_schema",
            )
        bound: list[BoundRow] = []
        failures: list[dict[str, Any]] = []
        for row in rows:
            try:
                arguments: dict[str, Any] = {}
                evidence: dict[str, str] = {}
                for parameter, rule in plan.rules.items():
                    value, label = _value(rule, row)
                    if value is not None and value != "":
                        arguments[parameter] = _transform(value, rule.transform)
                        evidence[parameter] = label
                validated = model.model_validate(arguments).model_dump(exclude_none=True)
            except (ValidationError, ValueError, TypeError) as exc:
                failures.append(
                    {
                        "table_id": row.table_id,
                        "source_row": row.source_row,
                        "error": str(exc),
                    }
                )
                continue
            bound.append(BoundRow(row=row, arguments=validated, evidence=evidence))
        if failures:
            return NeedsClarification(
                "one or more tabular rows do not satisfy the selected capability schema",
                code="tabular_row_validation_failed",
                details={"capability_id": descriptor.capability_id, "rows": failures[:20]},
                missing=("valid row values",),
            )
        return tuple(bound)


def _properties(descriptor: CapabilityDescriptor) -> dict[str, Mapping[str, Any]]:
    raw = descriptor.parameter_schema.get("properties")
    if not isinstance(raw, Mapping):
        return {}
    return {str(name): schema for name, schema in raw.items() if isinstance(schema, Mapping)}


def _column_candidates(parameter: str, schema: Mapping[str, Any], sheet: TabularSheet) -> list[str]:
    names = {normalize_header(parameter)}
    binding = schema.get("x-sico-binding")
    if isinstance(binding, Mapping):
        aliases = binding.get("aliases")
        if isinstance(aliases, list):
            names.update(normalize_header(str(alias)) for alias in aliases)
    candidates: list[str] = []
    for name in names:
        candidates.extend(sheet.normalized_headers.get(name, ()))
    return list(dict.fromkeys(candidates))


def _builtin_rule(parameter: str) -> BindingRule | None:
    name = normalize_header(parameter)
    sources: dict[str, BindingSource] = {
        "file_path": "document_path",
        "input_file": "document_path",
        "input_path": "document_path",
        "source_path": "document_path",
        "sheet_name": "sheet_name",
        "row_index": "row_index",
        "data_row_index": "row_index",
        "source_row": "source_row",
        "case_id": "case_id",
        "instructions": "goal",
        "task_name": "title",
        "title": "title",
    }
    source = sources.get(name)
    return BindingRule(source=source) if source else None


def _value(rule: BindingRule, row: NormalizedRow) -> tuple[Any, str]:
    if rule.source == "column":
        return row.values.get(rule.column), f"column:{rule.column}"
    if rule.source == "literal":
        return rule.value, "literal"
    values: dict[str, tuple[Any, str]] = {
        "document_path": (row.materialized_ref or row.source_ref, "document_path"),
        "sheet_name": (row.sheet_name, "sheet_name"),
        "row_index": (row.data_row_index, "row_index"),
        "source_row": (row.source_row, "source_row"),
        "case_id": (row.case_id, "case_id"),
        "goal": (row.goal, "normalized_goal"),
        "title": (row.title, "normalized_title"),
    }
    try:
        return values[rule.source]
    except KeyError as exc:
        raise ValueError(f"unsupported binding source: {rule.source}") from exc


def _transform(value: Any, transform: str) -> Any:
    if transform == "identity":
        return value
    if transform == "string_to_integer":
        return int(value)
    if transform == "string_to_number":
        return float(value)
    if transform == "json":
        return json.loads(value) if isinstance(value, str) else value
    raise ValueError(f"unsupported binding transform: {transform}")
