"""Chat-specific turn orchestration values and response publishing."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from agent_framework import ChatResponseUpdate, Content, Message

from app.biz.chat.runtime_agent import RunOptions
from app.biz.chat.types import ChatRouteMode
from app.biz.chat.turn_timing import TurnTimings, time_awaitable
from app.pb.conversation.chat import ChatContent, ChatContentType, ChatResponse


PublishResponse = Callable[[int, ChatResponse, bool], Awaitable[None]]
LifecycleCallback = Callable[[], Awaitable[None]]


class PreparedChatAgent(Protocol):
    async def run_stream(
        self,
        queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        user_message: Message,
        system_message: str,
        *,
        options: RunOptions,
    ) -> None: ...


class ChatStreamRunner(Protocol):
    async def submit(self, func: Callable[..., Awaitable[None]], **kwargs: Any) -> None: ...


@dataclass(frozen=True, slots=True)
class PreparedChatTurn:
    route: ChatRouteMode
    agent: PreparedChatAgent
    user_message: Message
    system_message: str
    tools: tuple[Any, ...]


@dataclass(frozen=True, slots=True)
class ChatTurnLifecycleConfig:
    turn_id_cache_key: str
    responses_cache_key: str
    turn_id: int
    conversation_id: int
    cache_ttl: int


class ChatTurnLifecycle:
    """Own in-flight registration, keepalive, cleanup, and turn timing."""

    def __init__(
        self,
        *,
        config: ChatTurnLifecycleConfig,
        redis_client: Any,
        timings: TurnTimings,
        send_keepalive: LifecycleCallback,
        add_ongoing_conversation: LifecycleCallback,
        remove_ongoing_conversation: LifecycleCallback,
    ) -> None:
        self._config = config
        self._redis_client = redis_client
        self._timings = timings
        self._send_keepalive = send_keepalive
        self._add_ongoing_conversation = add_ongoing_conversation
        self._remove_ongoing_conversation = remove_ongoing_conversation
        self._keepalive_task: asyncio.Task[None] | None = None
        self._route = ChatRouteMode.TASK

    def set_route(self, route: ChatRouteMode) -> None:
        self._route = route

    async def start(self) -> None:
        await self._redis_client.set(
            self._config.turn_id_cache_key,
            self._config.turn_id,
            ex=self._config.cache_ttl,
        )
        await self._add_ongoing_conversation()
        self._keepalive_task = asyncio.create_task(self._send_keepalive())

    async def close(self) -> None:
        self._timings.stages["turn_total_ms"] = int((time.perf_counter() - self._timings.started_at) * 1000)
        self._timings.log(
            conversation_id=self._config.conversation_id,
            turn_id=self._config.turn_id,
            route=self._route,
        )
        try:
            await self._redis_client.delete(self._config.turn_id_cache_key)
            await self._redis_client.delete(self._config.responses_cache_key)
            await self._remove_ongoing_conversation()
        finally:
            if self._keepalive_task is not None:
                self._keepalive_task.cancel()


class ChatResponsePublisher:
    """Assign sequence IDs and apply chat-response persistence policy."""

    def __init__(self, publish_response: PublishResponse) -> None:
        self._publish_response = publish_response
        self._sequence_id = 0
        self._plan_message_persisted = False

    @property
    def emitted_count(self) -> int:
        return self._sequence_id

    async def publish(self, response: ChatResponse) -> None:
        self._sequence_id += 1
        persist = True
        if response.content.type == ChatContentType.PLAN:
            persist = not self._plan_message_persisted
            self._plan_message_persisted = True
        await self._publish_response(self._sequence_id, response, persist)


class ChatResponsePresenter:
    """Translate runtime queue updates into user-visible and durable responses."""

    def __init__(self, *, conversation_id: int, turn_id: int) -> None:
        self._conversation_id = conversation_id
        self._turn_id = turn_id
        self._logger = logging.getLogger(__name__)

    async def drain(
        self,
        response_queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        publish: Callable[[ChatResponse], Awaitable[None]],
    ) -> None:
        accumulated_text = Content.from_text("")
        while True:
            update = await response_queue.get()
            if update is None:
                break
            if isinstance(update, ChatResponse):
                await publish(update)
                if update.is_internal and update.content.type == ChatContentType.TEXT:
                    accumulated_text = Content.from_text("")
                continue
            parts, accumulated_text = self._extract_parts(update, accumulated_text)
            for part in parts:
                await publish(self.build_response(part, is_final=False, is_internal=False))

        try:
            if accumulated_text.text:
                await publish(
                    self.build_response(
                        self.text_content(accumulated_text.text),
                        is_final=False,
                        is_internal=True,
                    )
                )
        except Exception:
            self._logger.exception(
                "chat_drain_accumulated_text_persist_failed conversation_id=%s turn_id=%s",
                self._conversation_id,
                self._turn_id,
            )
        finally:
            await publish(
                self.build_response(
                    ChatContent(type=ChatContentType.END),
                    is_final=True,
                    is_internal=False,
                )
            )

    def _extract_parts(
        self,
        update: ChatResponseUpdate,
        accumulated_text: Content,
    ) -> tuple[list[ChatContent], Content]:
        parts: list[ChatContent] = []
        for content in update.contents or []:
            if content.type in ("function_call", "function_result"):
                continue
            if content.type == "text":
                chunk = content.text or ""
                if chunk:
                    accumulated_text += content
                    parts.append(self.text_content(chunk))
            else:
                self._logger.debug(
                    "chat_stream_non_visible_content_skipped conversation_id=%s turn_id=%s content_type=%s",
                    self._conversation_id,
                    self._turn_id,
                    content.type,
                )
        return parts, accumulated_text

    @staticmethod
    def build_response(content: ChatContent, *, is_final: bool, is_internal: bool) -> ChatResponse:
        return ChatResponse(
            content=content,
            timestamp=int(datetime.now(UTC).timestamp() * 1000),
            is_final=is_final,
            is_internal=is_internal,
        )

    @staticmethod
    def text_content(text: str) -> ChatContent:
        return ChatContent(type=ChatContentType.TEXT, content=text)


class ChatTurnExecutor:
    """Submit a prepared agent turn and drain its presented responses."""

    def __init__(self, *, runner: ChatStreamRunner, timings: TurnTimings) -> None:
        self._runner = runner
        self._timings = timings

    async def execute(
        self,
        *,
        prepared: PreparedChatTurn,
        turn_id: int,
        response_queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        presenter: ChatResponsePresenter,
        publisher: ChatResponsePublisher,
    ) -> None:
        await time_awaitable(
            self._timings,
            "stream_submit_ms",
            self._runner.submit(
                prepared.agent.run_stream,
                queue=response_queue,
                user_message=prepared.user_message,
                system_message=prepared.system_message,
                options=RunOptions(
                    turn_id=turn_id,
                    save_history=True,
                    save_memory=True,
                    tools=prepared.tools,
                ),
            ),
        )
        await time_awaitable(
            self._timings,
            "response_drain_ms",
            presenter.drain(response_queue, publisher.publish),
        )
