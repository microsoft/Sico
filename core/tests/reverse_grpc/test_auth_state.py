from unittest.mock import Mock

import pytest

from app.biz.reverse_grpc.auth_state import ReverseAuthStateService


def test_auth_state_client_initializes_public_singleton() -> None:
    channel = Mock()

    ReverseAuthStateService.get_instance().initialize(channel)

    assert ReverseAuthStateService.get_instance().stub is not None


def test_auth_state_client_requires_initialization() -> None:
    with pytest.raises(RuntimeError, match="not initialized"):
        ReverseAuthStateService().get_auth_state("alice@example.com", "example.com")
