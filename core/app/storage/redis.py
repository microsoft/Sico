from __future__ import annotations

import redis.asyncio as aioredis

_REDIS_CLIENT: aioredis.Redis | None = None


async def init_shared_redis(redis_url: str) -> None:
    if not redis_url:
        raise RuntimeError("REDIS_CONNECTION is required for chat history")
    client = aioredis.from_url(redis_url, decode_responses=True)
    try:
        await client.ping()
    except Exception as exc:
        await client.aclose()
        raise RuntimeError("Failed to connect to Redis") from exc
    global _REDIS_CLIENT
    _REDIS_CLIENT = client


def get_shared_redis() -> aioredis.Redis:
    if _REDIS_CLIENT is None:
        raise RuntimeError("Shared Redis client is not initialized")
    return _REDIS_CLIENT
