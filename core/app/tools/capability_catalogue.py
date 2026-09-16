"""Search and describe caller-visible task-runtime capabilities."""

from __future__ import annotations

from typing import Any, Literal

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.biz.chat.preparation.catalogue import CapabilityRetriever
from app.biz.task_runtime.planning import normalize_capability_selector
from app.tools.common import ToolContext, get_tool_context

CAPABILITY_CATALOGUE_TOOL_NAME = "capability_catalogue"
_DEFAULT_LIMIT = 20
_MAX_LIMIT = 50
_MAX_SELECTORS = 20


class CapabilityCatalogueInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["search", "describe"] = Field(
        description=("Use 'search' for compact ranked metadata or 'describe' to load full schemas for known selectors.")
    )
    query: str = Field(
        default="",
        max_length=500,
        description=(
            "Short natural-language keywords describing the desired operation, such as 'run shell command'. "
            "This is ranked keyword search, not regex: words are optional signals, so prefer distinctive verbs "
            "and nouns rather than a long sentence. Omit to browse within providers/selectors."
        ),
    )
    selectors: list[str] = Field(
        default_factory=list,
        max_length=_MAX_SELECTORS,
        description=(
            "Hard filters using exact capability IDs or terminal :** subtrees, for example "
            "'linux_workstation:shell:**'. Required for describe."
        ),
    )
    providers: list[str] = Field(
        default_factory=list,
        max_length=20,
        description="Optional exact provider namespace filters, such as 'linux_workstation' or 'skill'.",
    )
    limit: int = Field(
        default=_DEFAULT_LIMIT,
        ge=1,
        le=_MAX_LIMIT,
        description=f"Maximum ranked results to return ({_DEFAULT_LIMIT} default, {_MAX_LIMIT} maximum).",
    )

    @model_validator(mode="after")
    def describe_requires_selectors(self) -> "CapabilityCatalogueInput":
        if self.action == "describe" and not self.selectors:
            raise ValueError("describe requires at least one exact or subtree selector")
        return self


def build_capability_catalogue_tool(retriever: CapabilityRetriever) -> FunctionTool:
    async def _func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
        context = get_tool_context(invocation_ctx)
        if context is None:
            return {"error_message": "missing tool context", "capabilities": []}
        try:
            request = CapabilityCatalogueInput(**kwargs)
            return await search_capability_catalogue(retriever, context, request)
        except ValueError as exc:
            return {"error_message": str(exc), "capabilities": []}

    return FunctionTool(
        name=CAPABILITY_CATALOGUE_TOOL_NAME,
        description=(
            "Progressive capability discovery over the current caller's authorized catalogue. The main prompt "
            "already contains a compact namespace/skill index, so do not call this ritualistically. Use "
            "action='search' only when that index has no clear match or the user asks what is available; query is "
            "ranked natural-language keyword search, not regex. Use action='describe' with exact IDs or terminal "
            ":** subtree selectors to retrieve full parameter schemas for shortlisted capabilities. Search does "
            "not grant authority and this tool does not execute work; delegate performs validated durable execution."
        ),
        input_model=CapabilityCatalogueInput,
        additional_properties={"max_output_length": 30_000},
        func=_func,
    )


async def search_capability_catalogue(
    retriever: CapabilityRetriever,
    context: ToolContext,
    request: CapabilityCatalogueInput,
) -> dict[str, Any]:
    selectors = tuple(dict.fromkeys(normalize_capability_selector(value) for value in request.selectors))
    providers = tuple(dict.fromkeys(value.strip() for value in request.providers if value.strip()))
    descriptors = await retriever.retrieve(
        context,
        providers=providers,
        selectors=selectors,
        search=request.query.strip(),
        limit=request.limit,
    )
    describe = request.action == "describe"
    return {
        "error_message": "",
        "action": request.action,
        "query_semantics": "ranked_keywords_not_regex" if request.action == "search" else "selector_filter",
        "capabilities": [_descriptor_payload(descriptor, describe=describe) for descriptor in descriptors],
        "count": len(descriptors),
        "limit": request.limit,
    }


def _descriptor_payload(descriptor, *, describe: bool) -> dict[str, Any]:
    parts = descriptor.capability_id.split(":")
    payload: dict[str, Any] = {
        "capability_id": descriptor.capability_id,
        "namespace": ":".join(parts[:-1]),
        "name": parts[-1],
        "description": descriptor.description,
        "when_to_use": descriptor.when_to_use,
        "effect": descriptor.effect,
        "workspace_access": descriptor.workspace_access,
        "required_sandbox": list(descriptor.required_sandbox),
    }
    if describe:
        payload["parameter_schema"] = dict(descriptor.parameter_schema)
    return payload
