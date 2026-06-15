# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

"""Workbook adapter for the TASK route's task-builder LLM.

Expands a workbook attachment (or a previously-parsed structured case source)
into one :class:`TaskSpec` per case row. The bulk of the case-extraction work
lives in :func:`extract_workbook_cases_for_request`; this adapter wires that
function into the :class:`Adapter` contract and packages the resulting cases
as a :class:`PreparedTaskBatch` ready for ``TaskManager.submit_prepared``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

from pydantic import ConfigDict, Field, ValidationError, field_validator

from app.tools.common import ToolContext

from app.biz.task_runtime.models import (
    BatchResult,
    PreparedTaskBatch,
    SkillDispatch,
    TaskBatchInput,
    TaskSpec,
)
from app.biz.task_runtime.sandbox_types import normalize_sandbox_hint
from app.biz.task_runtime.skill_loader import CapabilityCard
from ...types import Adapter, AdapterInput
from .extract_workbook_cases import (
    ExtractWorkbookCasesInput,
    extract_workbook_cases_for_request,
)

if TYPE_CHECKING:
    from app.biz.task_runtime.manager import TaskManager

_LOGGER = logging.getLogger(__name__)


class WorkbookAdapterError(Exception):
    """Raised when the workbook adapter cannot build a usable task batch.

    ``code`` is a stable identifier the TASK route surfaces back to the LLM,
    and ``details`` carries structured debug fields (resolved paths, available
    sheets, candidate capabilities, etc."""

    def __init__(self, message: str, *, code: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


class WorkbookAdapterOptions(ExtractWorkbookCasesInput):
    """``adapter_input.options_json`` payload for :class:`WorkbookAdapter`.

    Extends :class:`ExtractWorkbookCasesInput` with the capability-selection
    fields the adapter needs to stamp each generated :class:`TaskSpec` with a
    concrete ``SkillDispatch`` / ``required_sandbox``."""

    model_config = ConfigDict(extra="forbid")

    skill_name: str = Field(
        default="",
        description="Executable capability skill name to run each workbook case under.",
    )
    action_name: str = Field(
        default="",
        description="Optional action name to disambiguate when a skill exposes multiple actions.",
    )
    required_sandbox: str = Field(
        default="",
        description=(
            "Optional OS capability override (android). "
            "Defaults to the capability's own requirement."
        ),
    )

    @field_validator("required_sandbox", mode="before")
    @classmethod
    def _coerce_required_sandbox(cls, value: Any) -> str:
        # LLM/user-supplied; normalize an OS name or infra token to the canonical
        # OS selector so it compares cleanly against a capability's
        # ``requires_sandbox`` (also an OS). Unknown -> "".
        return normalize_sandbox_hint(value if isinstance(value, str) else "")


class WorkbookAdapter(Adapter):
    """Build one ``TaskSpec`` per workbook case for the TASK route."""

    name = "workbook"
    description = (
        "Expand a workbook (xlsx / csv / parsed case-source JSONL) into one delegated TaskSpec per case row, "
        "AND submit the resulting batch to the task runtime for execution against an executable capability. "
        "Calling this adapter both *builds* and *executes* the cases in one shot \u2014 the returned payload "
        "describes the runtime batch (batch_id, runs, statuses), not just the planned tasks. "
        "Use it for batch execution of workbook-driven tests.\n"
        "\n"
        "`options_json` must decode to a JSON object with the following fields (all optional unless noted):\n"
        "  - source_path (str): structured JSONL case-source path from a prior parsed workbook source.\n"
        "  - file_path (str): workbook path or file name (e.g. `attachments/cases.xlsx`) for current uploads "
        "or a prior file name. Provide either `source_path` or `file_path`.\n"
        "  - sheet_name (str): workbook sheet/tab name to extract (e.g. `rewritten_userdata`).\n"
        "  - row_start (int|null): 1-based data-row start within the selected sheet.\n"
        "  - row_end (int|null): 1-based data-row end within the selected sheet.\n"
        "  - case_ids (list[str]): exact case IDs to extract.\n"
        "  - max_cases (int): maximum cases to expand into tasks; narrow the scope if exceeded.\n"
        "  - skill_name (str): executable capability skill name to run each case under. Required when more "
        "than one executable capability is available.\n"
        "  - action_name (str): action name to disambiguate when a skill exposes multiple actions.\n"
        "  - required_sandbox (str): OS capability override (`android`); defaults to the capability's "
        "own requirement."
    )

    async def build_tasks(self, context: ToolContext, adapter_input: AdapterInput) -> PreparedTaskBatch:
        options = _parse_options(adapter_input.options_json)
        extract_request = ExtractWorkbookCasesInput(
            source_path=options.source_path,
            file_path=options.file_path,
            sheet_name=options.sheet_name,
            row_start=options.row_start,
            row_end=options.row_end,
            case_ids=list(options.case_ids),
            max_cases=options.max_cases,
        )
        matched_card = _resolve_capability(tuple(context.skill_loader.list_cards()), options)

        result = await asyncio.to_thread(extract_workbook_cases_for_request, context, extract_request)
        if result.get("error_message"):
            raise WorkbookAdapterError(
                str(result["error_message"]),
                code="workbook_extract_failed",
                details=_result_details(options, result),
            )

        cases = result.get("cases") if isinstance(result.get("cases"), list) else []
        if not cases:
            raise WorkbookAdapterError(
                "no workbook cases matched the selected scope",
                code="workbook_no_cases",
                details=_result_details(options, result),
            )

        try:
            tasks = tuple(
                _build_task_spec(case, options, matched_card, index)
                for index, case in enumerate(cases, start=1)
            )
        except ValueError as exc:
            raise WorkbookAdapterError(
                str(exc),
                code="workbook_extract_failed",
                details=_result_details(options, result),
            ) from exc

        description = _batch_description(result, tasks, options)
        skill_description = _load_skill_description(matched_card)
        adapter_state: dict[str, Any] = {}
        if skill_description:
            adapter_state["skill_description"] = skill_description
        adapter_state["response_hint"] = (
            "After all tasks complete, create a final summary report according to the "
            "results and the skill description requirement for reporting. "
            "For each report path in the results, use the report tool to convert "
            "the path into a downloadable URL (set as_deliverable=true). "
            "Include these downloadable links in your summary so the user can "
            "access every individual report. Unless the user explicitly asks for raw data, "
            "no need to further call grep/read tools to gather more information."
        )
        return PreparedTaskBatch(
            batch=TaskBatchInput(tasks=tasks, description=description),
            batch_metadata={"workbook_cases": _compact_options(options)},
            adapter_state=adapter_state,
        )

    async def process_results(
        self,
        batch_result: BatchResult,
        prepared: PreparedTaskBatch,
        manager: "TaskManager",
    ) -> dict[str, Any]:
        payload = await manager.build_tool_payload(batch_result, keep_full_structure=True)
        # Strip verbose summaries from individual results to keep the payload concise.
        for item in payload.get("results", []):
            if isinstance(item, dict):
                item.pop("summary", None)
        # Attach adapter-produced context for the chat agent.
        if prepared.adapter_state:
            payload["additional_info"] = prepared.adapter_state
        return payload


def _load_skill_description(card: CapabilityCard) -> str:
    """Read the SKILL.md from the matched capability's skill directory, if present."""
    if not card.skill_dir:
        return ""
    from pathlib import Path

    skill_md = Path(card.skill_dir) / "SKILL.md"
    if not skill_md.is_file():
        return ""
    try:
        return skill_md.read_text(encoding="utf-8")
    except OSError:
        _LOGGER.warning("failed to read SKILL.md for skill %s", card.skill_name, exc_info=True)
        return ""


def _parse_options(options_json: str) -> WorkbookAdapterOptions:
    """Decode the LLM-supplied ``options_json`` string into :class:`WorkbookAdapterOptions`."""
    if not options_json.strip():
        decoded: Any = {}
    else:
        try:
            decoded = json.loads(options_json)
        except json.JSONDecodeError as exc:
            raise WorkbookAdapterError(
                f"workbook adapter options_json is not valid JSON: {exc}",
                code="workbook_options_invalid",
                details={"options_json": options_json},
            ) from exc
    if not isinstance(decoded, dict):
        raise WorkbookAdapterError(
            "workbook adapter options_json must decode to a JSON object",
            code="workbook_options_invalid",
            details={"options_json": options_json},
        )
    try:
        return WorkbookAdapterOptions.model_validate(decoded)
    except ValidationError as exc:
        raise WorkbookAdapterError(
            f"workbook adapter options_json failed validation: {exc.errors()}",
            code="workbook_options_invalid",
            details={"options_json": options_json},
        ) from exc


def _resolve_capability(
    capability_cards: tuple[CapabilityCard, ...],
    options: WorkbookAdapterOptions,
) -> CapabilityCard:
    """Pick the executable capability each workbook case should run under.

    Selection order:
      * If ``skill_name`` is set, look it up by name (and ``action_name`` if
        supplied). A mismatched ``required_sandbox`` fails fast.
      * Else if ``required_sandbox`` is set, filter executable cards by it.
      * Else the executable pool must already collapse to a single candidate.
    """
    executable_cards = tuple(card for card in capability_cards if card.is_executable)
    skill_name = options.skill_name.strip()
    action_name = options.action_name.strip()
    requested_sandbox = options.required_sandbox.strip()

    if not executable_cards:
        raise WorkbookAdapterError(
            "no executable capability is available to run workbook cases",
            code="workbook_no_executable_capability",
            details={
                "requested_skill_name": skill_name,
                "requested_action_name": action_name,
                "requested_required_sandbox": requested_sandbox or "auto",
                "available_capabilities": [],
            },
        )

    if skill_name or action_name:
        match = next(
            (
                card
                for card in executable_cards
                if (not skill_name or card.skill_name.strip().lower() == skill_name.lower())
                and (not action_name or card.action_name.strip().lower() == action_name.lower())
            ),
            None,
        )
        if match is None:
            raise WorkbookAdapterError(
                "workbook adapter skill/action did not match any executable capability: "
                f"skill_name={skill_name!r} action_name={action_name!r}",
                code="workbook_no_capability_match",
                details={
                    "requested_skill_name": skill_name,
                    "requested_action_name": action_name,
                    "requested_required_sandbox": requested_sandbox or "auto",
                    "available_capabilities": [_capability_details(card) for card in executable_cards],
                },
            )
        card_sandbox = match.requires_sandbox or ""
        if requested_sandbox and card_sandbox and requested_sandbox != card_sandbox:
            raise WorkbookAdapterError(
                (
                    f"workbook adapter skill_name={skill_name!r} requires sandbox {card_sandbox!r} "
                    f"but required_sandbox={requested_sandbox!r} was requested"
                ),
                code="workbook_no_capability_match",
                details={
                    "requested_skill_name": skill_name,
                    "requested_required_sandbox": requested_sandbox,
                    "capability_required_sandbox": card_sandbox,
                    "available_capabilities": [_capability_details(card) for card in executable_cards],
                },
            )
        return match

    if requested_sandbox:
        candidates = tuple(card for card in executable_cards if card.requires_sandbox == requested_sandbox)
        if not candidates:
            raise WorkbookAdapterError(
                f"no executable capability matches required_sandbox={requested_sandbox!r}",
                code="workbook_no_capability_match",
                details={
                    "requested_required_sandbox": requested_sandbox,
                    "available_capabilities": [_capability_details(card) for card in executable_cards],
                },
            )
    else:
        candidates = executable_cards

    if len(candidates) > 1:
        raise WorkbookAdapterError(
            "workbook adapter could not choose between multiple executable capabilities; "
            "pass skill_name in options_json to disambiguate",
            code="workbook_ambiguous_capability",
            details={
                "requested_required_sandbox": requested_sandbox or "auto",
                "available_capabilities": [_capability_details(card) for card in candidates],
            },
        )
    return candidates[0]


def _build_task_spec(
    case: dict[str, Any],
    options: WorkbookAdapterOptions,
    matched_card: CapabilityCard,
    index: int,
) -> TaskSpec:
    sheet_name = str(case.get("sheet_name") or options.sheet_name or "workbook")
    case_id = str(case.get("case_id") or "").strip()
    title = str(case.get("title") or case_id or f"{sheet_name} case {index}").strip()
    data_row = _coerce_int(case.get("data_row_index"), fallback=index, field_name="data_row_index")
    source_row = _coerce_int(case.get("source_row"), fallback=None, field_name="source_row")
    task_id = case_id or f"{sheet_name}-{data_row}"
    args: dict[str, Any] = {
        "case_id": case_id,
        "sheet_name": sheet_name,
        "data_row_index": data_row,
    }
    if source_row is not None:
        args["source_row"] = source_row
    required_sandbox = options.required_sandbox.strip() or matched_card.requires_sandbox
    return TaskSpec(
        task_id=task_id,
        title=title,
        instructions=str(case.get("instructions") or title),
        dispatch=SkillDispatch(
            skill_name=matched_card.skill_name,
            action_name=matched_card.action_name,
        ),
        args=args,
        metadata={"workbook_case": {"sheet_name": sheet_name, "data_row_index": data_row}},
        required_sandbox=required_sandbox,  # type: ignore[arg-type]
    )


def _coerce_int(value: Any, *, fallback: int | None, field_name: str) -> int | None:
    if value in (None, ""):
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"workbook case {field_name} must be an integer") from exc


