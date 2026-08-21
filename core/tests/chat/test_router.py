import asyncio
import json
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.chat import router
from app.biz.chat.router import (
    ChatRouteRequest,
    ChatRouterChain,
    HardGuardChatRouter,
    HardGuardRules,
    LlmChatRouter,
    llm_intent_check,
    load_hard_guard_rules,
)
from app.biz.chat.types import ChatIntentCheckerInput, ChatRouteDecision, ChatRouteMode


def _request(prompt: str, *, has_attachments: bool = False) -> ChatRouteRequest:
    return ChatRouteRequest(
        user_prompt=prompt,
        has_attachments=has_attachments,
        build_intent_input=lambda: ChatIntentCheckerInput(user_prompt=prompt),
    )


class _StubRouter:
    def __init__(self, decision: ChatRouteDecision | None) -> None:
        self.decision = decision
        self.calls = 0

    async def decide(self, request: ChatRouteRequest) -> ChatRouteDecision | None:
        self.calls += 1
        return self.decision


class _RaisingRouter:
    async def decide(self, request: ChatRouteRequest) -> ChatRouteDecision | None:
        raise RuntimeError("router blew up")


# ---------------------------------------------------------------------------
# HardGuardChatRouter — keyword + attachment heuristic
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hard_guard_empty_prompt_without_attachments_is_fast() -> None:
    decision = await HardGuardChatRouter().decide(_request("   "))

    assert decision is not None
    assert decision.route == ChatRouteMode.FAST
    assert decision.reason == "hard_guard:empty_prompt"


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", ["Run all cases in this workbook", "execute the workbook", "批量重跑这些用例"])
async def test_hard_guard_task_keywords_route_to_task(prompt: str) -> None:
    decision = await HardGuardChatRouter().decide(_request(prompt, has_attachments=True))

    assert decision is not None
    assert decision.route == ChatRouteMode.TASK
    assert decision.reason == "hard_guard:task_keyword"


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", ["Please inspect the last run", "explain what happened", "复盘一下这次执行"])
async def test_hard_guard_defers_read_only_prompts(prompt: str) -> None:
    # Read-only wording is no longer a route of its own; the LLM stage decides.
    assert await HardGuardChatRouter().decide(_request(prompt)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", ["hello", "Hi", "hey!", "thanks", "thank you.", "你好", "谢谢！"])
async def test_hard_guard_bare_greetings_route_to_fast(prompt: str) -> None:
    decision = await HardGuardChatRouter().decide(_request(prompt))

    assert decision is not None
    assert decision.route == ChatRouteMode.FAST
    assert decision.reason == "hard_guard:fast_greeting"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "prompt",
    [
        "hello, run tests",
        "hey, delete report.txt",
        "hi there, I have a long and rambling question for you",
        "thanks - now summarize the last run",
    ],
)
async def test_hard_guard_does_not_treat_a_prefixed_request_as_a_greeting(prompt: str) -> None:
    # A greeting prefix used to win here, handing a real request zero tools.
    assert await HardGuardChatRouter().decide(_request(prompt)) is None


@pytest.mark.asyncio
async def test_hard_guard_greeting_with_attachment_defers() -> None:
    assert await HardGuardChatRouter().decide(_request("hello", has_attachments=True)) is None


@pytest.mark.asyncio
async def test_hard_guard_task_keyword_wins_over_surrounding_text() -> None:
    decision = await HardGuardChatRouter().decide(_request("explain then run all of them"))

    assert decision is not None
    assert decision.route == ChatRouteMode.TASK


@pytest.mark.asyncio
async def test_hard_guard_ambiguous_prompt_defers() -> None:
    assert await HardGuardChatRouter().decide(_request("Could you help me with this document?")) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", ["what is batch normalization?", "explain how the sandbox pool works", "批量处理是什么意思"])
async def test_hard_guard_does_not_treat_a_topic_mention_as_an_execution_request(prompt: str) -> None:
    # Keywords name actions, not topics; a topic noun matches people merely asking about it.
    assert await HardGuardChatRouter().decide(_request(prompt)) is None


