"""Chat tool registry: which tools each route may use.

The chat agent's tool surface is one explicit allow-list, and a route either
receives it whole or receives nothing. Selection is by tool identity, not by a
capability taxonomy over tools.

Two deliberate non-goals:

* This is **not** a permission framework. Route selection controls tool
  availability and cost; it imposes no execution sandbox and no filesystem
  policy, so an effect label here would have nothing standing behind it. What a
  call does depends on its arguments anyway — ``curl`` reads or writes according
  to its method — and only invocation-time middleware sees those.
* This is **not** :class:`app.biz.task_runtime.capabilities.CapabilityResolver`.
  There ``effect`` and ``workspace_access`` are load-bearing because the command
  backend compiles them into a real read-only mount. Sharing one registry would
  also leak chat tools into the batch execution path.
"""

from __future__ import annotations

from collections.abc import Mapping

from agent_framework import FunctionTool

from app.biz.chat.types import ChatRouteMode
from app.tools import (
    CONTEXT_TOOL,
    CURL_TOOL,
    DOWNLOAD_TOOL,
    EDIT_TOOL,
    GET_TASK_DETAIL_TOOL,
    GREP_TOOL,
    PARSE_DOCUMENT_TOOL,
    PLAN_READ_TOOL,
    PLAN_TOOL_CALL_MESSAGE_UPDATE_TOOL,
    PLAN_WRITE_TOOL,
    READ_TOOL,
    REMOVE_TOOL,
    REPORT_TOOL,
    SEARCH_MEMORY_TOOL,
    WEB_SEARCH_TOOL,
    WEBFETCH_TOOL,
    WRITE_FILE_TOOL,
)


# The chat tool list is heterogeneous: client-side tools are ``FunctionTool``,
# while server-side ones (``web_search``) are plain Responses API spec dicts.
ChatTool = FunctionTool | Mapping[str, object]


def _tool_identity(tool: ChatTool) -> str:
    """Stable key for duplicate detection across both tool shapes."""
    if not isinstance(tool, Mapping):
        return tool.name
    tool_type = tool.get("type")
    if not isinstance(tool_type, str) or not tool_type:
        raise ValueError(f"a server-side chat tool spec needs a non-empty string 'type': {tool!r}")
    return f"type:{tool_type}"


# A tool in ``app.tools`` is unreachable from chat until it is named here.
# ``run_command`` is absent because durable work goes through ``delegate``.
CHAT_TOOLS: tuple[ChatTool, ...] = (
    CONTEXT_TOOL,
    READ_TOOL,
    GREP_TOOL,
    PARSE_DOCUMENT_TOOL,
    SEARCH_MEMORY_TOOL,
    GET_TASK_DETAIL_TOOL,
    WRITE_FILE_TOOL,
    EDIT_TOOL,
    REMOVE_TOOL,
    REPORT_TOOL,
    PLAN_READ_TOOL,
    PLAN_WRITE_TOOL,
    PLAN_TOOL_CALL_MESSAGE_UPDATE_TOOL,
    WEBFETCH_TOOL,
    WEB_SEARCH_TOOL,
    CURL_TOOL,
    DOWNLOAD_TOOL,
)

_ROUTE_TOOLS: Mapping[ChatRouteMode, tuple[ChatTool, ...]] = {
    ChatRouteMode.FAST: (),
    ChatRouteMode.TASK: CHAT_TOOLS,
}

# ``delegate`` is on no route's list because it has no static instance: the chat
# service rebuilds it each turn from the live preparation service
# (see ``app.tools.delegate.build_delegate_tool``).
_DELEGATING_ROUTES: frozenset[ChatRouteMode] = frozenset({ChatRouteMode.TASK})


class ToolRegistry:
    """Resolves a route into the tools the chat agent gets."""

    def __init__(
        self,
        route_tools: Mapping[ChatRouteMode, tuple[ChatTool, ...]],
        delegating_routes: frozenset[ChatRouteMode],
    ) -> None:
        # A route added to the enum but left out here would otherwise silently run
        # with no tools at all.
        if missing := [route.value for route in ChatRouteMode if route not in route_tools]:
            raise ValueError(f"chat routes without a tool list: {missing}")
        for route, tools in route_tools.items():
            names = [_tool_identity(tool) for tool in tools]
            if duplicates := sorted({name for name in names if names.count(name) > 1}):
                raise ValueError(f"{route.value} lists the same chat tool twice: {duplicates}")
        self._route_tools = {route: tuple(tools) for route, tools in route_tools.items()}
        self._delegating_routes = frozenset(delegating_routes)

    def tools_for_route(self, route: ChatRouteMode) -> list[ChatTool]:
        """A fresh list of the statically registered tools ``route`` may use."""
        return list(self._route_tools[route])

    def may_delegate(self, route: ChatRouteMode) -> bool:
        """Whether ``route`` also gets the ``delegate`` tool built for this turn."""
        return route in self._delegating_routes


_DEFAULT_REGISTRY = ToolRegistry(_ROUTE_TOOLS, _DELEGATING_ROUTES)


def default_tool_registry() -> ToolRegistry:
    return _DEFAULT_REGISTRY


__all__ = [
    "CHAT_TOOLS",
    "ChatTool",
    "ToolRegistry",
    "default_tool_registry",
]
