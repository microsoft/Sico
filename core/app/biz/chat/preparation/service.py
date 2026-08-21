"""Prepare one mixed, multi-source delegate request into one durable batch."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from app.biz.task_runtime import AgentProfileResolver, BatchResult, TaskManager
from app.biz.task_runtime.planning import (
    CapabilityDescriptor,
    CatalogueQuery,
    ProfileQuery,
    ResolveContext,
    normalize_capability_id,
)
from app.biz.source import (
    NormalizedRow,
    NormalizerSelector,
    SourceAccessContext,
    SourceError,
    TabularScope,
    WorkspaceSourceService,
    canonical_case_id,
    canonical_case_id_pairs,
    case_id_for_row,
    normalize_header,
)
from app.tools.common import ToolContext, is_internal_workspace_path

from .assembly import assemble_batch
from .catalogue import CapabilityCatalogue
from .models import (
    AgentInvocation,
    DirectCapability,
    NeedsClarification,
    PreparationError,
    PreparationOutcome,
    Rejected,
    WorkItem,
)
from .planner import TaskPlanner
from .request import (
    MAX_DELEGATE_WORK_ITEMS,
    DelegateRequest,
    InstructionsSourceSpec,
    TabularSourceSpec,
    parse_delegate_request,
)
from .tabular import (
    ArgumentBinder,
    BindingPlan,
    BindingRule,
)
from .tabular.planner import LlmTabularPlanner, TabularPlanningContext

_LOGGER = logging.getLogger(__name__)
_MAX_SELECTED_SKILL_DESCRIPTION_CHARS = 8_000
_MAX_TOTAL_SKILL_DESCRIPTION_CHARS = 24_000
_PATH_TOKEN_SEPARATOR = re.compile(r"[\s\"'`()\[\]{},;<>]+")


@dataclass(frozen=True, slots=True)
class _TableContext:
    planning: TabularPlanningContext
    explicit_rules: Mapping[str, BindingRule]
    stage: int
    source_index: int
    row_order: Mapping[tuple[int, int], int]
    row_document_indexes: Mapping[tuple[int, int], int]


class DelegatePreparationService:
    def __init__(  # noqa: PLR0913 - collaborators are explicit ports.
        self,
        planner: TaskPlanner,
        profile_resolver: AgentProfileResolver,
        capability_catalogue: CapabilityCatalogue,
        *,
        source_service: WorkspaceSourceService | None = None,
        normalizers: NormalizerSelector | None = None,
        binder: ArgumentBinder | None = None,
        tabular_planner: LlmTabularPlanner | None = None,
    ) -> None:
        self._planner = planner
        self._profile_resolver = profile_resolver
        self._catalogue = capability_catalogue
        self._sources = source_service or WorkspaceSourceService()
        self._normalizers = normalizers or NormalizerSelector()
        self._binder = binder or ArgumentBinder()
        self._tabular_planner = tabular_planner or LlmTabularPlanner()

    async def prepare(  # noqa: PLR0911 - fail-fast outcomes prevent partial batch submission.
        self,
        context: ToolContext,
        request_json: str,
    ) -> PreparationOutcome:
        request = parse_delegate_request(request_json)
        if isinstance(request, Rejected):
            return request
        caller = _resolve_context(context)
        explicit_capability_ids = _explicit_capability_ids(request)
        providers = _required_catalogue_providers(request)
        discovered = (
            await self._catalogue.list_descriptors(
                context,
                CatalogueQuery(
                    caller=caller,
                    providers=providers,
                    include_internal=bool(explicit_capability_ids),
                ),
            )
            if providers
            else ()
        )
        catalogue = tuple(
            descriptor
            for descriptor in discovered
            if descriptor.visibility == "public" or descriptor.capability_id in explicit_capability_ids
        )
        profiles = (
            self._profile_resolver.list_profiles(ProfileQuery(caller=caller))
            if _requires_profiles(request)
            else ()
        )
        items: list[WorkItem] = []
        tables: list[_TableContext] = []
        instruction_count = sum(
            len(source.items) for source in request.sources if isinstance(source, InstructionsSourceSpec)
        )
        selected_tabular_rows = 0
        has_tabular = False
        adapter_state: dict[str, object] = {}
        for source_index, source in enumerate(request.sources, start=1):
            if isinstance(source, InstructionsSourceSpec):
                outcome = await _instruction_items(
                    source,
                    source_index,
                    catalogue,
                    profiles,
                    context=context,
                    source_service=self._sources,
                )
            else:
                has_tabular = True
                work_items_before = instruction_count + selected_tabular_rows
                if work_items_before >= MAX_DELEGATE_WORK_ITEMS:
                    return _delegate_work_item_limit(work_items_before)
                outcome = await self._tabular_tables(
                    context,
                    source,
                    source_index,
                    catalogue,
                    batch_items_before=work_items_before,
                )
            if isinstance(outcome, (NeedsClarification, Rejected)):
                return outcome
            if isinstance(source, InstructionsSourceSpec):
                items.extend(outcome)
            else:
                tables.extend(outcome)
                selected_tabular_rows += sum(len(table.planning.rows) for table in outcome)
        if tables:
            plans = await self._binding_plans(request.batch_goal, tables)
            if isinstance(plans, (NeedsClarification, Rejected)):
                return plans
            bound = self._bind_tables(
                tables,
                plans,
                {descriptor.capability_id: descriptor for descriptor in catalogue},
            )
            if isinstance(bound, (NeedsClarification, Rejected)):
                return bound
            items.extend(bound)
            adapter_state = _tabular_adapter_state(context, plans)
        items.sort(key=_work_item_source_index)
        planned = await self._planner.plan(request.batch_goal, items, catalogue, profiles)
        if isinstance(planned, (NeedsClarification, Rejected)):
            return planned
        return assemble_batch(
            request.batch_goal,
            planned,
            join_strategy=request.join_strategy,
            max_concurrency=request.max_concurrency,
            batch_metadata={"source_count": len(request.sources)},
            adapter_state=adapter_state if has_tabular else {},
        )

    async def process_results(
        self,
        result: BatchResult,
        prepared,
        manager: TaskManager,
    ) -> dict:
        payload = await manager.build_tool_payload(result)
        if prepared.adapter_state:
            payload["additional_info"] = prepared.adapter_state
        return payload

    async def _tabular_tables(  # noqa: C901, PLR0911 - fail-fast source outcomes preserve precise errors.
        self,
        context: ToolContext,
        source: TabularSourceSpec,
        source_index: int,
        catalogue: tuple[CapabilityDescriptor, ...],
        *,
        batch_items_before: int,
    ) -> tuple[_TableContext, ...] | NeedsClarification | Rejected:
        descriptors = _source_descriptors(source.capability_ids, catalogue, provider="skill")
        if isinstance(descriptors, Rejected):
            return descriptors
        if not descriptors:
            return Rejected(
                "no executable skill capability is available for the tabular source",
                code="preparation_no_available_execution",
            )
        explicit = {
            parameter: BindingRule(
                source=binding.source,
                column=binding.column,
                value=binding.value,
                transform=binding.transform,
            )
            for parameter, binding in source.parameter_bindings.items()
        }
        tables_by_id: dict[str, _TableContext] = {}
        source_limit = min(source.max_rows, MAX_DELEGATE_WORK_ITEMS - batch_items_before)
        for document_index, document_spec in enumerate(source.documents, start=1):
            existing_rows = sum(len(table.planning.rows) for table in tables_by_id.values())
            remaining_rows = max(0, source_limit - existing_rows)
            duplicate_allowance = _matching_existing_rows(tables_by_id.values(), document_spec)
            document_limit = remaining_rows + duplicate_allowance
            if document_limit <= 0:
                return _row_limit_outcome(source_limit, source.max_rows, batch_items_before)
            wanted_pairs = canonical_case_id_pairs(document_spec.case_ids)
            wanted_order = tuple(key for key, _display in wanted_pairs)
            wanted_display = {key: display for key, display in wanted_pairs}
            wanted_cases = frozenset(wanted_order)
            row_filter = (
                (lambda row: canonical_case_id(case_id_for_row(row)) in wanted_cases)
                if wanted_cases
                else None
            )
            try:
                document = await asyncio.to_thread(
                    self._sources.select,
                    _source_access_context(context),
                    document_spec.source_ref,
                    scope=TabularScope(
                        sheet_names=tuple(document_spec.sheet_names),
                        row_start=document_spec.row_start,
                        row_end=document_spec.row_end,
                        case_ids=tuple(document_spec.case_ids),
                    ),
                    max_rows=document_limit,
                    row_filter=row_filter,
                )
            except SourceError as exc:
                if exc.code == "tabular_row_limit":
                    return _row_limit_outcome(source_limit, source.max_rows, batch_items_before)
                if exc.code in {"source_object_unavailable", "source_snapshot_unavailable"}:
                    raise PreparationError(str(exc), code=exc.code, details=exc.details) from exc
                return NeedsClarification(
                    str(exc),
                    code=exc.code,
                    details=exc.details,
                    missing=("valid tabular source scope",),
                )
            found_cases: set[str] = set()
            for sheet in document.sheets:
                normalizer = self._normalizers.select(sheet)
                rows = normalizer.normalize(document, sheet)
                if wanted_cases:
                    rows = tuple(
                        row for row in rows if row.case_id and canonical_case_id(row.case_id) in wanted_cases
                    )
                    case_order = {case_id: index for index, case_id in enumerate(wanted_order)}
                    rows = tuple(
                        sorted(rows, key=lambda row: (case_order[canonical_case_id(row.case_id)], row.source_row))
                    )
                    found_cases.update(canonical_case_id(row.case_id) for row in rows)
                if not rows:
                    continue
                row_order = {_tabular_row_key(row): index for index, row in enumerate(rows)}
                row_document_indexes = {_tabular_row_key(row): document_index for row in rows}
                table = _TableContext(
                    planning=TabularPlanningContext(
                        document,
                        sheet,
                        rows,
                        descriptors,
                        context_id=f"source-{source_index:02d}:{sheet.table_id}",
                    ),
                    explicit_rules=explicit,
                    stage=source.stage,
                    source_index=source_index,
                    row_order=row_order,
                    row_document_indexes=row_document_indexes,
                )
                if existing := tables_by_id.get(sheet.table_id):
                    table = _merge_table_contexts(existing, table)
                tables_by_id[sheet.table_id] = table
            if missing_case_keys := [case_id for case_id in wanted_order if case_id not in found_cases]:
                missing_cases = [wanted_display[case_id] for case_id in missing_case_keys]
                return NeedsClarification(
                    f"requested case IDs were not found in {document.source_ref}: {missing_cases}",
                    code="tabular_case_ids_not_found",
                    details={"source_ref": document.source_ref, "missing_case_ids": missing_cases},
                    missing=tuple(missing_cases),
                )
            selected_rows = sum(len(table.planning.rows) for table in tables_by_id.values())
            if selected_rows > source_limit:
                if source_limit < source.max_rows:
                    return _delegate_work_item_limit(batch_items_before + selected_rows)
                return _tabular_scope_issue(selected_rows, source.max_rows)
        tables = tuple(tables_by_id.values())
        total_rows = sum(len(table.planning.rows) for table in tables)
        if scope_issue := _tabular_scope_issue(total_rows, source.max_rows):
            return scope_issue
        return tables

    def _bind_tables(
        self,
        tables: Sequence[_TableContext],
        plans: Mapping[str, BindingPlan],
        descriptors: Mapping[str, CapabilityDescriptor],
    ) -> tuple[WorkItem, ...] | NeedsClarification | Rejected:
        items: list[WorkItem] = []
        for table in tables:
            plan = plans[table.planning.planning_id]
            descriptor = descriptors[plan.capability_id]
            rules = {**plan.rules, **table.explicit_rules}
            inferred = self._binder.infer_plan(descriptor, table.planning.sheet, rules)
            if isinstance(inferred, (NeedsClarification, Rejected)):
                return inferred
            bound = self._binder.bind(descriptor, table.planning.rows, inferred)
            if isinstance(bound, (NeedsClarification, Rejected)):
                return bound
            items.extend(_bound_work_items(bound, descriptor, table))
        return tuple(items)

    async def _binding_plans(
        self,
        batch_goal: str,
        tables: Sequence[_TableContext],
    ) -> dict[str, BindingPlan] | NeedsClarification | Rejected:
        plans: dict[str, BindingPlan] = {}
        unresolved: list[TabularPlanningContext] = []
        for table in tables:
            candidates: list[BindingPlan] = []
            bindable: list[CapabilityDescriptor] = []
            rejected: list[Rejected] = []
            for descriptor in table.planning.descriptors:
                outcome = self._binder.infer_plan(descriptor, table.planning.sheet, table.explicit_rules)
                if isinstance(outcome, BindingPlan):
                    candidates.append(outcome)
                    bindable.append(descriptor)
                elif isinstance(outcome, NeedsClarification):
                    bindable.append(descriptor)
                else:
                    rejected.append(outcome)
            if len(bindable) == 1 and len(candidates) == 1:
                plans[table.planning.planning_id] = candidates[0]
            else:
                planner_descriptors = tuple(bindable)
                if not planner_descriptors:
                    return rejected[0]
                unresolved.append(replace(table.planning, descriptors=planner_descriptors))
        if unresolved:
            model_plans = await self._tabular_planner.plan(batch_goal, unresolved)
            if isinstance(model_plans, NeedsClarification):
                return model_plans
            plans.update(model_plans)
        return plans


async def _instruction_items(  # noqa: PLR0911 - fail-fast outcomes preserve exact preparation errors.
    source: InstructionsSourceSpec,
    source_index: int,
    catalogue: tuple[CapabilityDescriptor, ...],
    profiles,
    *,
    context: ToolContext,
    source_service: WorkspaceSourceService,
) -> tuple[WorkItem, ...] | NeedsClarification | Rejected:
    descriptors = _source_descriptors(source.capability_ids, catalogue, provider="skill")
    if isinstance(descriptors, Rejected):
        return descriptors
    descriptor_index = {descriptor.capability_id: descriptor for descriptor in catalogue}
    source_capabilities = frozenset(descriptor.capability_id for descriptor in descriptors)
    profile_index = {profile.profile_id: profile for profile in profiles}
    if source.profile_ids:
        wanted_profiles = tuple(dict.fromkeys(profile_id.strip() for profile_id in source.profile_ids if profile_id.strip()))
        unknown_profiles = sorted(profile_id for profile_id in wanted_profiles if profile_id not in profile_index)
        if unknown_profiles:
            return Rejected(
                f"delegate source references unavailable profiles: {unknown_profiles}",
                code="preparation_unknown_profile",
                details={"unknown_profiles": unknown_profiles},
            )
        allowed_profiles = frozenset(wanted_profiles)
    else:
        allowed_profiles = frozenset(profile_index) if source.allow_sub_agent else frozenset()
    items: list[WorkItem] = []
    materialized_refs: dict[tuple[str, str], str] = {}
    for item_index, spec in enumerate(source.items, start=1):
        if internal_refs := _internal_source_refs((spec.goal, spec.title, spec.params)):
            return Rejected(
                "instruction items cannot reference internal source storage directly; use a logical source_ref",
                code="preparation_internal_source_ref",
                details={"internal_source_refs": sorted(internal_refs)},
            )
        decision = None
        if spec.capability_id.strip():
            decision = DirectCapability(spec.capability_id)
            item_capabilities = source_capabilities if source.capability_ids else frozenset((decision.capability_id,))
        elif spec.profile_id.strip():
            decision = AgentInvocation(spec.profile_id, tuple(spec.capability_grants), spec.max_model_turns)
            item_capabilities = (
                source_capabilities
                if source.capability_ids
                else frozenset(decision.capability_grants)
            )
        else:
            item_capabilities = source_capabilities
        unknown_item_capabilities = sorted(item_capabilities - set(descriptor_index))
        if unknown_item_capabilities:
            return Rejected(
                f"instruction item references unavailable capabilities: {unknown_item_capabilities}",
                code="preparation_unknown_capability",
                details={"unknown_capabilities": unknown_item_capabilities},
            )
        params = spec.params
        metadata: dict[str, object] = {"source": {"type": "instructions", "index": source_index}}
        if materialization := spec.source_materialization:
            source_ref = materialization.source_ref.replace("\\", "/").strip().lstrip("/")
            cache_key = source_ref, materialization.content_hash
            object_ref = materialized_refs.get(cache_key)
            if object_ref is None:
                try:
                    object_ref = await asyncio.to_thread(
                        source_service.materialize_object_ref,
                        _source_access_context(context),
                        source_ref,
                        materialization.content_hash,
                    )
                except SourceError as exc:
                    if exc.code == "source_object_unavailable":
                        raise PreparationError(str(exc), code=exc.code, details=exc.details) from exc
                    return NeedsClarification(
                        str(exc),
                        code=exc.code,
                        details=exc.details,
                        missing=("active source matching the original task",),
                    )
                materialized_refs[cache_key] = object_ref
            params, replacement_count = _replace_exact_value(params, materialization.source_ref, object_ref)
            if replacement_count == 0:
                return Rejected(
                    "source_materialization did not match any instruction parameter",
                    code="preparation_unused_source_materialization",
                    details={"source_ref": source_ref},
                )
            metadata["tabular"] = {
                "source_ref": source_ref,
                "source_object_ref": object_ref,
            }
        items.append(
            WorkItem(
                item_id=f"instruction-{source_index:02d}-{item_index:03d}",
                goal=spec.goal.strip(),
                params=params,
                title=spec.title,
                prebound_decision=decision,
                stage_hint=spec.stage,
                allowed_capability_ids=item_capabilities,
                allowed_profile_ids=allowed_profiles,
                metadata=metadata,
            )
        )
    return tuple(items)


def _replace_exact_value(value: Any, expected: str, replacement: str) -> tuple[Any, int]:
    if isinstance(value, str):
        return (replacement, 1) if value == expected else (value, 0)
    if isinstance(value, Mapping):
        replaced: dict[object, object] = {}
        count = 0
        for key, item in value.items():
            replaced_item, item_count = _replace_exact_value(item, expected, replacement)
            replaced[key] = replaced_item
            count += item_count
        return replaced, count
    if isinstance(value, list):
        replaced_items: list[object] = []
        count = 0
        for item in value:
            replaced_item, item_count = _replace_exact_value(item, expected, replacement)
            replaced_items.append(replaced_item)
            count += item_count
        return replaced_items, count
    return value, 0


def _internal_source_refs(value) -> set[str]:
    if isinstance(value, str):
        normalized = value.replace("\\", "/")
        references: set[str] = set()
        for token in _PATH_TOKEN_SEPARATOR.split(normalized):
            if not token:
                continue
            candidates = (token,) if "://" in token else (token, token.rpartition("=")[2])
            references.update(candidate for candidate in candidates if is_internal_workspace_path(candidate))
        return references
    if isinstance(value, Mapping):
        return set().union(*(_internal_source_refs(item) for item in value.values()), set())
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return set().union(*(_internal_source_refs(item) for item in value), set())
    return set()


def _source_descriptors(
    capability_ids: Sequence[str],
    catalogue: tuple[CapabilityDescriptor, ...],
    *,
    provider: str,
) -> tuple[CapabilityDescriptor, ...] | Rejected:
    index = {descriptor.capability_id: descriptor for descriptor in catalogue}
    if capability_ids:
        wanted = tuple(dict.fromkeys(normalize_capability_id(item) for item in capability_ids if item.strip()))
        unknown = sorted(capability_id for capability_id in wanted if capability_id not in index)
        if unknown:
            return Rejected(
                f"delegate source references unavailable capabilities: {unknown}",
                code="preparation_unknown_capability",
                details={"unknown_capabilities": unknown},
            )
        return tuple(index[capability_id] for capability_id in wanted)
    return tuple(
        descriptor
        for descriptor in catalogue
        if descriptor.provider_id == provider and descriptor.visibility == "public"
    )


def _explicit_capability_ids(request: DelegateRequest) -> frozenset[str]:
    explicit: set[str] = set()
    for source in request.sources:
        if source.capability_ids:
            explicit.update(
                normalize_capability_id(capability_id)
                for capability_id in source.capability_ids
                if capability_id.strip()
            )
        elif isinstance(source, InstructionsSourceSpec):
            for item in source.items:
                if item.capability_id.strip():
                    explicit.add(normalize_capability_id(item.capability_id))
                explicit.update(
                    normalize_capability_id(capability_id)
                    for capability_id in item.capability_grants
                    if capability_id.strip()
                )
    return frozenset(explicit)


def _required_catalogue_providers(request: DelegateRequest) -> tuple[str, ...]:
    providers: set[str] = set()
    for source in request.sources:
        if source.capability_ids:
            providers.update(
                normalize_capability_id(capability_id).partition(":")[0]
                for capability_id in source.capability_ids
                if capability_id.strip()
            )
        elif isinstance(source, TabularSourceSpec):
            providers.add("skill")
        else:
            unresolved = False
            for item in source.items:
                item_capabilities = [item.capability_id, *item.capability_grants]
                providers.update(
                    normalize_capability_id(capability_id).partition(":")[0]
                    for capability_id in item_capabilities
                    if capability_id.strip()
                )
                unresolved = unresolved or (not item.capability_id.strip() and not item.profile_id.strip())
            if unresolved:
                providers.add("skill")
    return tuple(sorted(providers))


def _requires_profiles(request: DelegateRequest) -> bool:
    return any(
        isinstance(source, InstructionsSourceSpec)
        and source.allow_sub_agent
        and (source.profile_ids or any(not item.capability_id.strip() for item in source.items))
        for source in request.sources
    )


def _bound_work_items(bound_rows, descriptor: CapabilityDescriptor, table: _TableContext) -> list[WorkItem]:
    items: list[WorkItem] = []
    bound_rows = tuple(sorted(bound_rows, key=lambda bound: table.row_order[_tabular_row_key(bound.row)]))
    for item_index, bound in enumerate(bound_rows, start=1):
        row = bound.row
        row_key = _tabular_row_key(row)
        identity = normalize_header(row.case_id)[:32] or "row"
        selection_index = table.row_order[row_key]
        items.append(
            WorkItem(
                item_id=(
                    f"tabular-{table.source_index:02d}-{row.source_id}-{row.table_id.rsplit(':', 1)[-1]}-"
                    f"{identity}-{item_index:05d}"
                ),
                goal=row.goal,
                params=bound.arguments,
                title=row.title,
                prebound_decision=DirectCapability(descriptor.capability_id),
                stage_hint=table.stage,
                allowed_capability_ids=frozenset((descriptor.capability_id,)),
                allowed_profile_ids=frozenset(),
                metadata={
                    "source": {
                        "type": "tabular",
                        "index": table.source_index,
                        "document_index": table.row_document_indexes[row_key],
                        "selection_index": selection_index,
                    },
                    "tabular": {
                        "source_ref": row.source_ref,
                        "source_object_ref": row.materialized_ref,
                        "sheet_name": row.sheet_name,
                        "source_row": row.source_row,
                        "data_row_index": row.data_row_index,
                        "bindings": dict(bound.evidence),
                    }
                },
            )
        )
    return items


def _tabular_row_key(row: NormalizedRow) -> tuple[int, int]:
    return row.source_row, row.data_row_index


def _merge_table_contexts(existing: _TableContext, current: _TableContext) -> _TableContext:
    merged = {
        _tabular_row_key(row): row
        for row in (*existing.planning.rows, *current.planning.rows)
    }
    row_order = dict(existing.row_order)
    row_document_indexes = dict(existing.row_document_indexes)
    for row in current.planning.rows:
        row_key = _tabular_row_key(row)
        if row_key not in row_order:
            row_order[row_key] = len(row_order)
            row_document_indexes[row_key] = current.row_document_indexes[row_key]
    return replace(
        existing,
        planning=replace(existing.planning, rows=tuple(merged.values())),
        row_order=row_order,
        row_document_indexes=row_document_indexes,
    )


def _matching_existing_rows(tables: Sequence[_TableContext], document_spec) -> int:
    requested_ref = document_spec.source_ref.replace("\\", "/").strip().lstrip("/")
    requested_name = Path(requested_ref).name if "/" not in requested_ref else ""
    wanted_sheets = {name.strip().casefold() for name in document_spec.sheet_names if name.strip()}
    wanted_cases = {canonical_case_id(case_id) for case_id in document_spec.case_ids if case_id.strip()}
    matched = 0
    for table in tables:
        existing_ref = table.planning.document.source_ref
        attachment_alias = (
            bool(requested_name)
            and existing_ref.startswith("attachments/")
            and Path(existing_ref).name == requested_name
        )
        if existing_ref != requested_ref and not attachment_alias:
            continue
        if wanted_sheets and table.planning.sheet.name.strip().casefold() not in wanted_sheets:
            continue
        for row in table.planning.rows:
            if document_spec.row_start is not None and row.data_row_index < document_spec.row_start:
                continue
            if document_spec.row_end is not None and row.data_row_index > document_spec.row_end:
                continue
            if wanted_cases and canonical_case_id(row.case_id) not in wanted_cases:
                continue
            matched += 1
    return matched


def _tabular_adapter_state(context: ToolContext, plans: Mapping[str, BindingPlan]) -> dict[str, object]:
    state: dict[str, object] = {"response_hint": _TABULAR_RESPONSE_HINT}
    descriptions = _selected_skill_descriptions(context, plans)
    if len(descriptions) == 1:
        state["skill_description"] = descriptions[0]["content"]
    elif descriptions:
        state["skill_descriptions"] = descriptions
    return state


def _selected_skill_descriptions(
    context: ToolContext,
    plans: Mapping[str, BindingPlan],
) -> list[dict[str, str]]:
    loader = context.skill_loader
    if loader is None:
        return []
    descriptions: list[dict[str, str]] = []
    remaining = _MAX_TOTAL_SKILL_DESCRIPTION_CHARS
    capability_ids = sorted({plan.capability_id for plan in plans.values() if plan.capability_id.startswith("skill:")})
    for capability_id in capability_ids:
        try:
            card = loader.resolve(capability_id.partition(":")[2])
        except Exception:  # noqa: BLE001 - reporting context must not fail preparation.
            _LOGGER.warning("selected skill description resolution failed capability_id=%s", capability_id, exc_info=True)
            continue
        skill_dir = str(getattr(card, "skill_dir", "") or "") if card is not None else ""
        if not skill_dir:
            continue
        try:
            content = (Path(skill_dir) / "SKILL.md").read_text(encoding="utf-8").strip()
        except OSError:
            _LOGGER.warning("selected skill description read failed capability_id=%s", capability_id, exc_info=True)
            continue
        if not content or remaining <= 0:
            continue
        content = _truncate_description(content, min(remaining, _MAX_SELECTED_SKILL_DESCRIPTION_CHARS))
        remaining -= len(content)
        descriptions.append({"capability_id": capability_id, "content": content})
    return descriptions


def _truncate_description(content: str, max_chars: int) -> str:
    if len(content) <= max_chars:
        return content
    marker = "\n...TRUNCATED"
    if max_chars <= len(marker):
        return content[:max_chars]
    return content[: max_chars - len(marker)].rstrip() + marker


def _work_item_source_index(item: WorkItem) -> tuple[int, int, int]:
    source = item.metadata.get("source")
    if not isinstance(source, Mapping):
        return 0, 0, 0
    return (
        int(source.get("index") or 0),
        int(source.get("document_index") or 0),
        int(source.get("selection_index") or 0),
    )


def _resolve_context(context: ToolContext) -> ResolveContext:
    return ResolveContext(
        username=context.username,
        agent_instance_id=int(context.agent_instance_id or 0),
        project_id=context.project_id,
    )


def _source_access_context(context: ToolContext) -> SourceAccessContext:
    return SourceAccessContext(
        username=context.username,
        agent_instance_id=int(context.agent_instance_id or 0),
        conversation_id=int(context.conversation_id or 0),
    )


def _tabular_scope_issue(total_rows: int, max_rows: int) -> NeedsClarification | None:
    if total_rows > max_rows:
        return NeedsClarification(
            f"selected {total_rows} tabular rows exceeds max_rows={max_rows}",
            code="tabular_row_limit",
            missing=("narrower source scope",),
        )
    if total_rows == 0:
        return NeedsClarification("no tabular rows matched the selected scope", code="tabular_no_rows")
    return None


def _row_limit_outcome(source_limit: int, source_max_rows: int, batch_items_before: int) -> NeedsClarification:
    selected_rows = source_limit + 1
    if source_limit < source_max_rows:
        return _delegate_work_item_limit(batch_items_before + selected_rows)
    outcome = _tabular_scope_issue(selected_rows, source_max_rows)
    if outcome is None:
        raise AssertionError("row-limit outcome requires an over-limit selection")
    return outcome


def _delegate_work_item_limit(selected: int) -> NeedsClarification:
    return NeedsClarification(
        f"delegate request selects {selected} work items; limit is {MAX_DELEGATE_WORK_ITEMS}",
        code="delegate_work_item_limit",
        details={"selected_work_items": selected, "max_work_items": MAX_DELEGATE_WORK_ITEMS},
        missing=("narrower source scope",),
        suggestions=("Reduce instruction items, documents, sheets, row ranges, or case IDs.",),
    )


_TABULAR_RESPONSE_HINT = (
    "Summarize the tabular batch result and expose report artifacts as downloadable deliverables. "
    "Do not re-read every result file unless the user asks for raw data."
)
