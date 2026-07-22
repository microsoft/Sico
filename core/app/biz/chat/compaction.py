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

"""Context-window compaction for the chat agent.

Configures an ``agent_framework`` compaction strategy on the chat client so
that accumulated tool-call history does not exceed the model's context limit.
"""

from __future__ import annotations

import logging
import os

from agent_framework import BaseChatClient, Message
from agent_framework._compaction import (
    EXCLUDED_KEY,
    GROUP_ANNOTATION_KEY,
    GROUP_ID_KEY,
    GROUP_KIND_KEY,
    CharacterEstimatorTokenizer,
    SlidingWindowStrategy,
    SummarizationStrategy,
    TokenBudgetComposedStrategy,
    ToolResultCompactionStrategy,
    annotate_message_groups,
    included_token_count,
    set_excluded,
)

from app.biz.chat.prompt import PromptFile, read_prompt_file
from app.llmhubs import get_client, get_context_length

_LOGGER = logging.getLogger(__name__)

# Default token budget when no context_length is configured for the model.
DEFAULT_CONTEXT_LENGTH = 128_000

# Fraction of the context window reserved for non-history content (system
# prompt, tool definitions, output tokens, etc.).  The compaction budget is
# set to ``context_length * (1 - CONTEXT_BUDGET_HEADROOM_RATIO)``.
CONTEXT_BUDGET_HEADROOM_RATIO = 0.2

# Number of most-recent tool-call groups kept verbatim (older ones are
# collapsed into one-line summaries).
COMPACTION_KEEP_TOOL_GROUPS = 30

# Number of most-recent non-system message groups kept by the sliding window
# fallback.
COMPACTION_KEEP_LAST_GROUPS = 15

# SummarizationStrategy parameters: trigger when included non-system messages
# exceed ``target_count + threshold``; after summarization, retain the newest
# ``target_count`` messages.
SUMMARIZATION_TARGET_COUNT = 30
SUMMARIZATION_THRESHOLD = 30

def _get_group_attr(message: Message, key: str) -> str | None:
    """Read a group annotation attribute from a message using public constants."""
    annotation = message.additional_properties.get(GROUP_ANNOTATION_KEY)
    if not isinstance(annotation, dict):
        return None
    value = annotation.get(key)
    return value if isinstance(value, str) else None


class SafeCompactionStrategy:
    """Token-budget compaction that guarantees the last user message survives.

    Wraps a ``TokenBudgetComposedStrategy`` and, after it runs, re-includes the
    last user message group so the LLM always receives at least one input.
    """

    def __init__(
        self,
        *,
        token_budget: int,
        tokenizer: CharacterEstimatorTokenizer,
        summary_client: BaseChatClient | None = None,
    ) -> None:
        self._tokenizer = tokenizer
        strategies: list = []
        if COMPACTION_KEEP_TOOL_GROUPS > 0:
            strategies.append(ToolResultCompactionStrategy(keep_last_tool_call_groups=COMPACTION_KEEP_TOOL_GROUPS))
        if summary_client is not None:
            summarization_prompt = read_prompt_file(
                PromptFile.COMPACTION_SUMMARIZATION,
                fallback="Summarize the conversation so far, preserving all tool call details.\n",
            )
            strategies.append(
                SummarizationStrategy(
                    client=summary_client,
                    target_count=SUMMARIZATION_TARGET_COUNT,
                    threshold=SUMMARIZATION_THRESHOLD,
                    prompt=summarization_prompt,
                )
            )
        if COMPACTION_KEEP_LAST_GROUPS > 0:
            strategies.append(SlidingWindowStrategy(keep_last_groups=COMPACTION_KEEP_LAST_GROUPS))
        self._inner = TokenBudgetComposedStrategy(
            token_budget=token_budget,
            tokenizer=tokenizer,
            strategies=strategies,
            early_stop=True,
        )

    async def __call__(self, messages: list[Message]) -> bool:
        token_budget = self._inner.token_budget
        tokens_before = included_token_count(messages)
        changed = await self._inner(messages)
        if not changed:
            _LOGGER.info(
                "chat_compaction_skipped messages_len=%d tokens_used=%d token_budget=%d headroom=%d",
                len(messages),
                tokens_before,
                token_budget,
                token_budget - tokens_before,
            )
            return False
        self._preserve_last_user_group(messages)
        tokens_after = included_token_count(messages)
        _LOGGER.info(
            "chat_compaction_applied messages_len=%d tokens_before=%d tokens_after=%d "
            "token_budget=%d headroom=%d",
            len(messages),
            tokens_before,
            tokens_after,
            token_budget,
            token_budget - tokens_after,
        )
        return changed

    @staticmethod
    def _preserve_last_user_group(messages: list[Message]) -> None:
        """Re-include every message in the last user group if compaction excluded it."""
        annotate_message_groups(messages)

        # Walk backwards to find the last user group id.
        last_user_group_id: str | None = None
        for msg in reversed(messages):
            if _get_group_attr(msg, GROUP_KIND_KEY) == "user":
                last_user_group_id = _get_group_attr(msg, GROUP_ID_KEY)
                break
        if last_user_group_id is None:
            return

        # Re-include all messages belonging to that group.
        for msg in messages:
            if _get_group_attr(msg, GROUP_ID_KEY) != last_user_group_id:
                continue
            if msg.additional_properties.get(EXCLUDED_KEY, False):
                set_excluded(msg, excluded=False, reason="preserve_last_user")


def configure_compaction(client: BaseChatClient, model: str | int | None) -> None:
    """Attach a compaction strategy to *client*.

    The strategy is a ``SafeCompactionStrategy`` that applies token-budget
    compaction while guaranteeing the last user message is never excluded.

    When the ``CHAT_COMPACTION_SUMMARIZATION_MODEL`` environment variable is
    set, a ``SummarizationStrategy`` is inserted between the tool-result
    compaction and the sliding-window fallback.  If the variable is unset the
    summarization layer is still enabled using the platform's default model.
    Set the variable to the literal string ``off`` to disable summarization.
    """
    context_length = get_context_length(str(model) if model is not None else None) or DEFAULT_CONTEXT_LENGTH
    token_budget = int(context_length * (1 - CONTEXT_BUDGET_HEADROOM_RATIO))

    # --- summarization client ------------------------------------------------
    summary_model_env = os.getenv("CHAT_COMPACTION_SUMMARIZATION_MODEL")
    summary_client: BaseChatClient | None = None
    if summary_model_env is not None and summary_model_env.strip().lower() == "off":
        _LOGGER.info("chat_compaction_summarization_disabled reason=env_off")
    else:
        summary_model = summary_model_env.strip() if summary_model_env else None
        try:
            summary_client = get_client(summary_model)
        except Exception:
            _LOGGER.warning(
                "chat_compaction_summarization_client_failed model=%r; summarization disabled",
                summary_model,
                exc_info=True,
            )

    tokenizer = CharacterEstimatorTokenizer()
    client.tokenizer = tokenizer
    client.compaction_strategy = SafeCompactionStrategy(
        token_budget=token_budget,
        tokenizer=tokenizer,
        summary_client=summary_client,
    )
    _LOGGER.info(
        "chat_compaction_configured context_length=%d token_budget=%d summarization=%s",
        context_length,
        token_budget,
        "enabled" if summary_client is not None else "disabled",
    )
