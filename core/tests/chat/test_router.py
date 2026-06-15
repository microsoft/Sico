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

import json
from types import SimpleNamespace

import pytest

from app.biz.chat import router
from app.biz.chat.router import hard_guard_route, llm_intent_check, tools_for_route
from app.biz.chat.types import ChatIntentCheckerInput, ChatRouteMode
from app.tools import EDIT_TOOL, READ_TOOL, REPORT_TOOL, WRITE_FILE_TOOL


# ---------------------------------------------------------------------------
# hard_guard_route — keyword + attachment heuristic
# ---------------------------------------------------------------------------


def test_hard_guard_empty_prompt_without_attachments_is_fast() -> None:
    decision = hard_guard_route("   ", has_attachments=False)

    assert decision.route == ChatRouteMode.FAST
    assert decision.reason == "empty_prompt"


@pytest.mark.parametrize("prompt", ["Run all cases in this workbook", "execute the workbook", "批量重跑这些用例"])
def test_hard_guard_task_keywords_route_to_task(prompt: str) -> None:
    decision = hard_guard_route(prompt, has_attachments=True)

    assert decision.route == ChatRouteMode.TASK
    assert decision.reason == "task_keyword"


@pytest.mark.parametrize("prompt", ["Please inspect the last run", "explain what happened", "复盘一下这次执行"])
def test_hard_guard_inspect_like_prompts_are_unspecified(prompt: str) -> None:
    decision = hard_guard_route(prompt, has_attachments=False)

    assert decision.route == ChatRouteMode.UNSPECIFIED
    assert decision.reason == ""


@pytest.mark.parametrize("prompt", ["hello", "hi there", "thanks"])
def test_hard_guard_short_greetings_route_to_fast(prompt: str) -> None:
    decision = hard_guard_route(prompt, has_attachments=False)

    assert decision.route == ChatRouteMode.FAST
    assert decision.reason == "fast_greeting"


def test_hard_guard_greeting_with_attachment_is_not_fast() -> None:
    # Attachments disqualify the fast-greeting shortcut; nothing else fires.
    decision = hard_guard_route("hello", has_attachments=True)

    assert decision.route == ChatRouteMode.UNSPECIFIED
    assert decision.reason == ""


def test_hard_guard_long_greeting_is_not_fast() -> None:
    # The fast-greeting shortcut only fires for short prompts (len <= 24).
    decision = hard_guard_route("hello there, I have a long and rambling question for you", has_attachments=False)

    assert decision.route == ChatRouteMode.UNSPECIFIED
    assert decision.reason == ""


def test_hard_guard_task_keyword_routes_to_task_with_other_text() -> None:
    decision = hard_guard_route("explain then run all of them", has_attachments=False)

    assert decision.route == ChatRouteMode.TASK


def test_hard_guard_ambiguous_prompt_is_unspecified() -> None:
    decision = hard_guard_route("Could you help me with this document?", has_attachments=False)

    assert decision.route == ChatRouteMode.UNSPECIFIED
    assert decision.reason == ""


# ---------------------------------------------------------------------------
# tools_for_route — route → exposed tool set
# ---------------------------------------------------------------------------


def test_fast_route_exposes_no_tools() -> None:
    assert tools_for_route(ChatRouteMode.FAST) == []


def test_inspect_route_is_read_only() -> None:
    tools = tools_for_route(ChatRouteMode.INSPECT)

    assert READ_TOOL in tools
    assert WRITE_FILE_TOOL not in tools
    assert EDIT_TOOL not in tools
    assert REPORT_TOOL in tools


def test_task_route_exposes_write_tools() -> None:
    tools = tools_for_route(ChatRouteMode.TASK)

    assert READ_TOOL in tools
    assert WRITE_FILE_TOOL in tools
    assert EDIT_TOOL in tools
    assert REPORT_TOOL in tools


def test_tools_for_route_returns_fresh_list() -> None:
    first = tools_for_route(ChatRouteMode.TASK)
    first.clear()

    assert tools_for_route(ChatRouteMode.TASK), "mutating one result must not affect later calls"


def test_unknown_route_defaults_to_task_tools() -> None:
    fallback = {tool.name for tool in tools_for_route(ChatRouteMode.UNSPECIFIED)}
    task = {tool.name for tool in tools_for_route(ChatRouteMode.TASK)}

    assert fallback == task


@pytest.mark.asyncio
async def test_intent_payload_includes_project_knowledge_workbook_context(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_build_llm_request(messages, response_format):
        captured["payload"] = json.loads(messages[1]["content"][0]["text"])
        return SimpleNamespace()

    async def fake_generate(*, request):
        return SimpleNamespace(
            code=0,
            msg="",
            outputs=[SimpleNamespace(json={"route": "task", "confidence": 0.91, "reason": "workbook knowledge"})],
            text="",
        )

    monkeypatch.setattr(router, "build_llm_request", fake_build_llm_request)
    monkeypatch.setattr(router.app.llmhubs, "generate", fake_generate)

    output = await llm_intent_check(
        ChatIntentCheckerInput(
            user_prompt="Run the project knowledge workbook cases",
            workspace_knowledge_section=(
                "Knowledge workbook sources available for delegate kind=workbook:\n"
                "- knowledge/1/original/cases.xlsx"
            ),
        )
    )

    assert output.route == ChatRouteMode.TASK
    payload = captured["payload"]
    assert payload["workspace_knowledge_section"].endswith("knowledge/1/original/cases.xlsx")
    assert "case_source_resolution_section" not in payload
