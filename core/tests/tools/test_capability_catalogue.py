from __future__ import annotations

import pytest

from app.biz.chat.preparation import CapabilityRetriever, WorkspaceCapabilityCatalogue
from app.tools.capability_catalogue import CapabilityCatalogueInput, search_capability_catalogue
from app.tools.common import ToolContext


@pytest.mark.asyncio
async def test_search_returns_compact_authorized_capability_metadata() -> None:
    context = ToolContext.model_construct(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        project_id=9,
        conversation_id=1,
        turn_id=2,
        skill_loader=None,
        assigned_sandbox_types=frozenset({"linux_workstation"}),
    )

    result = await search_capability_catalogue(
        CapabilityRetriever(WorkspaceCapabilityCatalogue()),
        context,
        CapabilityCatalogueInput(
            action="search",
            query="browser",
            providers=["linux_workstation"],
        ),
    )

    assert result["count"] == 2
    assert {item["capability_id"] for item in result["capabilities"]} == {
        "linux_workstation:browser:open_url",
        "linux_workstation:browser:screenshot",
    }
    assert all("parameter_schema" not in item for item in result["capabilities"])


@pytest.mark.asyncio
async def test_search_tokenizes_and_ranks_natural_language_queries() -> None:
    context = ToolContext.model_construct(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        project_id=9,
        conversation_id=1,
        turn_id=2,
        skill_loader=None,
        assigned_sandbox_types=frozenset({"linux_workstation"}),
    )

    result = await search_capability_catalogue(
        CapabilityRetriever(WorkspaceCapabilityCatalogue()),
        context,
        CapabilityCatalogueInput(
            action="search",
            query="linux sandbox shell run command execute bash",
            limit=10,
        ),
    )

    assert result["count"] > 0
    assert result["capabilities"][0]["capability_id"] == "linux_workstation:shell:exec"
    assert result["query_semantics"] == "ranked_keywords_not_regex"


@pytest.mark.asyncio
async def test_search_treats_regex_punctuation_as_token_boundaries() -> None:
    context = ToolContext.model_construct(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        project_id=9,
        conversation_id=1,
        turn_id=2,
        skill_loader=None,
        assigned_sandbox_types=frozenset({"linux_workstation"}),
    )

    result = await search_capability_catalogue(
        CapabilityRetriever(WorkspaceCapabilityCatalogue()),
        context,
        CapabilityCatalogueInput(action="search", query="shell.*exec", limit=5),
    )

    assert result["capabilities"][0]["capability_id"] == "linux_workstation:shell:exec"


@pytest.mark.asyncio
async def test_describe_returns_schemas_only_inside_requested_subtree() -> None:
    context = ToolContext.model_construct(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        project_id=9,
        conversation_id=1,
        turn_id=2,
        skill_loader=None,
        assigned_sandbox_types=frozenset({"linux_workstation"}),
    )

    result = await search_capability_catalogue(
        CapabilityRetriever(WorkspaceCapabilityCatalogue()),
        context,
        CapabilityCatalogueInput(action="describe", selectors=["linux_workstation:file:**"]),
    )

    assert result["count"] == 4
    assert all(item["namespace"] == "linux_workstation:file" for item in result["capabilities"])
    assert all("parameter_schema" in item for item in result["capabilities"])