# ---------------------------------------------------------------------------
# Externalized keyword rules
# ---------------------------------------------------------------------------


def test_rules_are_loaded_from_the_config_file() -> None:
    rules = load_hard_guard_rules()

    assert "重跑" in rules.task_keywords
    assert "hello" in rules.fast_greetings


@pytest.mark.asyncio
async def test_rules_drive_the_guard() -> None:
    guard = HardGuardChatRouter(HardGuardRules(task_keywords=("deploy it",)))

    decision = await guard.decide(_request("please deploy it now"))

    assert decision is not None
    assert decision.route == ChatRouteMode.TASK
    assert await guard.decide(_request("hello")) is None


@pytest.mark.asyncio
async def test_unreadable_rules_disable_the_guard(tmp_path: Path) -> None:
    # A packaging mistake must not misroute turns; it only costs the LLM stage.
    rules = load_hard_guard_rules(tmp_path / "missing.toml")

    assert rules == HardGuardRules()
    assert await HardGuardChatRouter(rules).decide(_request("run all of them")) is None


@pytest.mark.parametrize(
    "body",
    [
        'task = "broken"\n',
        '[task]\nkeywords = "execute"\n',
        "[task]\nkeywords = [1, 2]\n",
        '[task]\nkeywords = ["", "   "]\n[fast]\ngreetings = ["", "!"]\n',
    ],
)
def test_unusable_rules_are_ignored(tmp_path: Path, body: str) -> None:
    # Each of these used to become an active rule: a bare string splits into one
    # rule per character, and a blank keyword is a substring of every message.
    path = tmp_path / "route_rules.toml"
    path.write_text(body, encoding="utf-8")

    assert load_hard_guard_rules(path) == HardGuardRules()


@pytest.mark.parametrize("body", ["", '[fast]\ngreetings = ["hi"]\n'])
def test_a_partial_config_is_not_reported_as_malformed(tmp_path: Path, body: str, caplog: pytest.LogCaptureFixture) -> None:
    # Leaving a table out is a choice, not a mistake; only a present-but-misshapen value warns.
    path = tmp_path / "route_rules.toml"
    path.write_text(body, encoding="utf-8")

    with caplog.at_level(logging.WARNING):
        load_hard_guard_rules(path)

    assert "chat_route_rules_malformed" not in caplog.text


# ---------------------------------------------------------------------------
# ChatRouterChain
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chain_returns_the_first_decision_and_stops() -> None:
    first = _StubRouter(ChatRouteDecision(route=ChatRouteMode.FAST, reason="first"))
    second = _StubRouter(ChatRouteDecision(route=ChatRouteMode.TASK, reason="second"))

    decision = await ChatRouterChain((first, second)).decide(_request("hi"))

    assert decision.reason == "first"
    assert second.calls == 0


@pytest.mark.asyncio
async def test_chain_falls_through_deferring_routers() -> None:
    deferring = _StubRouter(None)
    deciding = _StubRouter(ChatRouteDecision(route=ChatRouteMode.TASK, reason="second"))

    decision = await ChatRouterChain((deferring, deciding)).decide(_request("hi"))

    assert decision.reason == "second"
    assert deferring.calls == 1


@pytest.mark.asyncio
async def test_exhausted_chain_falls_back_to_task() -> None:
    decision = await ChatRouterChain((_StubRouter(None),)).decide(_request("hi"))

    assert decision.route == ChatRouteMode.TASK
    assert decision.reason == "router_chain_exhausted"


@pytest.mark.asyncio
async def test_a_raising_router_defers_instead_of_failing_the_turn() -> None:
    deciding = _StubRouter(ChatRouteDecision(route=ChatRouteMode.FAST, reason="second"))

    decision = await ChatRouterChain((_RaisingRouter(), deciding)).decide(_request("hi"))

    assert decision.reason == "second"


