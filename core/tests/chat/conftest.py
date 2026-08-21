import pytest


class FakeRedis:
    def __init__(self):
        self.store = {}

    async def set(self, name, value, *args, **kwargs):
        self.store[name] = value

    async def get(self, name, *args, **kwargs):
        return self.store.get(name, None)

    async def delete(self, name, *args, **kwargs):
        if name in self.store:
            del self.store[name]

    async def rpush(self, name, value, *args, **kwargs):
        if name not in self.store:
            self.store[name] = []
        self.store[name].append(value)

    async def expire(self, name, time_seconds, *args, **kwargs):
        pass

    async def zadd(self, name, mapping, *args, **kwargs):
        if name not in self.store:
            self.store[name] = {}
        self.store[name].update(mapping)

    async def zrem(self, name, *values, **kwargs):
        if name not in self.store:
            return
        for value in values:
            self.store[name].pop(value, None)


@pytest.fixture()
def fake_redis() -> FakeRedis:
    return FakeRedis()
