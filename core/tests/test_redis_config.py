from app.utils.redis_config import redis_url_from_environment


def test_redis_connection_takes_precedence(monkeypatch) -> None:
    monkeypatch.setenv("REDIS_CONNECTION", "rediss://user:token@redis:10000/0")
    monkeypatch.setenv("REDIS_HOST", "ignored")

    assert redis_url_from_environment() == "rediss://user:token@redis:10000/0"


def test_split_redis_configuration_with_password(monkeypatch) -> None:
    monkeypatch.delenv("REDIS_CONNECTION", raising=False)
    monkeypatch.setenv("REDIS_HOST", "redis")
    monkeypatch.setenv("REDIS_PORT", "6380")
    monkeypatch.setenv("REDIS_PASSWORD", "secret")

    assert redis_url_from_environment() == "redis://:secret@redis:6380"


def test_split_redis_configuration_without_password(monkeypatch) -> None:
    monkeypatch.delenv("REDIS_CONNECTION", raising=False)
    monkeypatch.setenv("REDIS_HOST", "redis")
    monkeypatch.setenv("REDIS_PORT", "6379")
    monkeypatch.delenv("REDIS_PASSWORD", raising=False)

    assert redis_url_from_environment() == "redis://redis:6379"
