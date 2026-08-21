from unittest.mock import Mock

import pytest

from app.biz.reverse_grpc.case_replay import ReverseCaseReplayService


def test_case_replay_client_initializes_public_singleton() -> None:
    channel = Mock()

    ReverseCaseReplayService.get_instance().initialize(channel)

    assert ReverseCaseReplayService.get_instance().stub is not None


def test_case_replay_client_requires_initialization() -> None:
    with pytest.raises(RuntimeError, match="not initialized"):
        ReverseCaseReplayService().get_active_case_replay("case-1", "example.com", "windows")
