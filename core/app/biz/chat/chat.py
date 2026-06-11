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

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import MutableSequence
from dataclasses import dataclass
from typing import Any

from agent_framework import BaseChatClient, ChatResponse, ChatResponseUpdate, Content, Message
from pydantic import BaseModel

from app.llmhubs import get_client
from app.memory.mem0 import get_shared_mem0
from app.pb.conversation.chat import (
    ChatContent as PbChatContent,
    ChatContentType as PbChatContentType,
    ChatResponse as PbChatResponse,
)
from app.storage.fs import CHAT_FS
from app.tools.common import _TOOL_CONTEXT_KWARGS_KEY, ToolCallStatusMiddleware, ToolContext
from app.tools.plan import PlanEditor, is_plan_cancelled
from app.utils.runner import AsyncJobRunner
from app.utils.sanitize import sanitize_mem0_entity_id

_LOGGER = logging.getLogger(__name__)
CHECK_CANCELLED_PLAN_INTERVAL_SECONDS = 2
BUFFER_TEXT_MAXIMUM_LENGTH = 32
CONTENT_TIMESTAMP_KEY = "timestamp_ms"


def _stamp_message_timestamp(message: Message, timestamp_ms: int) -> None:
    """Tag each content of a message with a millisecond timestamp.

    Stored under ``additional_properties[CONTENT_TIMESTAMP_KEY]``. ``setdefault`` is used
    so any timestamp already attached upstream is preserved.
    """
    for content in message.contents or []:
        if content.additional_properties is None:
            content.additional_properties = {}
        content.additional_properties.setdefault(CONTENT_TIMESTAMP_KEY, timestamp_ms)


def _stamp_update_timestamp(update: ChatResponseUpdate, timestamp_ms: int) -> None:
    """Tag the update and each of its contents with a millisecond timestamp.

    The per-content stamp is stored under ``additional_properties[CONTENT_TIMESTAMP_KEY]`` so
    it survives serialization. ``ChatResponseUpdate.created_at`` is also set for completeness.

    When ``ChatResponse.from_updates`` later coalesces consecutive text chunks, the first
    chunk's ``additional_properties`` wins (see ``_combine_additional_props`` in
    ``agent_framework._types``), so the merged text content keeps the timestamp of the first
    chunk in the run.
    """
    if update.created_at is None:
        update.created_at = timestamp_ms
    for content in update.contents or []:
        if content.additional_properties is None:
            content.additional_properties = {}
        # Preserve the earliest stamp if one was already attached upstream.
        content.additional_properties.setdefault(CONTENT_TIMESTAMP_KEY, timestamp_ms)


def build_error_response(message: str) -> PbChatResponse:
    return PbChatResponse(
        content=PbChatContent(
            type=PbChatContentType.ERROR,
            content=message,
        ),
        timestamp=time.time_ns() // 1_000_000,  # convert to milliseconds
        is_final=False,
        is_internal=True,
    )


@dataclass
class _Mem0MemoryTask:
    username: str
    agent_instance_id: str | None
    messages: list[dict[str, str]]


@dataclass(frozen=True)
class RunOptions:
    """Bundled per-turn options for ChatAgent.run / run_stream."""

    turn_id: int = 0
    max_attempts: int = 2
    save_history: bool = False
    save_memory: bool = False
    tools: Any = None
    response_format: type[BaseModel] | None = None


@dataclass(frozen=True)
class _AttemptContext:
    prepared_tools: Any
    conversation_id: Any
    model_name: Any
    turn_id: int
    save_history: bool
    save_memory: bool


