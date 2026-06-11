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

"""Chat route selection.

Two-stage routing:

1. :func:`hard_guard_route` — cheap keyword-based decision. Returns ``UNSPECIFIED``
   if no rule fires.
2. :func:`llm_intent_check` — single-round LLM with structured output
   (:class:`ChatIntentCheckerOutput`) that decides the route from the available
   capabilities / adapters / direct tools and pre-rendered context sections.

The TASK route then runs the regular chat agent with the full read+write+plan
tool set augmented by the single ``delegate`` adapter tool (see
:func:`app.tools.delegate.build_adapter_tools`).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import pydantic

import app.llmhubs
from app.biz.chat.types import (
    ChatIntentCheckerInput,
    ChatIntentCheckerOutput,
    ChatRouteHardGuardDecision,
    ChatRouteMode,
)
from app.llmhubs.request_builder import build_llm_request
from app.tools import (
    CONTEXT_TOOL,
    GREP_TOOL,
    GET_TASK_DETAIL_TOOL,
    PLAN_READ_TOOL,
    PLAN_TOOL_CALL_MESSAGE_UPDATE_TOOL,
    PLAN_WRITE_TOOL,
    READ_TOOL,
    REMOVE_TOOL,
    REPORT_TOOL,
    WRITE_FILE_TOOL,
    EDIT_TOOL,
    WEBFETCH_TOOL,
    CURL_TOOL,
    SEARCH_MEMORY_TOOL,
    PARSE_DOCUMENT_TOOL,
    DOWNLOAD_TOOL,
)

_LOGGER = logging.getLogger(__name__)

_JSON_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.IGNORECASE | re.DOTALL)


# ---------------------------------------------------------------------------
# Route → tool list
# ---------------------------------------------------------------------------


_INSPECT_TOOLS: tuple[Any, ...] = (
    CONTEXT_TOOL,
    READ_TOOL,
    GREP_TOOL,
    PLAN_READ_TOOL,
    PLAN_WRITE_TOOL,
    PLAN_TOOL_CALL_MESSAGE_UPDATE_TOOL,
    SEARCH_MEMORY_TOOL,
    WEBFETCH_TOOL,
    PARSE_DOCUMENT_TOOL,
    REPORT_TOOL,
    GET_TASK_DETAIL_TOOL,
)

# TASK: read + write + plan + report. ``run_command`` is intentionally excluded;
# "real work" should go through the ``delegate`` tool wired in by the
# service layer alongside this tool set.
_TASK_TOOLS: tuple[Any, ...] = (
    CONTEXT_TOOL,
    READ_TOOL,
    GREP_TOOL,
    WRITE_FILE_TOOL,
    EDIT_TOOL,
    REMOVE_TOOL,
    REPORT_TOOL,
    PLAN_READ_TOOL,
    PLAN_WRITE_TOOL,
    PLAN_TOOL_CALL_MESSAGE_UPDATE_TOOL,
    WEBFETCH_TOOL,
    CURL_TOOL,
    SEARCH_MEMORY_TOOL,
    PARSE_DOCUMENT_TOOL,
    DOWNLOAD_TOOL,
    GET_TASK_DETAIL_TOOL,
)

_TOOLS_BY_ROUTE: dict[ChatRouteMode, tuple[Any, ...]] = {
    ChatRouteMode.FAST: (),
    ChatRouteMode.INSPECT: _INSPECT_TOOLS,
    ChatRouteMode.TASK: _TASK_TOOLS,
}


def tools_for_route(route: ChatRouteMode) -> list[Any]:
    """Return a fresh list of tool instances to expose to the chat agent for ``route``."""
    return list(_TOOLS_BY_ROUTE.get(route, _TASK_TOOLS))


# ---------------------------------------------------------------------------
# Hard guard
# ---------------------------------------------------------------------------


_FAST_KEYWORDS = (
    "hello",
    "hi ",
    "hey",
    "thanks",
    "thank you",
    "你好",
    "谢谢",
)

_TASK_KEYWORDS = (
    "execute",
    "run all",
    "batch",
    "批量",
    "重跑",
    "重新执行",
    "execute the workbook",
    "run the cases",
)


def hard_guard_route(user_prompt: str, *, has_attachments: bool) -> ChatRouteHardGuardDecision:
    """Cheap keyword + attachment heuristic. Returns UNSPECIFIED when unsure."""
    text = (user_prompt or "").lower()
    if not text.strip() and not has_attachments:
        return ChatRouteHardGuardDecision(route=ChatRouteMode.FAST, reason="empty_prompt")

    if any(token in text for token in _TASK_KEYWORDS):
        return ChatRouteHardGuardDecision(route=ChatRouteMode.TASK, reason="task_keyword")

    if not has_attachments and len(text) <= 24 and any(text.startswith(kw) for kw in _FAST_KEYWORDS):
        return ChatRouteHardGuardDecision(route=ChatRouteMode.FAST, reason="fast_greeting")

    return ChatRouteHardGuardDecision(route=ChatRouteMode.UNSPECIFIED, reason="")


# ---------------------------------------------------------------------------
# LLM intent checker (single-round, structured output)
# ---------------------------------------------------------------------------


_INTENT_SYSTEM_PROMPT: str | None = None


def _get_intent_system_prompt() -> str:
    global _INTENT_SYSTEM_PROMPT  # noqa: PLW0603
    if _INTENT_SYSTEM_PROMPT is None:
        from app.biz.chat.prompt import PromptFile, read_prompt_file

        _INTENT_SYSTEM_PROMPT = read_prompt_file(PromptFile.INTENT_CHECK)
    return _INTENT_SYSTEM_PROMPT


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
        "adapters": [{"name": a.name, "description": a.description} for a in payload.adapters],
        "direct_tools": [{"name": t.name, "description": t.description} for t in payload.direct_tools],
        "workspace_attachments_section": payload.workspace_attachments_section,
        "workspace_knowledge_section": payload.workspace_knowledge_section,
        "prior_rerun_sources_section": payload.prior_rerun_sources_section,
        "prior_parsed_workbook_sources_section": payload.prior_parsed_workbook_sources_section,
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
        return ChatIntentCheckerOutput(
            route=ChatRouteMode.TASK,
            confidence=0.0,
            reason=f"intent_check_llm_failed: {exc}",
        )
    if response.code != 0:
        _LOGGER.warning("chat_intent_check_llm_non_zero code=%s msg=%s", response.code, response.msg)
        return ChatIntentCheckerOutput(
            route=ChatRouteMode.TASK,
            confidence=0.0,
            reason=f"intent_check_llm_error: {response.msg}",
        )

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
            return ChatIntentCheckerOutput(
                route=ChatRouteMode.TASK,
                confidence=0.0,
                reason="intent_check_empty_response",
            )
        try:
            structured = json.loads(_strip_json_fence(text))
        except json.JSONDecodeError as exc:
            _LOGGER.warning("chat_intent_check_json_decode_failed err=%s preview=%s", exc, text[:200])
            return ChatIntentCheckerOutput(
                route=ChatRouteMode.TASK,
                confidence=0.0,
                reason="intent_check_json_decode_failed",
            )

    try:
        return ChatIntentCheckerOutput.model_validate(structured)
    except pydantic.ValidationError as exc:
        _LOGGER.warning("chat_intent_check_validation_failed err=%s", exc)
        return ChatIntentCheckerOutput(
            route=ChatRouteMode.TASK,
            confidence=0.0,
            reason="intent_check_validation_failed",
        )


__all__ = [
    "hard_guard_route",
    "llm_intent_check",
    "tools_for_route",
]
