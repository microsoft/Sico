"""Adapt the current chat function-tool surface to shared runtime capabilities."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext

from app.biz.task_runtime.sub_agent.loop import (
    AgentContent,
    AgentToolDescriptor,
    AgentToolsetSnapshot,
    BoundAgentTool,
    CapabilityCall,
    Observation,
    TokenUsage,
)
from app.biz.task_runtime.sub_agent.profile import CapabilityCeiling, ceiling_allows
from app.tools.common import _TOOL_CONTEXT_KWARGS_KEY, ToolContext

_TOOL_CAPABILITY_IDS = {
    "plan_read": "builtin:plan:read",
    "plan_write": "builtin:plan:write",
    "plan_tool_call_message_update": "builtin:plan:update_call",
    "delegate": "builtin:delegate",
}


class ChatCapabilityToolController:
    """Expose chat-scoped tools as a static capability snapshot for one turn."""

    def __init__(
        self,
        tools: Sequence[FunctionTool | Mapping[str, object]],
        context: ToolContext,
        *,
        capability_ceiling: CapabilityCeiling = "*",
    ) -> None:
        bound = tuple(_bind_tool(tool, context) for tool in tools if isinstance(tool, FunctionTool))
        self._tools = tuple(tool for tool in bound if ceiling_allows(capability_ceiling, tool.descriptor.tool_id))

    async def snapshot(self) -> AgentToolsetSnapshot:
        return AgentToolsetSnapshot(revision=1, tools=self._tools)


def _bind_tool(tool: FunctionTool, context: ToolContext) -> BoundAgentTool:
    capability_id = _TOOL_CAPABILITY_IDS.get(tool.name, f"builtin:{tool.name}")
    schema_spec = tool.to_json_schema_spec().get("function", {})
    parameter_schema = schema_spec.get("parameters", {}) if isinstance(schema_spec, dict) else {}

    async def invoke(call: CapabilityCall, snapshot) -> Observation:
        invocation_context = FunctionInvocationContext(
            tool,
            call.args,
            kwargs={_TOOL_CONTEXT_KWARGS_KEY: context},
        )
        try:
            result = await tool.invoke(
                arguments=call.args,
                context=invocation_context,
                tool_call_id=call.call_id,
            )
        except Exception as exc:  # noqa: BLE001 - tool failures are model-visible observations.
            return Observation(
                capability=call.capability,
                ok=False,
                call_id=call.call_id,
                status="failed",
                summary=str(exc),
                error_class="internal",
                error_message=str(exc),
                content=str(exc),
            )
        content = _render_result(result)
        usage = _result_usage(result)
        return Observation(
            capability=call.capability,
            ok=not _result_failed(result),
            call_id=call.call_id,
            status="completed",
            summary=content,
            content=content,
            contents=_result_contents(result),
            usage=usage,
        )

    return BoundAgentTool(
        descriptor=AgentToolDescriptor(
            tool_id=capability_id,
            description=tool.description,
            parameter_schema=parameter_schema if isinstance(parameter_schema, dict) else {},
        ),
        invoke=invoke,
    )


def _render_result(result: Any) -> str:
    if isinstance(result, list):
        values = [_content_value(item) for item in result]
        values = [value for value in values if value not in (None, "")]
        if len(values) == 1 and isinstance(values[0], str):
            return values[0]
        return json.dumps(values, ensure_ascii=False, default=str)
    return json.dumps(result, ensure_ascii=False, default=str) if not isinstance(result, str) else result


def _content_value(content: Any) -> Any:
    if getattr(content, "type", "") == "text":
        return getattr(content, "text", "")
    to_dict = getattr(content, "to_dict", None)
    return to_dict() if callable(to_dict) else content


def _result_contents(result: Any) -> tuple[AgentContent, ...]:
    if not isinstance(result, list):
        return ()
    contents: list[AgentContent] = []
    for item in result:
        media_type = str(getattr(item, "media_type", "") or "")
        uri = str(getattr(item, "uri", "") or "")
        if getattr(item, "type", "") in {"data", "uri"} and media_type.startswith("image/") and uri:
            contents.append(AgentContent(type="image", uri=uri, mime_type=media_type))
    return tuple(contents)


def _result_failed(result: Any) -> bool:
    text = _render_result(result)
    try:
        payload = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return False
    if isinstance(payload, dict):
        return bool(payload.get("error_message") or payload.get("error")) or payload.get("success") is False
    return False


def _result_usage(result: Any) -> TokenUsage:
    text = _render_result(result)
    try:
        payload = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return TokenUsage()
    if not isinstance(payload, dict) or not isinstance(payload.get("usage"), dict):
        return TokenUsage()
    usage = payload["usage"]
    return TokenUsage(
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
        total_tokens=int(usage.get("total_tokens") or 0),
        cached_input_tokens=int(usage.get("cached_input_tokens") or 0),
        reasoning_tokens=int(usage.get("reasoning_tokens") or 0),
    )