class ChatAgent:
    def __init__(
        self,
        *,
        client: BaseChatClient,
        username: str,
        agent_instance_id: int | None,
        mem_runner: AsyncJobRunner,
        tool_context: ToolContext | None = None,
    ) -> None:
        self._client = client
        self._username = username
        self._agent_instance_id = agent_instance_id
        self._mem_runner = mem_runner
        self._tool_context = tool_context

    async def run_stream(
        self,
        queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        user_message: Message,
        system_message: str,
        *,
        options: RunOptions,
    ):
        prepared_tools = options.tools
        conversation_id = self._tool_context.conversation_id if self._tool_context else None
        model_name = getattr(self._client, "_model", None)
        _stamp_message_timestamp(user_message, time.time_ns() // 1_000_000)
        attempt_ctx = _AttemptContext(
            prepared_tools=prepared_tools,
            conversation_id=conversation_id,
            model_name=model_name,
            turn_id=options.turn_id,
            save_history=options.save_history,
            save_memory=options.save_memory,
        )
        try:
            attempt = 0
            while attempt < options.max_attempts:
                attempt += 1
                try:
                    await self._stream_one_attempt(
                        queue,
                        user_message,
                        system_message,
                        ctx=attempt_ctx,
                        attempt=attempt,
                    )
                    return
                except Exception as exc:
                    _LOGGER.warning(
                        "chat_client_stream_attempt_failed agent_instance_id=%s conversation_id=%s "
                        "turn_id=%s model=%s attempt=%s/%s",
                        self._agent_instance_id,
                        conversation_id,
                        options.turn_id,
                        model_name,
                        attempt,
                        options.max_attempts,
                        exc_info=True,
                    )
                    await queue.put(
                        build_error_response(f"Error with chat agent attempt {attempt}/{options.max_attempts}: {str(exc)}")
                    )
                    if attempt >= options.max_attempts:
                        raise
        finally:
            try:
                # mark plan items as completed if any still running
                plan_editor = self._tool_context.plan_editor if self._tool_context else None
                if plan_editor:
                    await _finish_plan(plan_editor)
            except Exception as exc:
                _LOGGER.exception(
                    "chat_turn_finalize_failed agent_instance_id=%s conversation_id=%s turn_id=%s",
                    self._agent_instance_id,
                    conversation_id,
                    options.turn_id,
                )
                await queue.put(build_error_response(f"Error during finalize of chat agent: {str(exc)}"))
            finally:
                await queue.put(None)

    async def _stream_one_attempt(
        self,
        queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        user_message: Message,
        system_message: str,
        *,
        ctx: _AttemptContext,
        attempt: int = 1,
    ) -> None:
        prepared_messages = await self._prepare_messages(user_message, system_message)

        _LOGGER.debug(
            "The final prepared messages for chat client: %s",
            "\n".join(m.to_json(separators=(",", ":")) for m in prepared_messages),
        )

        stream_options: dict[str, Any] = {
            "allow_multiple_tool_calls": True,
            "reasoning": {"effort": "high"},
        }
        if ctx.prepared_tools:
            stream_options["tools"] = ctx.prepared_tools
            stream_options["tool_choice"] = "auto"

        _LOGGER.info(
            "chat_agent_stream_start agent_instance_id=%s conversation_id=%s turn_id=%s "
            "model=%s prepared_message_count=%d tool_count=%d",
            self._agent_instance_id,
            ctx.conversation_id,
            ctx.turn_id,
            ctx.model_name,
            len(prepared_messages),
            len(ctx.prepared_tools) if ctx.prepared_tools else 0,
        )

        assistant_text = ""
        buffered_text = ""
        updates: list[ChatResponseUpdate] = []
        plan_cancel_last_check_timestamp = time.time()
        stream_started_at = time.perf_counter()
        first_update_ms: int | None = None
        async for update in self._client.get_response(
            prepared_messages,
            stream=True,
            options=stream_options,
            function_invocation_kwargs={_TOOL_CONTEXT_KWARGS_KEY: self._tool_context},
        ):
            if first_update_ms is None:
                first_update_ms = int((time.perf_counter() - stream_started_at) * 1000)
            _stamp_update_timestamp(update, time.time_ns() // 1_000_000)
            # Stop streaming immediately if the plan has been cancelled.
            if time.time() - plan_cancel_last_check_timestamp > CHECK_CANCELLED_PLAN_INTERVAL_SECONDS:
                if is_plan_cancelled(self._agent_instance_id, self._username, ctx.turn_id, ctx.conversation_id):
                    _LOGGER.info(
                        "chat_plan_cancel_detected agent_instance_id=%s conversation_id=%s "
                        "turn_id=%s stopping_generation=true",
                        self._agent_instance_id,
                        ctx.conversation_id,
                        ctx.turn_id,
                    )
                    break
                plan_cancel_last_check_timestamp = time.time()

            updates.append(update)
            text_only, update_text, added_assistant = self._process_update_contents(update, ctx.conversation_id, ctx.turn_id)
            assistant_text += added_assistant
            buffered_text = await self._emit_or_buffer(queue, update, text_only, update_text, buffered_text)

        # if any buffered text left after stream ends, send it as an update
        if buffered_text:
            await queue.put(ChatResponseUpdate(contents=[Content.from_text(buffered_text)], role="assistant"))

        response = ChatResponse.from_updates(updates)
        if ctx.save_history:
            await self.persist_turn(user_message, response, ctx.turn_id)
        if ctx.save_memory:
            await self._enqueue_memories(
                user_message,
                Message(role="assistant", contents=[assistant_text]),
            )
        _LOGGER.info(
            "chat_agent_stream_completed agent_instance_id=%s conversation_id=%s turn_id=%s "
            "model=%s update_count=%d assistant_text_len=%d llm_first_update_ms=%s",
            self._agent_instance_id,
            ctx.conversation_id,
            ctx.turn_id,
            ctx.model_name,
            len(updates),
            len(assistant_text),
            first_update_ms,
        )

    def _process_update_contents(
        self,
        update: ChatResponseUpdate,
        conversation_id: Any,
        turn_id: int,
    ) -> tuple[bool, str, str]:
        text_only = True
        update_text = ""
        assistant_text = ""
        for content in update.contents or []:
            if content.type != "text":
                text_only = False

            if content.type == "text" and content.text:
                assistant_text += str(content.text)
                update_text += str(content.text)
            elif content.type == "function_call":
                self._log_function_call(content, conversation_id, turn_id)
            elif content.type == "function_result":
                self._log_function_result(content, conversation_id, turn_id)
        return text_only, update_text, assistant_text

    def _log_function_call(self, content: Any, conversation_id: Any, turn_id: int) -> None:
        _LOGGER.info(
            "chat_tool_call_requested agent_instance_id=%s conversation_id=%s turn_id=%s tool=%s call_id=%s",
            self._agent_instance_id,
            conversation_id,
            turn_id,
            content.name,
            content.call_id,
        )

    def _log_function_result(self, content: Any, conversation_id: Any, turn_id: int) -> None:
        if content.exception is not None:
            _LOGGER.error(
                "chat_tool_call_failed agent_instance_id=%s conversation_id=%s turn_id=%s call_id=%s exception=%s result=%s",
                self._agent_instance_id,
                conversation_id,
                turn_id,
                content.call_id,
                content.exception,
                content.result,
            )
            return
        result_len = len(str(content.result)) if content.result is not None else 0
        _LOGGER.info(
            "chat_tool_result_received agent_instance_id=%s conversation_id=%s turn_id=%s call_id=%s result_len=%d",
            self._agent_instance_id,
            conversation_id,
            turn_id,
            content.call_id,
            result_len,
        )

    @staticmethod
    async def _emit_or_buffer(
        queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        update: ChatResponseUpdate,
        text_only: bool,
        update_text: str,
        buffered_text: str,
    ) -> str:
        if not text_only:
            if buffered_text:
                await queue.put(ChatResponseUpdate(contents=[Content.from_text(buffered_text)], role="assistant"))
                buffered_text = ""
            await queue.put(update)
            return buffered_text

        buffered_text += update_text
        if len(buffered_text) > BUFFER_TEXT_MAXIMUM_LENGTH:
            await queue.put(ChatResponseUpdate(contents=[Content.from_text(buffered_text)], role="assistant"))
            buffered_text = ""
        return buffered_text

    async def run(
        self,
        message_payload: Message,
        system_message: str,
        *,
        options: RunOptions,
    ) -> ChatResponse:
        if options.turn_id == 0 and options.save_history:
            raise ValueError("turn_id must be provided when save_history is True")

        attempt = 0
        prepared_tools = options.tools
        _stamp_message_timestamp(message_payload, time.time_ns() // 1_000_000)
        while attempt < options.max_attempts:
            attempt += 1
            try:
                prepared_messages = await self._prepare_messages(
                    message_payload,
                    system_message,
                )

                _LOGGER.info(
                    "The final prepared messages for chat client: %s",
                    "\n".join(m.to_json(separators=(",", ":")) for m in prepared_messages),
                )

                response_options: dict[str, Any] = {
                    "response_format": options.response_format,
                    "allow_multiple_tool_calls": True,
                    "reasoning": {"effort": "high"},
                }
                if prepared_tools:
                    response_options["tools"] = prepared_tools
                    response_options["tool_choice"] = "auto"

                response = await self._client.get_response(
                    prepared_messages,
                    options=response_options,
                    middleware=[ToolCallStatusMiddleware()],
                    function_invocation_kwargs={_TOOL_CONTEXT_KWARGS_KEY: self._tool_context},
                )
                assistant_text = response.messages[-1].text if response.messages else ""
                if options.save_history:
                    await self.persist_turn(message_payload, response, options.turn_id)
                if options.save_memory:
                    await self._enqueue_memories(
                        message_payload,
                        Message(role="assistant", contents=[assistant_text]),
                    )
                return response
            except Exception as exc:
                _LOGGER.warning(
                    "chat client authentication failed (attempt %s/%s)",
                    attempt,
                    options.max_attempts,
                    exc_info=exc,
                )
                if attempt >= options.max_attempts:
                    raise

    async def persist_turn(self, user_message: Message, response: ChatResponse, turn_id: int) -> None:
        """Persist user + assistant messages as conversation.json under the turn path."""
        all_messages = [user_message] + list(response.messages)
        serialized = "[" + ",".join(m.to_json(separators=(",", ":")) for m in all_messages) + "]"
        await asyncio.to_thread(
            CHAT_FS.write_conversation,
            self._agent_instance_id,
            self._username,
            turn_id,
            serialized,
        )

    async def _enqueue_memories(self, user_message: Message, assistant_message: Message) -> None:
        memory_messages: list[dict[str, str]] = []

        user_text = _extract_text_from_message(user_message)
        if user_text:
            memory_messages.append({"role": "user", "content": user_text})

        assistant_text = _extract_text_from_message(assistant_message)
        if assistant_text:
            memory_messages.append({"role": "assistant", "content": assistant_text})

        if memory_messages:
            try:
                _LOGGER.info(
                    "enqueueing mem0 task for user %s and agent instance %s",
                    self._username,
                    self._agent_instance_id,
                )
                await self._mem_runner.submit(
                    _store_memories,
                    _Mem0MemoryTask(
                        username=self._username,
                        agent_instance_id=str(self._agent_instance_id),
                        messages=memory_messages,
                    ),
                )
            except Exception as exc:
                _LOGGER.warning("failed to enqueue mem0 task", exc_info=exc)

    async def _prepare_messages(
        self,
        user_message: Message,
        system_message: str,
    ) -> MutableSequence[Message]:
        messages: list[Message] = []
        if system_message:
            messages.append(Message(role="system", contents=[system_message]))

        # Prepend text-only content from the last 3 turns of conversation history.
        history_messages = await self._load_recent_history(num_turns=3)
        messages.extend(history_messages)

        messages.append(user_message)

        return messages

    async def _load_recent_history(self, num_turns: int = 3) -> list[Message]:
        """Load text-only messages from the most recent conversation turns."""
        if self._agent_instance_id is None:
            return []

        try:
            turn_ids = await asyncio.to_thread(
                CHAT_FS.list_turn_ids,
                self._agent_instance_id,
                self._username,
            )
        except Exception:
            _LOGGER.debug("failed to list turn ids for history", exc_info=True)
            return []

        if not turn_ids:
            return []

        recent_turn_ids = turn_ids[-num_turns:]
        history: list[Message] = []

        for turn_id in recent_turn_ids:
            try:
                raw = await asyncio.to_thread(
                    CHAT_FS.read_conversation,
                    self._agent_instance_id,
                    self._username,
                    turn_id,
                )
                if not raw:
                    continue
                turn_messages = json.loads(raw)
                if not isinstance(turn_messages, list):
                    continue
                for msg_data in turn_messages:
                    msg = Message.from_dict(msg_data)
                    text = _extract_text_from_message(msg)
                    if text:
                        role = msg.role if isinstance(msg.role, str) else msg.role.value
                        history.append(Message(role=role, contents=[text]))
            except Exception:
                _LOGGER.debug("failed to load conversation for turn %s", turn_id, exc_info=True)
                continue

        return history


async def build_agent(
    username: str,
    agent_id: str,
    agent_instance_id: int,
    mem_runner: AsyncJobRunner | None = None,
    model: str | int | None = None,
    tool_context: ToolContext | None = None,
) -> ChatAgent:
    if mem_runner is None:
        raise RuntimeError("mem_runner is required to build ChatAgent")

    client = get_client(model)
    client.function_invocation_configuration["include_detailed_errors"] = True

    max_iterations_env = os.getenv("CHAT_AGENT_MAX_ITERATIONS")
    if max_iterations_env is not None:
        max_iterations_env = max_iterations_env.strip()
        try:
            max_iterations = int(max_iterations_env)
        except ValueError:
            _LOGGER.warning(
                "invalid CHAT_AGENT_MAX_ITERATIONS value %r; expected an integer >= 1",
                max_iterations_env,
            )
        else:
            if max_iterations >= 1:
                client.function_invocation_configuration["max_iterations"] = max_iterations
            else:
                _LOGGER.warning(
                    "invalid CHAT_AGENT_MAX_ITERATIONS value %r; expected an integer >= 1",
                    max_iterations_env,
                )

    return ChatAgent(
        client=client,
        username=username,
        agent_instance_id=agent_instance_id,
        mem_runner=mem_runner,
        tool_context=tool_context,
    )


async def _store_memories(task: _Mem0MemoryTask) -> None:
    try:
        memory = get_shared_mem0()
        await memory.add(
            messages=task.messages,
            user_id=sanitize_mem0_entity_id(task.username),
            agent_id=sanitize_mem0_entity_id(task.agent_instance_id),
        )
    except Exception as exc:  # pragma: no cover - external service call
        _LOGGER.warning("failed to store mem0 memories", exc_info=exc)


def _extract_text_from_message(message: Message) -> str:
    # Prefer contents over message.text to avoid duplication;
    # Message.from_dict populates both with the same value.
    contents = getattr(message, "contents", None) or []
    text_parts: list[str] = []
    for content in contents:
        if content.type == "text" and content.text:
            text_parts.append(str(content.text))
    if text_parts:
        return "\n".join(text_parts)
    text_val = getattr(message, "text", None)
    if text_val:
        return str(text_val)
    return ""


async def _finish_plan(plan_editor: PlanEditor) -> None:
    if not plan_editor.has_plan_updates:
        return
    plan = await plan_editor.get_plan()
    if plan:
        plan = plan.mark_finished()
        await plan_editor.update_plan(plan)
