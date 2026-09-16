from __future__ import annotations

from app.auth import _is_valid_bearer, is_valid_sandbox_service_token


def test_is_valid_bearer_accepts_matching_token():
    assert _is_valid_bearer("Bearer service-token", "service-token")


def test_is_valid_bearer_rejects_malformed_credentials():
    assert not _is_valid_bearer("Bearer short", "service-token")
    assert not _is_valid_bearer("Bearer sérvice-token", "service-token")


def test_sandbox_service_token_format():
    assert is_valid_sandbox_service_token("a" * 64)
    assert not is_valid_sandbox_service_token("a" * 63)
    assert not is_valid_sandbox_service_token("A" * 64)
    assert not is_valid_sandbox_service_token("g" * 64)
