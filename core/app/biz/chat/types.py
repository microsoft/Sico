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

"""Shared types for chat routing, intent checking, and adapter-based task building.

* ``ChatRouteMode`` - coarse routing buckets the chat service picks between.
* ``ChatRouteHardGuardDecision`` - output of cheap keyword-based hard guards.
* ``ChatIntentCheckerInput`` / ``ChatIntentCheckerOutput`` - single-round LLM
  router payloads (structured output via ``response_format``).
* ``Adapter`` - extension point for converting ``AdapterInput`` into one or
  more :class:`TaskSpec` for the TASK route. Adapters are exposed to the chat
  agent through a single ``delegate`` function tool whose ``kind`` argument
  selects the adapter; the call both builds and executes the resulting task
  batch in one shot.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import StrEnum
from typing import TYPE_CHECKING, Any

import agent_framework
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common.common import Attachment

from app.biz.task_runtime.models import BatchResult, PreparedTaskBatch
from app.tools.common import ToolContext

if TYPE_CHECKING:
    from app.biz.task_runtime.manager import TaskManager


class ChatRouteMode(StrEnum):
    UNSPECIFIED = "unspecified"
    FAST = "fast"
    INSPECT = "inspect"
    TASK = "task"


class ChatRouteHardGuardDecision(BaseModel):
    route: ChatRouteMode = Field(
        default=ChatRouteMode.UNSPECIFIED,
        description="Decided chat route mode. ``unspecified`` means the guard could not decide.",
    )
    reason: str = Field(default="", description="Why the hard guard fired (keyword, attachment, etc.).")


class ToolExcerpt(BaseModel):
    name: str = Field(..., description="The name of the tool.")
    description: str = Field(..., description="The description of the tool.")

    @staticmethod
    def from_agent_framework_function_tool(tool: agent_framework.FunctionTool) -> "ToolExcerpt":
        return ToolExcerpt(name=tool.name, description=tool.description)


class AdapterInput(BaseModel):
    options_json: str = Field(
        default="",
        description=(
            "JSON-encoded object of options for the adapter input. "
            "Use a JSON string (not a nested object) so the schema stays compatible "
            "with strict structured-output mode. Empty string means no options."
        ),
    )


class Adapter(ABC):
    """Convert an :class:`AdapterInput` into prepared tasks for the runtime to execute.

    Implementations are registered in ``app.biz.chat.adapters`` and surfaced to
    the TASK-route chat agent through the single ``delegate`` function tool
    (selected by its ``kind`` argument) via
    :func:`app.tools.delegate.build_adapter_tools`.
    """

    name: str = ""
    description: str = ""

    @abstractmethod
    async def build_tasks(self, context: ToolContext, adapter_input: AdapterInput) -> PreparedTaskBatch:
        """Build one or more TaskSpecs for the runtime to execute."""

    async def process_results(
        self,
        batch_result: BatchResult,
        prepared: PreparedTaskBatch,
        manager: "TaskManager",
    ) -> dict[str, Any]:
        """Convert a :class:`BatchResult` into the tool-response dict.

        The default implementation delegates to
        :meth:`TaskManager.build_tool_payload`, which folds single-task batches
        and omits excess successful results.  Subclasses may override to
        customise the payload shape or attach additional information.
        """
        return await manager.build_tool_payload(batch_result)


class AdapterExcerpt(BaseModel):
    name: str = Field(..., description="The name of the adapter.")
    description: str = Field(..., description="The description of the adapter.")

    @staticmethod
    def from_adapter(adapter: Adapter) -> "AdapterExcerpt":
        return AdapterExcerpt(name=adapter.name, description=adapter.description)


class ChatIntentCheckerInput(BaseModel):
    """Inputs to the single-round LLM that decides the chat route.

    The ``*_section`` fields carry rendered context (workspace attachments,
    prior rerun sources, prior parsed workbook sources, etc.). The same strings
    are forwarded to the downstream chat agent so context is preserved across
    the routing step.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    user_prompt: str = Field(..., description="The original user prompt.")
    attachments: list[Attachment] = Field(
        default_factory=list,
        description="Attachments included in the user message.",
    )
    adapters: list[AdapterExcerpt] = Field(
        default_factory=list,
        description="Available adapters that may be used for TASK route building.",
    )
    direct_tools: list[ToolExcerpt] = Field(
        default_factory=list,
        description="Available direct tools that may be used in the conversation.",
    )

    is_force_fast: bool = Field(
        default=False,
        description=(
            "Deprecated compatibility field. Hard-guard FAST decisions bypass "
            "the LLM intent check and run the fast-route agent directly."
        ),
    )

    # Pre-rendered context sections for the router prompt; skills_section is
    # also appended to the chat agent system prompt.
    workspace_attachments_section: str = Field(default="")
    workspace_knowledge_section: str = Field(default="")
    prior_rerun_sources_section: str = Field(default="")
    prior_parsed_workbook_sources_section: str = Field(default="")
    prior_conversation_section: str = Field(default="")
    skills_section: str = Field(default="")


class ChatIntentCheckerOutput(BaseModel):
    route: ChatRouteMode = Field(..., description="The decided chat route mode.")
    confidence: float = Field(..., description="Confidence score, between 0 and 1.")
    reason: str = Field(..., description="The reason for the decision.")

    fast_response: str = Field(
        default="",
        description="Deprecated compatibility field. Fast routes run the chat agent instead of short-circuiting.",
    )
    capabilities: list[str] = Field(default_factory=list, description="Capabilities that should be used.")
    adapters: list[str] = Field(default_factory=list, description="Adapters that should be used.")
    direct_tools: list[str] = Field(default_factory=list, description="Direct tools that should be used.")


__all__ = [
    "Adapter",
    "AdapterExcerpt",
    "AdapterInput",
    "Any",
    "ChatIntentCheckerInput",
    "ChatIntentCheckerOutput",
    "ChatRouteHardGuardDecision",
    "ChatRouteMode",
    "ToolExcerpt",
]
