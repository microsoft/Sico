"""One test per scenario, so a failure names the behaviour that broke."""

from __future__ import annotations

import pytest

from .client import ChatClient
from .runner import run_scenario
from .scenarios import SCENARIOS, Scenario

pytestmark = pytest.mark.e2e


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[scenario.name for scenario in SCENARIOS])
def test_chat_scenario(chat_client: ChatClient, agent_instance_ids: dict[str, int], scenario: Scenario) -> None:
    agent_instance_id = agent_instance_ids.get(scenario.agent_role)
    if agent_instance_id is None:
        pytest.skip(f"the stack has no seeded {scenario.agent_role!r} agent")
    findings = run_scenario(chat_client, scenario, agent_instance_id)
    assert not findings, "\n" + "\n".join(f"- {finding}" for finding in findings)
