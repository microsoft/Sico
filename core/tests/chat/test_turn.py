import asyncio
from types import SimpleNamespace

import pytest

from agent_framework import ChatResponseUpdate, Content

from app.biz.chat.turn import (
    ChatResponsePresenter,
    ChatResponsePublisher,
    ChatTurnExecutor,
    ChatTurnLifecycle,
    ChatTurnLifecycleConfig,
    PreparedChatTurn,
)
from app.biz.chat.types import ChatRouteMode
from app.biz.chat.turn_timing import TurnTimings
from agent_framework import Message
from app.pb.conversation.chat import ChatContent, ChatContentType, ChatResponse


@pytest.mark.asyncio
async def test_response_publisher_sequences_updates_and_persists_only_first_plan() -> None:
    published = []

    async def publish_response(sequence_id: int, response: ChatResponse, persist: bool) -> None:
        published.append((sequence_id, response.content.content, persist))

    publisher = ChatResponsePublisher(publish_response)

    await publisher.publish(ChatResponse(content=ChatContent(type=ChatContentType.PLAN, content="first")))
    await publisher.publish(ChatResponse(content=ChatContent(type=ChatContentType.PLAN, content="second")))
    await publisher.publish(ChatResponse(content=ChatContent(type=ChatContentType.TEXT, content="done")))

    assert published == [
        (1, "first", True),
        (2, "second", False),
        (3, "done", True),
    ]
    assert publisher.emitted_count == 3


@pytest.mark.asyncio
async def test_response_presenter_resets_durable_text_at_capability_boundary() -> None:
    queue = asyncio.Queue()
    await queue.put(ChatResponseUpdate(role="assistant", contents=[Content.from_text("before")]))
    await queue.put(
        ChatResponse(
            content=ChatContent(type=ChatContentType.TEXT, content="before"),
            is_internal=True,
        )
    )
    await queue.put(ChatResponseUpdate(role="assistant", contents=[Content.from_text("after")]))
    await queue.put(None)
    published = []

    async def publish(response: ChatResponse) -> None:
        published.append(response)

    await ChatResponsePresenter(conversation_id=44, turn_id=2).drain(queue, publish)

    durable_segments = [
        response.content.content
        for response in published
        if response.is_internal and response.content.type == ChatContentType.TEXT
    ]
    assert durable_segments == ["before", "after"]
    assert published[-1].is_final
    assert published[-1].content.type == ChatContentType.END


@pytest.mark.asyncio
async def test_turn_lifecycle_registers_cleans_up_and_cancels_keepalive() -> None:
    class _Redis:
        def __init__(self) -> None:
            self.set_calls = []
            self.deleted = []

        async def set(self, key, value, *, ex):
            self.set_calls.append((key, value, ex))

        async def delete(self, key):
            self.deleted.append(key)

    redis = _Redis()
    callbacks = []
    keepalive_cancelled = asyncio.Event()
    timing_logs = []

    async def keepalive() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            keepalive_cancelled.set()
            raise

    async def add() -> None:
        callbacks.append("add")

    async def remove() -> None:
        callbacks.append("remove")

    timings = SimpleNamespace(
        started_at=0.0,
        stages={},
        log=lambda **kwargs: timing_logs.append(kwargs),
    )
    lifecycle = ChatTurnLifecycle(
        config=ChatTurnLifecycleConfig(
            turn_id_cache_key="turn-key",
            responses_cache_key="responses-key",
            turn_id=9,
            conversation_id=7,
            cache_ttl=30,
        ),
        redis_client=redis,
        timings=timings,
        send_keepalive=keepalive,
        add_ongoing_conversation=add,
        remove_ongoing_conversation=remove,
    )

    await lifecycle.start()
    await asyncio.sleep(0)
    lifecycle.set_route(ChatRouteMode.FAST)
    await lifecycle.close()
    await asyncio.sleep(0)

    assert redis.set_calls == [("turn-key", 9, 30)]
    assert redis.deleted == ["turn-key", "responses-key"]
    assert callbacks == ["add", "remove"]
    assert timing_logs[0]["route"] == ChatRouteMode.FAST
    assert keepalive_cancelled.is_set()


@pytest.mark.asyncio
async def test_turn_executor_submits_prepared_agent_and_drains_responses() -> None:
    class _Agent:
        async def run_stream(self, queue, user_message, system_message, *, options) -> None:
            assert user_message.text == "hello"
            assert system_message == "system"
            assert options.turn_id == 9
            assert options.save_history
            assert options.save_memory
            assert options.tools == ("tool",)
            await queue.put(ChatResponseUpdate(role="assistant", contents=[Content.from_text("done")]))
            await queue.put(None)

    class _Runner:
        async def submit(self, func, **kwargs) -> None:
            await func(**kwargs)

    published = []

    async def publish_response(sequence_id: int, response: ChatResponse, persist: bool) -> None:
        published.append((sequence_id, response, persist))

    timings = TurnTimings()
    queue = asyncio.Queue()
    prepared = PreparedChatTurn(
        route=ChatRouteMode.TASK,
        agent=_Agent(),
        user_message=Message(role="user", contents=[Content.from_text("hello")]),
        system_message="system",
        tools=("tool",),
    )

    await ChatTurnExecutor(runner=_Runner(), timings=timings).execute(
        prepared=prepared,
        turn_id=9,
        response_queue=queue,
        presenter=ChatResponsePresenter(conversation_id=7, turn_id=9),
        publisher=ChatResponsePublisher(publish_response),
    )

    assert [item[1].content.type for item in published] == [
        ChatContentType.TEXT,
        ChatContentType.TEXT,
        ChatContentType.END,
    ]
    assert published[0][1].content.content == "done"
    assert published[1][1].content.content == "done"
    assert published[1][1].is_internal
    assert published[2][1].is_final
    assert "stream_submit_ms" in timings.stages
    assert "response_drain_ms" in timings.stages
