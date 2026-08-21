import pytest

from app.biz.chat.tool_registry import CHAT_TOOLS, ToolRegistry, default_tool_registry
from app.biz.chat.types import ChatRouteMode
from app.tools import BUILTIN_TOOLS, READ_TOOL, WEB_SEARCH_TOOL, WRITE_FILE_TOOL


def test_fast_route_exposes_no_tools() -> None:
    assert default_tool_registry().tools_for_route(ChatRouteMode.FAST) == []


def test_task_route_exposes_the_whole_chat_surface() -> None:
    assert default_tool_registry().tools_for_route(ChatRouteMode.TASK) == list(CHAT_TOOLS)


def test_task_route_exposes_server_side_web_search() -> None:
    assert WEB_SEARCH_TOOL == {"type": "web_search"}
    assert WEB_SEARCH_TOOL in default_tool_registry().tools_for_route(ChatRouteMode.TASK)


def test_the_chat_surface_is_every_builtin_tool_plus_web_search() -> None:
    # The surface is an allow-list, so a tool added to app.tools stays unreachable
    # from chat until it is named there. web_search is a server-side Responses API
    # spec rather than a FunctionTool, so it is not in BUILTIN_TOOLS.
    assert len(CHAT_TOOLS) == len(BUILTIN_TOOLS) + 1
    assert all(tool in CHAT_TOOLS for tool in BUILTIN_TOOLS)
    assert WEB_SEARCH_TOOL in CHAT_TOOLS


def test_only_task_may_delegate() -> None:
    registry = default_tool_registry()

    assert registry.may_delegate(ChatRouteMode.TASK)
    assert not registry.may_delegate(ChatRouteMode.FAST)


def test_tools_for_route_returns_fresh_list() -> None:
    registry = default_tool_registry()
    first = registry.tools_for_route(ChatRouteMode.TASK)
    first.clear()

    assert registry.tools_for_route(ChatRouteMode.TASK), "mutating one result must not affect later calls"


def test_registry_rejects_a_route_without_a_tool_list() -> None:
    # A route added to the enum but left out must fail at assembly, not run
    # silently with no tools.
    with pytest.raises(ValueError, match="without a tool list"):
        ToolRegistry({ChatRouteMode.FAST: (READ_TOOL,)}, frozenset())


def test_registry_rejects_a_tool_listed_twice() -> None:
    with pytest.raises(ValueError, match="same chat tool twice"):
        ToolRegistry(
            {ChatRouteMode.FAST: (), ChatRouteMode.TASK: (READ_TOOL, WRITE_FILE_TOOL, READ_TOOL)},
            frozenset({ChatRouteMode.TASK}),
        )


def test_registry_rejects_a_native_tool_spec_listed_twice() -> None:
    # web_search has no ``.name``; duplicate detection must still see it.
    with pytest.raises(ValueError, match="same chat tool twice"):
        ToolRegistry(
            {ChatRouteMode.FAST: (), ChatRouteMode.TASK: (WEB_SEARCH_TOOL, WEB_SEARCH_TOOL)},
            frozenset({ChatRouteMode.TASK}),
        )


def test_registry_rejects_a_native_tool_spec_without_a_type() -> None:
    # Without this, such a spec identifies as "type:" and collides with every other broken one.
    with pytest.raises(ValueError, match="non-empty string 'type'"):
        ToolRegistry(
            {ChatRouteMode.FAST: (), ChatRouteMode.TASK: ({"search_context_size": "low"},)},
            frozenset({ChatRouteMode.TASK}),
        )
