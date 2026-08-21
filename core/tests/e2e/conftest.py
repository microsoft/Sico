"""Gate and fixtures for the chat acceptance suite.

These tests drive a deployed stack over HTTP: they need the services running,
real LLM credentials and the seeded demo agents. They are not part of CI. Set
``SICO_E2E_BASE_URL`` to opt in; without it every test here skips.

    SICO_E2E_BASE_URL=http://localhost:8080 uv run pytest tests/e2e

Once opted in, an unreachable or unseeded stack **fails**. Skipping there would
report a green run for an acceptance pass that never happened.
"""

from __future__ import annotations

import os

import pytest

from .client import ChatClient

BASE_URL_ENV = "SICO_E2E_BASE_URL"


@pytest.fixture(scope="session")
def chat_client() -> ChatClient:
    base_url = os.getenv(BASE_URL_ENV)
    if not base_url:
        pytest.skip(f"set {BASE_URL_ENV} to run the chat acceptance suite")
    email = os.getenv("SICO_E2E_EMAIL", "operator@sico.local")
    password = os.getenv("SICO_E2E_PASSWORD", "operator")
    try:
        return ChatClient(base_url, email, password)
    except Exception as exc:  # noqa: BLE001 - reported as a failure, with the cause.
        pytest.fail(f"cannot reach the stack at {base_url}: {exc}", pytrace=False)


@pytest.fixture(scope="session")
def agent_instance_ids(chat_client: ChatClient) -> dict[str, int]:
    """Resolve seeded agents by role, so the suite is not pinned to seeded row ids."""
    ids = chat_client.agent_instance_ids_by_role()
    if not ids:
        pytest.fail("the stack has no agent instances to drive", pytrace=False)
    return ids
