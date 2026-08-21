from __future__ import annotations

import logging
from typing import Any, Literal

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.biz.task_runtime.context import TurnContext
from app.biz.task_runtime import default_task_manager
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)


class GetTaskDetailInput(BaseModel):
    run_id: str = Field(description="Task run id returned by the delegate tool.")
    view: Literal["summary", "artifacts"] = Field(default="summary")


async def _get_task_detail_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}
    try:
        payload = GetTaskDetailInput.model_validate(kwargs)
        manager = default_task_manager(TurnContext.from_tool_context(ctx))
        detail = await manager.get_task_detail(payload.run_id, payload.view)
        return {"error_message": "", "detail": detail.model_dump(mode="json", exclude_none=True)}
    except Exception as exc:  # pragma: no cover - defensive guard for agent tool surface
        _LOGGER.exception("get_task_detail failed turn_id=%s", ctx.turn_id)
        return {"error_message": str(exc)}


GET_TASK_DETAIL_TOOL = FunctionTool(
    name="get_task_detail",
    description=(
        "Fetch a delegated task's summary or artifact list by run_id. "
        "Use only when digest is insufficient."
    ),
    input_model=GetTaskDetailInput,
    func=_get_task_detail_func,
)
