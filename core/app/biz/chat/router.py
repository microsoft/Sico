"""Chat route selection.

A turn is routed to exactly one of two modes: ``FAST`` (answer directly, no
tools) or ``TASK`` (the full chat tool set plus ``delegate``). Routing runs as a
chain of :class:`ChatRouter` stages — each either decides or returns ``None`` to
defer to the next, and an exhausted chain falls back to ``TASK``:

1. :class:`HardGuardChatRouter` — keyword rules loaded from ``route_rules.toml``.
2. :class:`LlmChatRouter` — single-round LLM with structured output
    (:class:`ChatIntentCheckerOutput`) over the delegate tool, direct tools,
   and pre-rendered context sections.

There is deliberately no read-only middle route; see `docs/tools.md` for why the
classification decision was deleted rather than tuned.

Tool selection is *not* here; see :mod:`app.biz.chat.tool_registry`.
"""

from __future__ import annotations

import json
import logging
import re
import tomllib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Protocol

import pydantic

import app.llmhubs
from app.biz.chat.types import (
    ChatIntentCheckerInput,
    ChatIntentCheckerOutput,
    ChatRouteDecision,
    ChatRouteMode,
)
from app.llmhubs.request_builder import build_llm_request

_LOGGER = logging.getLogger(__name__)

_JSON_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.IGNORECASE | re.DOTALL)

_GREETING_EDGE_PATTERN = re.compile(r"^[\s\W_]+|[\s\W_]+$")

_ROUTE_RULES_PATH = Path(__file__).resolve().parent / "route_rules.toml"


# ---------------------------------------------------------------------------
# Router chain
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ChatRouteRequest:
    user_prompt: str
    has_attachments: bool
    # Built on demand: a hard-guarded turn must not pay for assembling prior-turn
    # history into a payload only the LLM stage ever reads.
    build_intent_input: Callable[[], ChatIntentCheckerInput]


class ChatRouter(Protocol):
    async def decide(self, request: ChatRouteRequest) -> ChatRouteDecision | None:
        """Decide the route, or return ``None`` to defer to the next router."""
        ...


class ChatRouterChain:
    """Runs routers in order and returns the first non-deferred decision."""

    def __init__(self, routers: Sequence[ChatRouter]) -> None:
        self._routers = tuple(routers)

    async def decide(self, request: ChatRouteRequest) -> ChatRouteDecision:
        for router in self._routers:
            try:
                decision = await router.decide(request)
            except Exception:
                # A classifier is never worth failing the turn over. Deferring lets
                # a later stage still decide; only an exhausted chain lands on TASK.
                _LOGGER.warning("chat_router_failed router=%s", type(router).__name__, exc_info=True)
                continue
            if decision is not None:
                return decision
        # Routing must never block a turn, and when unsure the wider toolset is
        # the cheaper mistake: a FAST turn withholds ``delegate`` from real work.
        return ChatRouteDecision(route=ChatRouteMode.TASK, reason="router_chain_exhausted")


# ---------------------------------------------------------------------------
# Hard guard
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HardGuardRules:
    task_keywords: tuple[str, ...] = ()
    fast_greetings: frozenset[str] = frozenset()


def _normalize_greeting(text: str) -> str:
    return _GREETING_EDGE_PATTERN.sub("", text.lower())


def _rule_list(raw: Mapping[str, object], table: str, key: str, path: Path) -> tuple[str, ...]:
    """Read ``[table] key`` as a list of strings. A missing table or key is a valid partial config."""
    section = raw.get(table)
    if section is None:
        return ()
    if isinstance(section, Mapping):
        if key not in section:
            return ()
        value = section[key]
        if isinstance(value, list) and all(isinstance(item, str) for item in value):
            return tuple(value)
    # Present but misshapen. A bare string would iterate into one rule per character.
    _LOGGER.warning("chat_route_rules_malformed path=%s rule=%s.%s; ignored", path, table, key)
    return ()


@cache
def load_hard_guard_rules(path: Path = _ROUTE_RULES_PATH) -> HardGuardRules:
    """Read the keyword rules. Empty rules on failure — the LLM stage still routes."""
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        _LOGGER.warning("chat_route_rules_unreadable path=%s; hard guard disabled", path, exc_info=True)
        return HardGuardRules()
    greetings = [_normalize_greeting(item) for item in _rule_list(raw, "fast", "greetings", path)]
    # Blank entries are dropped on both sides: "" is a substring of every message,
    # and it normalizes to "" which equals every punctuation-only one.
    return HardGuardRules(
        task_keywords=tuple(item.lower() for item in _rule_list(raw, "task", "keywords", path) if item.strip()),
        fast_greetings=frozenset(greeting for greeting in greetings if greeting),
    )


class HardGuardChatRouter:
    """Cheap keyword + attachment heuristic. Defers whenever it is not sure."""

    def __init__(self, rules: HardGuardRules | None = None) -> None:
        self._rules = rules if rules is not None else load_hard_guard_rules()

    async def decide(self, request: ChatRouteRequest) -> ChatRouteDecision | None:
        text = (request.user_prompt or "").lower()
        if not text.strip() and not request.has_attachments:
            return ChatRouteDecision(route=ChatRouteMode.FAST, reason="hard_guard:empty_prompt")

        if any(token in text for token in self._rules.task_keywords):
            return ChatRouteDecision(route=ChatRouteMode.TASK, reason="hard_guard:task_keyword")

        # Whole message, not a prefix: "hello, run tests" is a request wearing a greeting,
        # and answering it with zero tools burns the turn.
        if not request.has_attachments and _normalize_greeting(text) in self._rules.fast_greetings:
            return ChatRouteDecision(route=ChatRouteMode.FAST, reason="hard_guard:fast_greeting")

        return None


