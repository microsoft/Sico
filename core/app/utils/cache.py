# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Self

from redis.asyncio import Redis

DEFAULT_LOCK_TIMEOUT = 10  # seconds

# singleton
class Cache:
    _instance: Self = None

    def __init__(self, connection: str):
        if Cache._instance is not None:
            raise Exception("This class is a singleton!")
        else:
            Cache._instance = self
            self.redis = Redis.from_url(connection)

    @staticmethod
    def get_instance() -> Self:
        return Cache._instance

    async def try_acquire_lock(self, name: str, timeout: int) -> tuple[bool, str]:
        script = """
        if redis.call("SETNX", KEYS[1], ARGV[1]) == 1 then
            -- lock acquired for the first time
            redis.call("EXPIRE", KEYS[1], ARGV[2])
            return 1
        elseif redis.call("GET", KEYS[1]) == ARGV[1] then
            -- lock already held by this owner, refresh expiration
            redis.call("EXPIRE", KEYS[1], ARGV[2])
            return 1
        else
            -- lock is held by someone else
            return 0
        end
        """
        lock_name = f"lock:{name}"
        lock_value = str(uuid.uuid4())
        result = await self.redis.eval(script, 1, lock_name, lock_value, timeout)
        return result == 1, lock_value

    async def release_lock(self, name: str, value: str) -> bool:
        script = """
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
        """
        lock_name = f"lock:{name}"
        result = await self.redis.eval(script, 1, lock_name, value)
        return result == 1

    async def acquire_lock(self, name: str, wait_interval: float = 0.1, timeout: int = DEFAULT_LOCK_TIMEOUT) -> str:
        while True:
            acquired, lock_value = await self.try_acquire_lock(name, timeout)
            if acquired:
                return lock_value
            await asyncio.sleep(wait_interval)

    @asynccontextmanager
    async def _lock(self, name: str, wait_interval: float = 0.1, timeout: int = DEFAULT_LOCK_TIMEOUT):
        """
        Context manager for acquiring and releasing locks.

        Usage:
            cache = Cache.get_instance()
            async with cache.lock("my_resource"):
                # critical section

        Args:
            name: The name of the lock
            wait_interval: Sleep interval between retries when blocking
            timeout: Time-to-live for the lock in seconds
        """
        lock_value = await self.acquire_lock(name, wait_interval, timeout)
        try:
            yield
        finally:
            await self.release_lock(name, lock_value)

    @staticmethod
    @asynccontextmanager
    async def lock(name: str, wait_interval: float = 0.1, timeout: int = DEFAULT_LOCK_TIMEOUT):
        cache = Cache.get_instance()
        async with cache._lock(name, wait_interval, timeout):
            yield