@pytest.mark.asyncio
async def test_the_chain_does_not_swallow_cancellation() -> None:
    # Fails the moment the chain's ``except Exception`` is widened to BaseException,
    # which would let a cancelled turn carry on being routed.
    class _Cancelling:
        async def decide(self, request: ChatRouteRequest) -> ChatRouteDecision | None:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await ChatRouterChain((_Cancelling(), _StubRouter(None))).decide(_request("hi"))


@pytest.mark.asyncio
async def test_an_unbuildable_intent_payload_still_routes() -> None:
    def explode() -> ChatIntentCheckerInput:
        raise ValueError("malformed attachment")

    request = ChatRouteRequest(user_prompt="summarize this", has_attachments=True, build_intent_input=explode)

    decision = await ChatRouterChain((HardGuardChatRouter(), LlmChatRouter())).decide(request)

    assert decision.route == ChatRouteMode.TASK


@pytest.mark.asyncio
async def test_hard_guarded_turn_never_builds_the_intent_payload() -> None:
    built = False

    def build_intent_input() -> ChatIntentCheckerInput:
        nonlocal built
        built = True
        return ChatIntentCheckerInput(user_prompt="hello")

    request = ChatRouteRequest(user_prompt="hello", has_attachments=False, build_intent_input=build_intent_input)

    decision = await ChatRouterChain((HardGuardChatRouter(), LlmChatRouter())).decide(request)

    assert decision.route == ChatRouteMode.FAST
    assert not built, "the LLM payload must stay unbuilt when the guard decides"


# ---------------------------------------------------------------------------
# LlmChatRouter / llm_intent_check
# ---------------------------------------------------------------------------


def _stub_llm(monkeypatch: pytest.MonkeyPatch, structured: dict[str, object], captured: dict[str, object]) -> None:
    def fake_build_llm_request(messages, response_format):
        captured["payload"] = json.loads(messages[1]["content"][0]["text"])
        return SimpleNamespace()

    async def fake_generate(*, request):
        return SimpleNamespace(code=0, msg="", outputs=[SimpleNamespace(json=structured)], text="")

    monkeypatch.setattr(router, "build_llm_request", fake_build_llm_request)
    monkeypatch.setattr(router.app.llmhubs, "generate", fake_generate)


@pytest.mark.asyncio
async def test_llm_router_maps_the_intent_output(monkeypatch: pytest.MonkeyPatch) -> None:
    # `confidence` was retired from the schema; a model that still sends it must not break the turn.
    _stub_llm(monkeypatch, {"route": "fast", "confidence": 0.7, "reason": "small talk"}, {})

    decision = await LlmChatRouter().decide(_request("how are you doing today?"))

    assert decision.route == ChatRouteMode.FAST
    assert decision.reason == "small talk"


@pytest.mark.asyncio
async def test_retired_route_value_falls_back_to_task(monkeypatch: pytest.MonkeyPatch) -> None:
    # A model still answering with the removed read-only route must not break the
    # turn: validation fails and the defensive TASK default applies.
    _stub_llm(monkeypatch, {"route": "inspect", "confidence": 0.9, "reason": "read only"}, {})

    decision = await LlmChatRouter().decide(_request("what did the last run do?"))

    assert decision.route == ChatRouteMode.TASK
    assert decision.reason == "intent_check_validation_failed"


@pytest.mark.asyncio
async def test_intent_payload_includes_project_knowledge_workbook_context(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    _stub_llm(monkeypatch, {"route": "task", "confidence": 0.91, "reason": "workbook knowledge"}, captured)

    output = await llm_intent_check(
        ChatIntentCheckerInput(
            user_prompt="Run the project knowledge workbook cases",
            workspace_knowledge_section=(
                "Knowledge tabular sources available for delegate request_json:\n- knowledge/1/original/cases.xlsx"
            ),
        )
    )

    assert output.route == ChatRouteMode.TASK
    payload = captured["payload"]
    assert payload["workspace_knowledge_section"].endswith("knowledge/1/original/cases.xlsx")
    assert "case_source_resolution_section" not in payload
