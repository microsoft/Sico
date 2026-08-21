"""Shared types for chat routing, intent checking, and task preparation.

* ``ChatRouteMode`` - the two routing buckets the chat service picks between.
* ``ChatRouteDecision`` - what any :class:`app.biz.chat.router.ChatRouter` returns.
* ``ChatIntentCheckerInput`` / ``ChatIntentCheckerOutput`` - single-round LLM
  router payloads (structured output via ``response_format``).
* ``ToolExcerpt`` - compact metadata for routing-visible tools, including the
    single multi-source ``delegate`` preparation tool.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

import agent_framework
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common.common import Attachment


class ChatRouteMode(StrEnum):
    FAST = "fast"
    TASK = "task"


class ChatRouteDecision(BaseModel):
    route: ChatRouteMode = Field(..., description="The decided chat route mode.")
    reason: str = Field(default="", description="Which rule or classifier picked this route.")


class ToolExcerpt(BaseModel):
    name: str = Field(..., description="The name of the tool.")
    description: str = Field(..., description="The description of the tool.")

    @staticmethod
    def from_agent_framework_function_tool(tool: agent_framework.FunctionTool) -> "ToolExcerpt":
        return ToolExcerpt(name=tool.name, description=tool.description)


class ChatIntentCheckerInput(BaseModel):
    """Inputs to the single-round LLM that decides the chat route.

    The ``*_section`` fields carry rendered context (workspace attachments,
    prior rerun sources, prior indexed tabular sources, etc.). The same strings
    are forwarded to the downstream chat agent so context is preserved across
    the routing step.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    user_prompt: str = Field(..., description="The original user prompt.")
    attachments: list[Attachment] = Field(
        default_factory=list,
        description="Attachments included in the user message.",
    )
    delegate: ToolExcerpt | None = Field(default=None, description="The multi-source durable preparation tool.")
    direct_tools: list[ToolExcerpt] = Field(
        default_factory=list,
        description="Available direct tools that may be used in the conversation.",
    )

    # Pre-rendered context sections for the router prompt; skills_section is
    # also appended to the chat agent system prompt.
    workspace_attachments_section: str = Field(default="")
    source_manifests_section: str = Field(default="")
    workspace_knowledge_section: str = Field(default="")
    prior_rerun_sources_section: str = Field(default="")
    prior_tabular_sources_section: str = Field(default="")
    prior_conversation_section: str = Field(default="")
    skills_section: str = Field(default="")


class ChatIntentCheckerOutput(BaseModel):
    route: ChatRouteMode = Field(..., description="The decided chat route mode.")
    reason: str = Field(..., description="The reason for the decision.")


__all__ = [
    "Any",
    "ChatIntentCheckerInput",
    "ChatIntentCheckerOutput",
    "ChatRouteDecision",
    "ChatRouteMode",
    "ToolExcerpt",
]
