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

from __future__ import annotations

import logging
from typing import Any, Literal

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.biz.task_runtime.context import TurnContext
from app.biz.task_runtime.manager import default_task_manager
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)


class GetTaskDetailInput(BaseModel):
    run_id: str = Field(description="Task run id returned by a delegate_* task tool.")
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
