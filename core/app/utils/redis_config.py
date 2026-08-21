from __future__ import annotations

import os


def redis_url_from_environment() -> str:
    if redis_connection := os.getenv("REDIS_CONNECTION", ""):
        return redis_connection

    redis_host = os.getenv("REDIS_HOST", "localhost")
    redis_port = os.getenv("REDIS_PORT", "6379")
    redis_password = os.getenv("REDIS_PASSWORD", "")
    if redis_password:
        return f"redis://:{redis_password}@{redis_host}:{redis_port}"
    return f"redis://{redis_host}:{redis_port}"
