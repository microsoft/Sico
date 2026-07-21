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

import pytest
from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext

from app.biz.chat.chat import _Mem0MemoryTask, _store_memories
from app.memory.mem0 import (
    _redact_config_for_log,
    build_memory_filters,
)
from app.tools.common import _TOOL_CONTEXT_KWARGS_KEY, ToolContext
from app.tools.plan import PlanEditor
from app.tools.search_memory import _search_memory_func


class _FakePlanEditor(PlanEditor):
    def __init__(self):
        super().__init__(agent_instance_id=123, username="alice@example.com", turn_id=456)
        self.messages: dict[int, str] = {}

    async def create_tool_call(self, name, initial_message, execution_info=None):
        self.tool_call_id += 1
        self.messages[self.tool_call_id] = initial_message
        return self.tool_call_id

    async def update_tool_call_message(self, tool_call_id, message):
        self.messages[tool_call_id] = message
        return None


class _FakeMemory:
    def __init__(self, *, search_error: Exception | None = None):
        self.calls: list[dict] = []
        self.add_calls: list[dict] = []
        self.search_error = search_error

    async def search(self, **kwargs):
        if self.search_error:
            raise self.search_error
        self.calls.append(kwargs)
        return {
            "results": [
                {"memory": "shipping address is Redmond", "score": 0.8},
                {"memory": "accepted by mem0 ranking", "score": 0.4},
                {"memory": "prefers concise answers"},
            ]
        }

    async def add(self, **kwargs):
        self.add_calls.append(kwargs)


class _BlockingRunner:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.calls: list[tuple] = []

    async def submit(self, fn, *args, **kwargs):
        self.calls.append((fn, args, kwargs))
        self.started.set()
        await self.release.wait()


@pytest.mark.asyncio
async def test_search_memory_uses_mem0_filters_and_threshold(monkeypatch):
    fake_memory = _FakeMemory()
    monkeypatch.setattr("app.tools.search_memory.get_shared_mem0", lambda: fake_memory)

    plan_editor = _FakePlanEditor()
    ctx = ToolContext(
        username="alice@example.com",
        agent_id="agent-1",
        agent_instance_id=123,
        turn_id=456,
        project_id=789,
        conversation_id=1001,
        response_queue=asyncio.Queue(),
        plan_editor=plan_editor,
        all_tools=[],
    )
    dummy_tool = FunctionTool(name="search_memory", description="", func=_search_memory_func)
    invocation_ctx = FunctionInvocationContext(
        function=dummy_tool,
        arguments={"query": "where should I ship it?"},
        kwargs={_TOOL_CONTEXT_KWARGS_KEY: ctx},
    )

    result = await _search_memory_func(invocation_ctx, query="where should I ship it?")

    assert result == {"memories": ["shipping address is Redmond", "accepted by mem0 ranking", "prefers concise answers"]}
    assert fake_memory.calls == [
        {
            "query": "where should I ship it?",
            "filters": {"user_id": "alice@example.com", "agent_id": "123", "run_id": "1001"},
            "threshold": 0.5,
            "top_k": 5,
        }
    ]
    assert plan_editor.messages[1] == "Found 3 related memories."


@pytest.mark.asyncio
async def test_search_memory_returns_error_payload_on_failure(monkeypatch):
    fake_memory = _FakeMemory(search_error=RuntimeError("mem0 unavailable"))
    monkeypatch.setattr("app.tools.search_memory.get_shared_mem0", lambda: fake_memory)

    plan_editor = _FakePlanEditor()
    ctx = ToolContext(
        username="alice@example.com",
        agent_id="agent-1",
        agent_instance_id=123,
        turn_id=456,
        project_id=789,
        conversation_id=1001,
        response_queue=asyncio.Queue(),
        plan_editor=plan_editor,
        all_tools=[],
    )
    dummy_tool = FunctionTool(name="search_memory", description="", func=_search_memory_func)
    invocation_ctx = FunctionInvocationContext(
        function=dummy_tool,
        arguments={"query": "where should I ship it?"},
        kwargs={_TOOL_CONTEXT_KWARGS_KEY: ctx},
    )

    result = await _search_memory_func(invocation_ctx, query="where should I ship it?")

    assert result == {"error": "mem0 unavailable"}
    assert plan_editor.messages[1] == "Failed to search related memories."


def test_build_memory_filters_sanitizes_mem0_entity_ids():
    assert build_memory_filters(username=" Alice Smith ", agent_id=" agent 123 ", conversation_id=" conversation 42 ") == {
        "user_id": "Alice_Smith",
        "agent_id": "agent_123",
        "run_id": "conversation_42",
    }


def test_mem0_config_logging_redacts_sensitive_values():
    config = {
        "embedder": {
            "config": {
                "azure_kwargs": {
                    "api_key": "secret-key",
                    "azure_endpoint": "https://example.test",
                }
            }
        },
        "headers": [{"Authorization": "Bearer token", "x-feature": "enabled"}],
    }

    redacted = _redact_config_for_log(config)

    assert redacted["embedder"]["config"]["azure_kwargs"] == {
        "api_key": "[REDACTED]",
        "azure_endpoint": "https://example.test",
    }
    assert redacted["headers"][0] == {"Authorization": "[REDACTED]", "x-feature": "enabled"}
    assert config["embedder"]["config"]["azure_kwargs"]["api_key"] == "secret-key"


@pytest.mark.asyncio
async def test_store_memories_sanitizes_mem0_entity_ids(monkeypatch):
    fake_memory = _FakeMemory()
    monkeypatch.setattr("app.biz.chat.chat.get_shared_mem0", lambda: fake_memory)

    await _store_memories(
        _Mem0MemoryTask(
            username=" Alice Smith ",
            agent_instance_id=" agent 123 ",
            conversation_id=" conversation 42 ",
            messages=[{"role": "user", "content": "remember this"}],
        )
    )

    assert fake_memory.add_calls == [
        {
            "messages": [{"role": "user", "content": "remember this"}],
            "user_id": "Alice_Smith",
            "agent_id": "agent_123",
            "run_id": "conversation_42",
        }
    ]
