"""Expose one mixed-source durable preparation tool to the TASK chat route."""

from __future__ import annotations

import json
import logging
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, ConfigDict, Field

from app.biz.chat.preparation import DelegatePreparationService, NeedsClarification, PreparationError, Rejected
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

DELEGATE_TOOL_NAME = "delegate"


class DelegateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_json: str = Field(
        ...,
        description=(
            "JSON-encoded DelegateRequest with batch_goal, optional join_strategy/max_concurrency, and sources. "
            "Instruction items support goal, title, params, capability_id or profile_id, capability_grants, "
            "max_model_turns, and stage; source_materialization is reserved for injected rerun_request_json and "
            "must be passed through unchanged. Tabular sources support documents (source_ref, sheet_names, row_start, "
            "row_end, case_ids), capability_ids, parameter_bindings, max_rows, and stage. Omit unused optional "
            "fields. Use one call for all related files and instructions."
        ),
    )


def build_delegate_tool(service: DelegatePreparationService) -> FunctionTool:
    async def _func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
        context = get_tool_context(invocation_ctx)
        if context is None:
            return {"error_message": "missing tool context", "code": "missing_tool_context", "details": {}}
        return await _run_delegate(service, context, str(kwargs.get("request_json") or ""))

    return FunctionTool(
        name=DELEGATE_TOOL_NAME,
        description=(
            "Prepare and execute one durable batch from mixed sources. Pass one JSON string with `batch_goal` and "
            "`sources`: instruction items and/or one or more XLSX/XLSM/CSV/TSV/archived-JSONL tabular documents. "
            "The shared source service selects typed rows; preparation chooses only visible capabilities, binds "
            "columns to typed parameters, validates every selected row, and submits no work when clarification, "
            "rejection, or an operational preparation failure occurs."
        ),
        input_model=DelegateInput,
        additional_properties={"max_output_length": 50_000},
        func=_func,
    )


async def _run_delegate(
    service: DelegatePreparationService,
    context: ToolContext,
    request_json: str,
) -> dict[str, Any]:
    from app.biz.task_runtime import default_task_manager
    from app.biz.task_runtime.context import TurnContext

    try:
        outcome = await service.prepare(context, request_json)
    except PreparationError as exc:
        _LOGGER.warning("delegate_preparation_failed code=%s err=%s", exc.code, exc)
        return _failure_payload(exc)
    except Exception as exc:  # noqa: BLE001
        _LOGGER.exception("delegate_preparation_unexpected_failure")
        return {
            "outcome": "preparation_failed",
            "error_message": f"delegate preparation failed: {exc}",
            "code": "preparation_failed",
            "details": {},
        }
    if isinstance(outcome, NeedsClarification):
        return _clarification_payload(outcome)
    if isinstance(outcome, Rejected):
        return _rejection_payload(outcome)
    prepared = outcome
    submission_id = context.next_task_submission_id()
    turn_context = TurnContext.from_tool_context(
        context,
        submission_id=submission_id,
        submission_source="delegate",
    )
    manager = default_task_manager(turn_context)
    try:
        result = await manager.submit_prepared(turn_context, prepared)
        payload = await service.process_results(result, prepared, manager)
        if _LOGGER.isEnabledFor(logging.DEBUG):
            _LOGGER.debug("delegate_tool_payload payload=%s", json.dumps(payload, indent=2))
        return payload
    except Exception as exc:  # noqa: BLE001
        _LOGGER.exception("delegate_submit_failed")
        return {
            "error_message": f"task runtime submit failed: {exc}",
            "code": "task_submit_failed",
            "details": {},
        }


def _clarification_payload(outcome: NeedsClarification) -> dict[str, Any]:
    return {
        "outcome": "needs_clarification",
        "error_message": outcome.message,
        "code": outcome.code,
        "details": dict(outcome.details),
        "understood": list(outcome.understood),
        "missing": list(outcome.missing),
        "suggestions": list(outcome.suggestions),
    }


def _rejection_payload(outcome: Rejected) -> dict[str, Any]:
    return {
        "outcome": "rejected",
        "error_message": outcome.message,
        "code": outcome.code,
        "details": dict(outcome.details),
    }


def _failure_payload(outcome: PreparationError) -> dict[str, Any]:
    return {
        "outcome": "preparation_failed",
        "error_message": str(outcome),
        "code": outcome.code,
        "details": outcome.details,
    }


__all__ = ["DELEGATE_TOOL_NAME", "DelegateInput", "build_delegate_tool"]
