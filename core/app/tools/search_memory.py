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

import logging
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, ConfigDict, Field

from app.memory.mem0 import build_memory_filters, extract_memory_texts, get_shared_mem0
from app.schemas.conversation.plan import ToolExecutionInfo, ToolType
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)
_DEFAULT_THRESHOLD = 0.5
_DEFAULT_TOP_K = 5


class SearchMemoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(description="Search query for retrieving related memories.", min_length=1)


async def _search_memory_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    try:
        payload = SearchMemoryInput.model_validate(kwargs)
    except Exception as exc:
        _LOGGER.info("Search memory tool called with invalid input", exc_info=True)
        return {"error": str(exc)}

    query = payload.query.strip()
    if not query:
        return {"error": "query is required"}

    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        _LOGGER.warning("Search memory tool missing tool context")
        return {"error": "missing tool context"}

    agent_id = str(ctx.agent_instance_id) if ctx.agent_instance_id is not None else None
    filters = build_memory_filters(username=ctx.username, agent_id=agent_id, conversation_id=ctx.conversation_id)
    if not filters:
        _LOGGER.warning("Search memory tool missing mem0 filters")
        return {"error": "missing mem0 filters"}

    _LOGGER.info(
        "Search memory tool start agent_instance_id=%s conversation_id=%s username=%s query_len=%d threshold=%s",
        ctx.agent_instance_id,
        ctx.conversation_id,
        ctx.username,
        len(query),
        _DEFAULT_THRESHOLD,
    )

    tool_call_id = await ctx.plan_editor.create_tool_call(
        "Search memory",
        "Searching related memories.",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="search_memory",
        ),
    )

    try:
        memory = get_shared_mem0()
        search_response = await memory.search(query=query, filters=filters, threshold=_DEFAULT_THRESHOLD, top_k=_DEFAULT_TOP_K)
        memories = extract_memory_texts(search_response)
        await ctx.plan_editor.update_tool_call_message(tool_call_id, f"Found {len(memories)} related memories.")
        return {"memories": memories}
    except Exception as exc:
        error_message = str(exc)
        _LOGGER.warning("Search memory tool failed", exc_info=True)
        await ctx.plan_editor.update_tool_call_message(tool_call_id, "Failed to search related memories.")
        return {"error": error_message}


SEARCH_MEMORY_TOOL = FunctionTool(
    name="search_memory",
    description=(
        "Search long-term conversation memory for information related to a query. "
        "Provide a single query string. Returns an object with memories, or an error string if search fails."
    ),
    input_model=SearchMemoryInput,
    func=_search_memory_func,
)