def _result_details(options: WorkbookAdapterOptions, result: dict[str, Any]) -> dict[str, Any]:
    details: dict[str, Any] = {
        "requested_file_path": options.file_path,
        "requested_sheet_name": options.sheet_name,
        "requested_case_ids": list(options.case_ids),
        "requested_source_path": options.source_path,
    }
    if source_path := result.get("source_path"):
        details["resolved_source_path"] = str(source_path)
    if result.get("file_path"):
        details["resolved_file_path"] = str(result["file_path"])
    if "available_sheets" in result:
        details["available_sheets"] = [sheet for sheet in result.get("available_sheets") or [] if sheet]
    if "selected_sheets" in result:
        details["selected_sheets"] = [str(sheet) for sheet in result.get("selected_sheets") or [] if str(sheet)]
    if "available_sources" in result:
        details["available_sources"] = [source for source in result.get("available_sources") or [] if source]
    return details


def _batch_description(
    result: dict[str, Any],
    tasks: tuple[TaskSpec, ...],
    options: WorkbookAdapterOptions,
) -> str:
    selected_sheets = [str(sheet) for sheet in result.get("selected_sheets") or [] if str(sheet)]
    if selected_sheets:
        sheet_label = ", ".join(selected_sheets)
    elif options.sheet_name.strip():
        sheet_label = options.sheet_name.strip()
    else:
        sheet_label = "selected workbook scope"
    return f"Run {len(tasks)} workbook case(s) from {sheet_label}"


def _capability_details(card: CapabilityCard) -> dict[str, str]:
    return {
        "name": card.name,
        "skill_name": card.skill_name,
        "action_name": card.action_name,
        "requires_sandbox": card.requires_sandbox or "",
    }


def _compact_options(options: WorkbookAdapterOptions) -> dict[str, Any]:
    """Return options with only fields that differ from their defaults, for batch metadata."""
    compact: dict[str, Any] = {}
    for field_name, field_info in options.__class__.model_fields.items():
        value = getattr(options, field_name)
        default = field_info.get_default(call_default_factory=True)
        if value == default:
            continue
        compact[field_name] = value
    return compact


__all__ = [
    "WorkbookAdapter",
    "WorkbookAdapterError",
    "WorkbookAdapterOptions",
]
