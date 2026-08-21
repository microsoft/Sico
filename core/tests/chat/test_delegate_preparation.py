from __future__ import annotations

import json

import pytest
from agent_framework._middleware import FunctionInvocationContext

from app.biz.chat.preparation import (
    DirectCapability,
    NeedsClarification,
    PlannedWorkItem,
    PreparationError,
    Rejected,
    WorkItem,
    assemble_batch,
)
from app.biz.task_runtime.domain.models import BatchResult
from app.tools.common import _TOOL_CONTEXT_KWARGS_KEY, ToolContext
from app.tools.delegate import _run_delegate, build_delegate_tool


class _Service:
    def __init__(self, outcome) -> None:
        self.outcome = outcome

    async def prepare(self, context, request_json):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome

    async def process_results(self, result, prepared, manager):
        return await manager.build_tool_payload(result)


def _context() -> ToolContext:
    return ToolContext.model_construct(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        project_id=9,
        conversation_id=1,
        turn_id=2,
        plan_editor=object(),
        submission_id="submission-1",
        task_submission_index=0,
    )


def _invocation_context(tool, context: ToolContext | None = None) -> FunctionInvocationContext:
    kwargs = {_TOOL_CONTEXT_KWARGS_KEY: context} if context is not None else {}
    return FunctionInvocationContext(function=tool, arguments={}, kwargs=kwargs)


@pytest.mark.asyncio
async def test_delegate_returns_clarification_without_allocating_submission() -> None:
    context = _context()
    service = _Service(
        NeedsClarification(
            "Choose a sheet",
            code="tabular_sheet_required",
            understood=("Resolved cases.xlsx",),
            missing=("sheet_name",),
            suggestions=("Use Cases",),
        )
    )

    payload = await _run_delegate(service, context, "{}")

    assert payload["outcome"] == "needs_clarification"
    assert payload["code"] == "tabular_sheet_required"
    assert payload["missing"] == ["sheet_name"]
    assert context.task_submission_index == 0


@pytest.mark.asyncio
async def test_delegate_returns_rejection_without_allocating_submission() -> None:
    context = _context()

    payload = await _run_delegate(_Service(Rejected("No capability", code="preparation_no_capability")), context, "{}")

    assert payload["outcome"] == "rejected"
    assert context.task_submission_index == 0


@pytest.mark.asyncio
async def test_delegate_returns_operational_preparation_failure_without_submission() -> None:
    context = _context()
    error = PreparationError("planner unavailable", code="task_planner_llm_failed", details={"retryable": True})

    payload = await _run_delegate(_Service(error), context, "{}")

    assert payload == {
        "outcome": "preparation_failed",
        "error_message": "planner unavailable",
        "code": "task_planner_llm_failed",
        "details": {"retryable": True},
    }
    assert context.task_submission_index == 0


@pytest.mark.asyncio
async def test_delegate_allocates_once_and_submits_only_after_success(monkeypatch: pytest.MonkeyPatch) -> None:
    prepared = assemble_batch(
        "Echo",
        (PlannedWorkItem(WorkItem(item_id="1", goal="Echo"), DirectCapability("echo")),),
    )
    context = _context()

    class _Manager:
        def __init__(self) -> None:
            self.submissions = []

        async def submit_prepared(self, turn_context, submitted):
            self.submissions.append((turn_context, submitted))
            return BatchResult.model_construct(batch_id="batch-1", status="completed", results=[])

        async def build_tool_payload(self, result):
            return {"batch_id": result.batch_id, "status": result.status}

    manager = _Manager()
    monkeypatch.setattr("app.biz.task_runtime.default_task_manager", lambda turn_context: manager)

    payload = await _run_delegate(_Service(prepared), context, "{}")

    assert payload == {"batch_id": "batch-1", "status": "completed"}
    assert context.task_submission_index == 1
    assert len(manager.submissions) == 1


@pytest.mark.asyncio
async def test_delegate_function_tool_requires_request_json() -> None:
    tool = build_delegate_tool(_Service(Rejected("no")))

    with pytest.raises(TypeError, match="request_json"):
        await tool.invoke(arguments={"kind": "general", "options_json": "{}"})


@pytest.mark.asyncio
async def test_delegate_function_tool_rejects_legacy_fields_with_request_json() -> None:
    tool = build_delegate_tool(_Service(Rejected("no")))

    with pytest.raises(TypeError, match="kind|extra"):
        await tool.invoke(arguments={"request_json": "{}", "kind": "general", "options_json": "{}"})


@pytest.mark.asyncio
async def test_delegate_function_tool_reports_missing_context() -> None:
    tool = build_delegate_tool(_Service(Rejected("no")))

    result = await tool.invoke(arguments={"request_json": "{}"}, context=_invocation_context(tool))
    payload = json.loads(result[0].text)

    assert payload["code"] == "missing_tool_context"


@pytest.mark.asyncio
async def test_delegate_function_tool_preserves_clarification_payload() -> None:
    outcome = NeedsClarification("Choose a sheet", missing=("sheet_name",))
    tool = build_delegate_tool(_Service(outcome))

    result = await tool.invoke(arguments={"request_json": "{}"}, context=_invocation_context(tool, _context()))
    payload = json.loads(result[0].text)

    assert payload["outcome"] == "needs_clarification"
    assert payload["missing"] == ["sheet_name"]
