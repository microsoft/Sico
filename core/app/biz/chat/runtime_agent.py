"""Main chat host for the shared framework-neutral agent runtime."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from agent_framework import ChatResponseUpdate, Content, Message
from agent_framework._compaction import CharacterEstimatorTokenizer
from pydantic import BaseModel

from app.biz.task_runtime.sub_agent.history import ConversationHistoryLoader, ConversationHistoryRequest
from app.biz.task_runtime.sub_agent.profile_loader import default_agent_profile_resolver
from app.biz.task_runtime.sub_agent.loop import (
    AgentContent,
    AgentContextBlock,
    AgentLoopLimits,
    AgentLoopRequest,
    AgentLoopRuntime,
    AgentTask,
    CompletionDirective,
    FinalAnswer,
    LoopFinishedEvent,
    ModelOutputDeltaEvent,
    NativeAgentLoopEngine,
    ToolCallRequestedEvent,
)
from app.biz.task_runtime.sub_agent.streaming_llm import HubStreamingAgentLLM
from app.biz.task_runtime.sub_agent.loop.transcript import AgentEventTranscript
from app.llmhubs import get_context_length
from app.llmhubs.types import ModelRegistryEntry
from app.pb.conversation.chat import ChatContent, ChatContentType, ChatResponse
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext
from app.tools.plan import is_plan_cancelled

from .capabilities import ChatCapabilityToolController

_DEFAULT_CONTEXT_LENGTH = 128_000
_HISTORY_CONTEXT_RATIO = 0.5
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class RunOptions:
    """Bundled per-turn options for the main chat agent."""

    turn_id: int = 0
    max_attempts: int = 2
    save_history: bool = False
    save_memory: bool = False
    tools: Any = None
    response_format: type[BaseModel] | None = None


def build_error_response(message: str) -> ChatResponse:
    return ChatResponse(
        content=ChatContent(type=ChatContentType.ERROR, content=message),
        timestamp=time.time_ns() // 1_000_000,
        is_final=False,
        is_internal=True,
    )


class ChatAgent:
    def __init__(
        self,
        *,
        username: str,
        agent_instance_id: int,
        tool_context: ToolContext,
        model: str | None = None,
        resolved_entry: ModelRegistryEntry | None = None,
    ) -> None:
        self._username = username
        self._agent_instance_id = agent_instance_id
        self._tool_context = tool_context
        self._model_name = model or ""
        self._model = HubStreamingAgentLLM(model=model, resolved_entry=resolved_entry)
        profile = default_agent_profile_resolver().resolve("default")
        if profile is None:
            raise RuntimeError("default main-agent profile is not configured")
        self._profile = profile

    async def run_stream(
        self,
        queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        user_message: Message,
        system_message: str,
        *,
        options: Any,
    ) -> None:
        conversation = [user_message.to_dict()]
        event_transcript = AgentEventTranscript(
            CHAT_FS.get_turn_path(
                self._agent_instance_id,
                self._username,
                options.turn_id,
                self._tool_context.conversation_id,
            )
            / "events.jsonl"
        )
        assistant_segment = ""
        try:
            await event_transcript.reset()
            controller = ChatCapabilityToolController(
                options.tools or (),
                self._tool_context,
                capability_ceiling=self._profile.capability_ceiling,
            )
            toolset = await controller.snapshot()
            history = await self._load_history(options.turn_id)
            request = AgentLoopRequest(
                engine_run_id=f"chat-{self._tool_context.conversation_id}-{options.turn_id}",
                task=AgentTask(
                    title=_message_text(user_message)[:200] or "Chat turn",
                    instructions=_message_text(user_message),
                ),
                system_prompt="\n\n".join(
                    part for part in (system_message.strip(), self._profile.system_prompt.strip()) if part
                ),
                tools=toolset.descriptors,
                limits=AgentLoopLimits(
                    max_model_turns=_max_model_turns(),
                    allow_parallel_tool_calls=False,
                ),
                context=_image_context(user_message),
                initial_messages=history,
                provider_tools=tuple(dict(tool) for tool in options.tools or () if isinstance(tool, Mapping)),
            )

            async def accept_completion(proposal: FinalAnswer, snapshot) -> CompletionDirective:
                return CompletionDirective(outcome="accept")

            runtime = AgentLoopRuntime(
                context_controller=_StaticRequestContext(),
                evaluate_completion=accept_completion,
                tool_controller=controller,
            )

            engine = NativeAgentLoopEngine(self._model) # TODO: support MAF and LangGraph, selected by an env var.

            async for event in engine.run(request, tools=toolset.tools, runtime=runtime):
                await _record_event(event_transcript, event)
                if self._cancelled(options.turn_id):
                    break
                if isinstance(event, ModelOutputDeltaEvent) and event.content.type == "text":
                    assistant_segment += event.content.text
                    await queue.put(
                        ChatResponseUpdate(
                            role="assistant",
                            contents=[
                                Content.from_text(
                                    event.content.text,
                                    additional_properties=dict(event.content.metadata),
                                )
                            ],
                        )
                    )
                elif isinstance(event, ToolCallRequestedEvent):
                    await _flush_segment(queue, assistant_segment)
                    if assistant_segment:
                        conversation.append(
                            {"role": "assistant", "contents": [{"type": "text", "text": assistant_segment}]}
                        )
                    assistant_segment = ""
                    await self._write_conversation(conversation, options.turn_id)
                elif isinstance(event, LoopFinishedEvent):
                    if assistant_segment:
                        conversation.append(
                            {"role": "assistant", "contents": [{"type": "text", "text": assistant_segment}]}
                        )
                    await self._write_conversation(conversation, options.turn_id)
                    if event.outcome == "completed":
                        await self._finish_plan()
                    else:
                        await queue.put(_error_response(event.summary))
        except Exception as exc:  # noqa: BLE001 - surface runtime failures through the existing chat stream.
            await self._write_conversation(conversation, options.turn_id)
            await queue.put(_error_response(str(exc)))
        finally:
            await _flush_event_transcript(event_transcript)
            await queue.put(None)

    async def _load_history(self, turn_id: int):
        context_length = get_context_length(self._model_name or None) or _DEFAULT_CONTEXT_LENGTH
        loader = ConversationHistoryLoader(
            CHAT_FS,
            count_tokens=CharacterEstimatorTokenizer().count_tokens,
        )
        return await asyncio.to_thread(
            loader.load,
            ConversationHistoryRequest(
                agent_instance_id=self._agent_instance_id,
                username=self._username,
                conversation_id=self._tool_context.conversation_id,
                before_turn_id=turn_id,
                token_budget=int(context_length * _HISTORY_CONTEXT_RATIO),
            ),
        )

    async def _write_conversation(self, conversation: list[dict[str, Any]], turn_id: int) -> None:
        await asyncio.to_thread(
            CHAT_FS.write_conversation,
            self._agent_instance_id,
            self._username,
            turn_id,
            json.dumps(conversation, ensure_ascii=False, separators=(",", ":")),
            self._tool_context.conversation_id,
        )

    def _cancelled(self, turn_id: int) -> bool:
        return is_plan_cancelled(
            self._agent_instance_id,
            self._username,
            turn_id,
            self._tool_context.conversation_id,
        )

    async def _finish_plan(self) -> None:
        plan_editor = self._tool_context.plan_editor
        if not plan_editor.has_plan_updates:
            return
        plan = await plan_editor.get_plan()
        if plan is not None:
            await plan_editor.update_plan(plan.mark_finished())


class _StaticRequestContext:
    async def before_model(self, snapshot):
        from app.biz.task_runtime.sub_agent.loop import PreparedModelContext

        return PreparedModelContext(blocks=snapshot.request.context)


async def build_agent(
    username: str,
    agent_id: str,
    agent_instance_id: int,
    mem_runner=None,
    *,
    tool_context: ToolContext,
    model: str | int | None = None,
    resolved_entry: ModelRegistryEntry | None = None,
) -> ChatAgent:
    return ChatAgent(
        username=username,
        agent_instance_id=agent_instance_id,
        tool_context=tool_context,
        model=str(model) if model is not None else None,
        resolved_entry=resolved_entry,
    )


def _max_model_turns() -> int:
    raw = os.getenv("CHAT_AGENT_MAX_ITERATIONS", "32").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 32


def _message_text(message: Message) -> str:
    return "".join(str(content.text) for content in message.contents or () if content.type == "text" and content.text)


def _image_context(message: Message) -> tuple[AgentContextBlock, ...]:
    images = tuple(
        AgentContent(
            type="image",
            uri=str(getattr(content, "uri", "") or getattr(content, "image_url", "")),
            mime_type=str(getattr(content, "media_type", "") or ""),
        )
        for content in message.contents or ()
        if content.type in {"image", "image_url"}
    )
    return (AgentContextBlock(source="current_message", content="", contents=images),) if images else ()


async def _flush_segment(queue: asyncio.Queue, text: str) -> None:
    if not text:
        return
    await queue.put(
        ChatResponse(
            content=ChatContent(type=ChatContentType.TEXT, content=text),
            timestamp=time.time_ns() // 1_000_000,
            is_final=False,
            is_internal=True,
        )
    )


def _error_response(message: str) -> ChatResponse:
    return ChatResponse(
        content=ChatContent(type=ChatContentType.ERROR, content=message),
        timestamp=time.time_ns() // 1_000_000,
        is_final=False,
        is_internal=True,
    )


async def _record_event(transcript: AgentEventTranscript, event) -> None:
    try:
        await transcript.append(event)
    except Exception:  # noqa: BLE001 - diagnostic persistence must not fail the chat turn.
        _LOGGER.warning("chat_agent_event_transcript_append_failed path=%s", transcript.path, exc_info=True)


async def _flush_event_transcript(transcript: AgentEventTranscript) -> None:
    try:
        await transcript.flush()
    except Exception:  # noqa: BLE001 - diagnostic persistence must not fail the chat turn.
        _LOGGER.warning("chat_agent_event_transcript_flush_failed path=%s", transcript.path, exc_info=True)