# ---------------------------------------------------------------------------
# LLM intent checker (single-round, structured output)
# ---------------------------------------------------------------------------


class LlmChatRouter:
    """One structured-output LLM call; never defers.

    ``llm_intent_check`` resolves LLM-side failures to TASK itself. An unbuildable
    payload raises out of here, and the chain is what catches that.
    """

    async def decide(self, request: ChatRouteRequest) -> ChatRouteDecision:
        output = await llm_intent_check(request.build_intent_input())
        return ChatRouteDecision(route=output.route, reason=output.reason)


def _get_intent_system_prompt() -> str:
    # Read fresh each call so prompt edits (via CHAT_PROMPTS_DIR) hot-reload.
    # read_prompt_file caches on mtime, so unchanged files are not re-read.
    from app.biz.chat.prompt import PromptFile, read_prompt_file

    return read_prompt_file(PromptFile.INTENT_CHECK)


def _strip_json_fence(text: str) -> str:
    payload = text.strip()
    match = _JSON_FENCE_PATTERN.match(payload)
    if match:
        return match.group(1).strip()
    return payload


async def llm_intent_check(payload: ChatIntentCheckerInput) -> ChatIntentCheckerOutput:
    """Single-round LLM that decides the chat route from rich context.

    Returns a defensive ``ChatIntentCheckerOutput`` with ``route=TASK`` on
    any failure so the turn still proceeds.
    """
    user_payload = {
        "user_prompt": payload.user_prompt,
        "attachment_count": len(payload.attachments),
        "attachment_names": [a.name for a in payload.attachments if getattr(a, "name", None)],
        "delegate": payload.delegate.model_dump() if payload.delegate is not None else None,
        "direct_tools": [{"name": t.name, "description": t.description} for t in payload.direct_tools],
        "workspace_attachments_section": payload.workspace_attachments_section,
        "source_manifests_section": payload.source_manifests_section,
        "workspace_knowledge_section": payload.workspace_knowledge_section,
        "prior_rerun_sources_section": payload.prior_rerun_sources_section,
        "prior_tabular_sources_section": payload.prior_tabular_sources_section,
        "prior_conversation_section": payload.prior_conversation_section,
        "skills_section": payload.skills_section,
    }
    messages = [
        {"role": "system", "content": _get_intent_system_prompt()},
        {
            "role": "user",
            "content": [{"type": "text", "text": json.dumps(user_payload, ensure_ascii=False, indent=2)}],
        },
    ]
    request = build_llm_request(
        messages,
        response_format=ChatIntentCheckerOutput,
    )
    try:
        response = await app.llmhubs.generate(request=request)
    except Exception as exc:  # noqa: BLE001
        _LOGGER.warning("chat_intent_check_llm_failed err=%s", exc)
        return ChatIntentCheckerOutput(route=ChatRouteMode.TASK, reason=f"intent_check_llm_failed: {exc}")
    if response.code != 0:
        _LOGGER.warning("chat_intent_check_llm_non_zero code=%s msg=%s", response.code, response.msg)
        return ChatIntentCheckerOutput(route=ChatRouteMode.TASK, reason=f"intent_check_llm_error: {response.msg}")

    structured = None
    if response.outputs:
        for output in response.outputs:
            if getattr(output, "json", None) is not None:
                structured = output.json
                break
    if structured is None:
        text = ""
        if response.outputs:
            text = response.outputs[0].text or ""
        text = text or response.text or ""
        if not text:
            _LOGGER.warning("chat_intent_check_llm_empty")
            return ChatIntentCheckerOutput(route=ChatRouteMode.TASK, reason="intent_check_empty_response")
        try:
            structured = json.loads(_strip_json_fence(text))
        except json.JSONDecodeError as exc:
            _LOGGER.warning("chat_intent_check_json_decode_failed err=%s preview=%s", exc, text[:200])
            return ChatIntentCheckerOutput(route=ChatRouteMode.TASK, reason="intent_check_json_decode_failed")

    try:
        return ChatIntentCheckerOutput.model_validate(structured)
    except pydantic.ValidationError as exc:
        _LOGGER.warning("chat_intent_check_validation_failed err=%s", exc)
        return ChatIntentCheckerOutput(route=ChatRouteMode.TASK, reason="intent_check_validation_failed")


_DEFAULT_ROUTER = ChatRouterChain((HardGuardChatRouter(), LlmChatRouter()))


def default_chat_router() -> ChatRouterChain:
    return _DEFAULT_ROUTER


__all__ = [
    "ChatRouteRequest",
    "ChatRouter",
    "ChatRouterChain",
    "HardGuardChatRouter",
    "HardGuardRules",
    "LlmChatRouter",
    "default_chat_router",
    "llm_intent_check",
    "load_hard_guard_rules",
]
