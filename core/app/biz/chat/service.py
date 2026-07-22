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
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agent_framework import (
    ChatResponseUpdate,
    Content,
    Message,
)
from grpclib import GRPCError
from grpclib.const import Status
from pydantic import BaseModel
import pydantic

import app.schemas.conversation
from app.biz.chat.adapters import build_default_adapters
from app.biz.chat.chat import build_error_response
from app.biz.chat.prompt_sections import (
    PromptSectionContext,
    collect_prompt_sections,
)
from app.biz.chat.router import hard_guard_route, llm_intent_check, tools_for_route
from app.biz.chat.turn_timing import begin_turn, time_awaitable, time_sync
from app.biz.task_runtime.rerun_sources import (
    RERUN_SOURCE_INLINE_MAX_CHARS,
    RERUN_SOURCES_DIR,
    compact_rerun_source_payload,
)
from app.biz.task_runtime.skill_loader import SkillLoader
from app.biz.chat.types import (
    AdapterExcerpt,
    ChatIntentCheckerInput,
    ChatIntentCheckerOutput,
    ChatRouteMode,
    ToolExcerpt,
)
from app.biz.chat.workspace_init import WorkspaceInitOptions, init_workspace
from app.tools import (
    CONTEXT_TOOL,
    EDIT_TOOL,
    GREP_TOOL,
    READ_TOOL,
    REMOVE_TOOL,
    REPORT_TOOL,
    WRITE_FILE_TOOL,
)
from app.pb.conversation.chat import (
    ChatContent,
    ChatContentType,
    ChatResponse,
    FunctionContext,
)
from app.pb.conversation.rpc import (
    ChatServiceBase,
)
from app.pb.conversation.api import (
    CancelPlanRequest,
    CancelPlanResponse,
    ChatRequest,
    ChatDirectResponse,
    GetPlanData,
    GetPlanRequest,
    GetPlanResponse,
    GenerateOnboardRecommendationTasksRequest,
    GenerateOnboardRecommendationTasksResponse,
)
import app.llmhubs
from app.pb.common.common import Attachment
from app.schemas.common.common import Attachment as SchemaAttachment
from app.schemas.conversation.chat import TopicMessage
from app.schemas.conversation.plan import Plan, PlanStatus
from app.storage import redis
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext
from app.tools.delegate import build_adapter_tools
from app.tools.plan import PlanEditor, read_plan
from app.tools.plan import cancel_plan as cancel_plan_async
from app.utils.eventbus import EventBus
from app.utils.response import error_response, success_response
from app.utils.runner import AsyncJobRunner

from .chat import RunOptions, build_agent
from .context import get_skill_knowledge_context
from .prompt import PromptFile, compose_system_prompt, render_prompt_file

ONGOING_CHAT_CACHE_TIME_TO_LIVE = 3 * 24 * 60 * 60  # 3 days
KEEPALIVE_INTERVAL_SECONDS = 5
_JSON_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.IGNORECASE | re.DOTALL)
_LOG_PREVIEW_CHARS = 1000
_INTENT_PRIOR_CONVERSATION_TURNS = 3
_FAST_MODEL_ENV = "FAST_MODEL"
_TITLE_SUMMARY_MAX_CHARS = 20000
_TITLE_SUMMARY_MAX_LENGTH = 80


def _load_recommendation_tasks_json(text: str) -> Any:
    payload = text.strip()
    match = _JSON_FENCE_PATTERN.match(payload)
    if match:
        payload = match.group(1).strip()
    parsed = json.loads(payload)
    if isinstance(parsed, list):
        return {"tasks": parsed}
    return parsed


def _text_preview(text: str) -> str:
    if len(text) <= _LOG_PREVIEW_CHARS:
        return text
    return text[:_LOG_PREVIEW_CHARS].rstrip() + "..."


def _build_prior_conversation_section(
    agent_instance_id: int,
    username: str,
    current_turn_id: int,
    conversation_id: int,
) -> str:
    turn_ids = [
        turn_id for turn_id in CHAT_FS.list_turn_ids(agent_instance_id, username, conversation_id) if turn_id < current_turn_id
    ]
    if not turn_ids:
        return ""

    sections: list[str] = []
    for turn_id in turn_ids[-_INTENT_PRIOR_CONVERSATION_TURNS:]:
        conversation_json = CHAT_FS.read_conversation(
            agent_instance_id,
            username,
            turn_id,
            conversation_id=conversation_id,
        )
        messages = _text_only_conversation_messages(conversation_json or "")
        if not messages:
            continue
        sections.append(f"Turn {turn_id}:\n" + "\n".join(messages))

    if not sections:
        return ""
    return "Recent prior conversation text (tool calls/results omitted; oldest to newest):\n\n" + "\n\n".join(sections)


def _text_only_conversation_messages(conversation_json: str) -> list[str]:
    try:
        loaded = json.loads(conversation_json)
    except json.JSONDecodeError:
        return []
    if not isinstance(loaded, list):
        return []

    messages: list[str] = []
    for item in loaded:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        text = _conversation_item_text(item)
        if text:
            messages.append(f"{role}: {_compact_history_text(text)}")
    return messages


def _conversation_item_text(item: dict[str, Any]) -> str:
    parts: list[str] = []
    contents = item.get("contents")
    if isinstance(contents, list):
        for content in contents:
            if isinstance(content, dict) and content.get("type") == "text" and isinstance(content.get("text"), str):
                parts.append(content["text"])
    content = item.get("content")
    if isinstance(content, str):
        parts.append(content)
    return "\n".join(part for part in parts if part.strip()).strip()


def _compact_history_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# Singleton
class ChatService(ChatServiceBase):
    """Server-side streaming chat service backed by Microsoft Agent Framework."""

    _instance: ChatService = None

    def __init__(self, mem_runner: AsyncJobRunner, redis_runner: AsyncJobRunner, stream_chat_runner: AsyncJobRunner) -> None:
        if ChatService._instance is not None:
            raise RuntimeError("ChatService is a singleton and has already been instantiated.")
        self._logger = logging.getLogger(__name__)
        self._mem_runner = mem_runner
        self._stream_chat_runner = stream_chat_runner
        self._event_bus_sender = None
        self._event_bus_topic_name = os.getenv("EVENT_BUS_TOPIC", "core-backend")
        ChatService._instance = self

    @staticmethod
    def get_instance():
        if ChatService._instance is None:
            raise RuntimeError("ChatService must be initialized before use.")
        return ChatService._instance

    async def stream_chat(self, chat_request: ChatRequest) -> ChatDirectResponse:  # noqa: PLR0915
        timings = begin_turn()
        response_queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None] = asyncio.Queue()

        send_keepalive_task = asyncio.create_task(self._send_keepalive_loop(chat_request))

        if chat_request.message.type != ChatContentType.TEXT:
            self._logger.warning(
                "chat_request_invalid_content_type conversation_id=%s turn_id=%s content_type=%s",
                chat_request.conversation_id,
                chat_request.turn_id,
                chat_request.message.type.name,
            )
            raise GRPCError(Status.INVALID_ARGUMENT, "chat message must be text")

        redis_client = redis.get_shared_redis()
        cache_key = _get_ongoing_chat_cache_key(chat_request.conversation_id, chat_request.turn_id)
        await redis_client.set(cache_key.turn_id_cache_key, chat_request.turn_id, ex=ONGOING_CHAT_CACHE_TIME_TO_LIVE)

        async def clear_ongoing_chat_cache():
            await redis_client.delete(cache_key.turn_id_cache_key)
            await redis_client.delete(cache_key.chat_responses_cache_key)

        self._logger.info(
            "chat_stream_request_received "
            "username=%s agent_id=%s agent_instance_id=%s conversation_id=%s "
            "turn_id=%s model=%s attachment_count=%d agent_attachment_count=%d",
            chat_request.username,
            chat_request.agent_id,
            chat_request.agent_instance_id,
            chat_request.conversation_id,
            chat_request.turn_id,
            chat_request.model or "<platform-default>",
            len(chat_request.message.attachments),
            len(chat_request.agent_attachments),
        )

        async def on_plan_update(plan: Plan):
            chat_content = ChatContent(type=ChatContentType.PLAN)
            await response_queue.put(self._build_chat_response(chat_content, is_final=False, is_internal=False))

        plan_editor = PlanEditor(
            agent_instance_id=chat_request.agent_instance_id,
            turn_id=chat_request.turn_id,
            conversation_id=chat_request.conversation_id,
            username=chat_request.username,
            notify_plan_updated_callback=on_plan_update,
        )
        tool_context = ToolContext(
            username=chat_request.username,
            agent_id=chat_request.agent_id,
            agent_instance_id=chat_request.agent_instance_id or None,
            turn_id=chat_request.turn_id,
            project_id=chat_request.project_id,
            conversation_id=chat_request.conversation_id,
            response_queue=response_queue,
            plan_editor=plan_editor,
            raw_user_message=chat_request.message.content,
        )

        sequence_id = 0

        async def yield_response(chat_message: ChatResponse):
            nonlocal sequence_id
            sequence_id += 1
            await self._yield_response(chat_request, redis_client, cache_key, sequence_id, chat_message)

        route = ChatRouteMode.TASK
        try:
            # Always initialize the workspace: every route benefits from having
            # attachments + knowledge/skills materialized before routing.
            workspace_started_at = time.perf_counter()
            await init_workspace(
                agent_instance_id=chat_request.agent_instance_id,
                username=chat_request.username,
                conversation_id=chat_request.conversation_id,
                turn_id=chat_request.turn_id,
                project_id=chat_request.project_id,
                agent_id=chat_request.agent_id,
                attachments=chat_request.message.attachments + chat_request.agent_attachments,
                options=WorkspaceInitOptions(),
            )
            timings.record("workspace_init_ms", workspace_started_at)

            # Build rendered context sections once for router input.
            workspace = CHAT_FS.get_workspace_path(
                chat_request.agent_instance_id,
                chat_request.username,
                chat_request.conversation_id,
            )
            skill_loader = SkillLoader(
                workspace,
                project_id=int(chat_request.project_id or 0),
                agent_id=chat_request.agent_id,
            )
            tool_context.skill_loader = skill_loader
            sections = self._build_context_sections(chat_request, skill_loader)

            # Adapter registry for routing.
            adapters = build_default_adapters()
            adapter_excerpts = [AdapterExcerpt.from_adapter(a) for a in adapters.values()]
            direct_tool_excerpts = self._direct_tool_excerpts()

            # --- routing ---
            route_started_at = time.perf_counter()
            hard = hard_guard_route(
                chat_request.message.content or "",
                has_attachments=bool(chat_request.message.attachments or chat_request.agent_attachments),
            )
            intent: ChatIntentCheckerOutput

            import app.schemas.common.common

            attachments = [
                app.schemas.common.common.Attachment.from_pb(item)
                for item in list(chat_request.message.attachments) + list(chat_request.agent_attachments)
            ]

            if hard.route != ChatRouteMode.UNSPECIFIED:
                intent = ChatIntentCheckerOutput(route=hard.route, confidence=1.0, reason=f"hard_guard:{hard.reason}")
                timings.record("route_ms", route_started_at)
            else:
                # UNSPECIFIED → normal LLM routing. Hard-guard FAST/TASK
                # decisions skip the LLM intent check entirely.
                timings.record("route_ms", route_started_at)
                intent_started_at = time.perf_counter()
                intent = await llm_intent_check(
                    ChatIntentCheckerInput(
                        user_prompt=chat_request.message.content or "",
                        attachments=attachments,
                        adapters=adapter_excerpts,
                        direct_tools=direct_tool_excerpts,
                        workspace_attachments_section=sections.get("workspace_attachments", ""),
                        workspace_knowledge_section=sections.get("workspace_knowledge", ""),
                        prior_rerun_sources_section=sections.get("prior_rerun_sources", ""),
                        prior_parsed_workbook_sources_section=sections.get("prior_parsed_workbook_sources", ""),
                        prior_conversation_section=self._build_prior_conversation_section(chat_request),
                        skills_section=sections.get("skills", ""),
                    )
                )
                timings.record("intent_check_ms", intent_started_at)
            route = intent.route
            self._logger.info(
                "chat_route_decided conversation_id=%s turn_id=%s route=%s confidence=%.2f reason=%s",
                chat_request.conversation_id,
                chat_request.turn_id,
                route.value,
                intent.confidence,
                intent.reason,
            )

            # Build common chat agent + user message + system prompt.
            agent = await time_awaitable(
                timings,
                "agent_build_ms",
                build_agent(
                    chat_request.username,
                    chat_request.agent_id,
                    chat_request.agent_instance_id,
                    self._mem_runner,
                    tool_context=tool_context,
                    model=_model_for_route(route, chat_request.model or None),
                ),
            )
            system_message = time_sync(
                timings,
                "prompt_build_ms",
                compose_system_prompt,
                prompt_mode=_prompt_mode_for_route(route),
                name=chat_request.agent_instance_name,
                role_name=chat_request.agent_role,
                project_name=chat_request.project_name,
                skills_section=sections.get("skills", ""),
            )
            user_msg_started_at = time.perf_counter()
            user_message = await asyncio.to_thread(self._build_user_message_from_sections, chat_request)
            timings.record("user_message_build_ms", user_msg_started_at)

            if route == ChatRouteMode.TASK:
                adapter_tools = build_adapter_tools(adapters)
            else:
                adapter_tools = []

            tools_started_at = time.perf_counter()
            all_tools = tools_for_route(route) + adapter_tools
            tool_context.all_tools = all_tools
            timings.record("tools_build_ms", tools_started_at)

            if chat_request.need_update_title:
                asyncio.ensure_future(
                    self._try_update_conversation_title(
                        conversation_id=chat_request.conversation_id,
                        turn_id=chat_request.turn_id,
                        user_prompt=chat_request.message.content or "",
                        model=chat_request.model or None,
                    )
                )

            await time_awaitable(
                timings,
                "stream_submit_ms",
                self._stream_chat_runner.submit(
                    agent.run_stream,
                    queue=response_queue,
                    user_message=user_message,
                    system_message=system_message,
                    options=RunOptions(
                        turn_id=chat_request.turn_id,
                        save_history=True,
                        save_memory=True,
                        tools=all_tools,
                    ),
                ),
            )
            await time_awaitable(
                timings,
                "response_drain_ms",
                self._drain_response_queue(response_queue, yield_response, chat_request),
            )

            self._logger.info(
                "chat_stream_completed conversation_id=%s turn_id=%s route=%s emitted_seq_count=%d",
                chat_request.conversation_id,
                chat_request.turn_id,
                route.value,
                sequence_id,
            )

        except GRPCError as exc:
            await yield_response(build_error_response(f"Caught GRPC error: {str(exc)}"))
            raise exc

        except Exception as exc:
            await yield_response(build_error_response(f"Error during chat: {str(exc)}"))
            self._logger.exception(
                "chat_stream_execution_failed conversation_id=%s turn_id=%s agent_instance_id=%s model=%s",
                chat_request.conversation_id,
                chat_request.turn_id,
                chat_request.agent_instance_id,
                chat_request.model or "<platform-default>",
            )
            raise GRPCError(Status.INTERNAL, "Chat agent execution failed") from exc

        finally:
            timings.stages["turn_total_ms"] = int((time.perf_counter() - timings.started_at) * 1000)
            timings.log(conversation_id=chat_request.conversation_id, turn_id=chat_request.turn_id, route=route)
            await clear_ongoing_chat_cache()
            send_keepalive_task.cancel()

        return ChatDirectResponse()

    async def _try_update_conversation_title(
        self,
        *,
        conversation_id: int,
        turn_id: int,
        user_prompt: str,
        model: str | None,
    ) -> None:
        try:
            if not user_prompt.strip():
                self._logger.info("conversation_title_update_skipped_empty_prompt conversation_id=%s", conversation_id)
                return

            title = await self._generate_conversation_title(user_prompt, model)
            if not title:
                self._logger.info("conversation_title_update_skipped_empty_title conversation_id=%s", conversation_id)
                return

            from app.biz.reverse_grpc.conversation import ReverseConversationService

            await asyncio.to_thread(
                ReverseConversationService.get_instance().update_conversation_title,
                conversation_id,
                title,
            )
            self._logger.info(
                "conversation_title_update_submitted conversation_id=%s turn_id=%s title=%s",
                conversation_id,
                turn_id,
                title,
            )
        except Exception:
            self._logger.warning(
                "conversation_title_update_failed conversation_id=%s turn_id=%s",
                conversation_id,
                turn_id,
                exc_info=True,
            )

    async def _generate_conversation_title(self, user_prompt: str, model: str | None) -> str:
        transcript = user_prompt[:_TITLE_SUMMARY_MAX_CHARS]
        response = await app.llmhubs.generate(
            app.llmhubs.Request(
                model=model or "",
                instructions=render_prompt_file(PromptFile.SESSION_TITLE),
                inputs=[
                    app.llmhubs.Input(
                        role="user",
                        content=[app.llmhubs.InputContent(type="text", text=transcript)],
                    )
                ],
            )
        )
        return self._normalize_generated_title(self._extract_generated_title(response))

    @staticmethod
    def _extract_generated_title(response: app.llmhubs.Response) -> str:
        for output in response.outputs:
            if output.json and output.json.get("title"):
                return str(output.json["title"])
            if output.text:
                return output.text
        return ""

    @staticmethod
    def _normalize_generated_title(title: str) -> str:
        title = title.strip()
        match = _JSON_FENCE_PATTERN.match(title)
        if match:
            title = match.group(1).strip()
        if title.startswith("{"):
            try:
                parsed = json.loads(title)
                if isinstance(parsed, dict) and parsed.get("title"):
                    title = str(parsed["title"])
            except json.JSONDecodeError:
                pass
        title = title.strip().strip('"\'`').strip()
        title = re.sub(r"\s+", " ", title).strip()
        if not title:
            return ""
        title = title.splitlines()[0].strip()
        title_runes = list(title)
        if len(title_runes) > _TITLE_SUMMARY_MAX_LENGTH:
            title = "".join(title_runes[:_TITLE_SUMMARY_MAX_LENGTH]).strip()
        return title

    async def _send_keepalive_loop(self, chat_request: ChatRequest) -> None:
        import app.schemas.conversation.chat as chat_schemas

        while True:
            await asyncio.sleep(KEEPALIVE_INTERVAL_SECONDS)

            resp = ChatResponse(
                content=ChatContent(type=ChatContentType.KEEPALIVE),
                timestamp=self._current_timestamp_ms(),
                is_final=False,
                is_internal=True,
            )
            topic_message = TopicMessage(
                conversation_id=chat_request.conversation_id,
                turn_id=chat_request.turn_id,
                seq=0,
                chat_response=chat_schemas.ChatResponse.from_pb(resp),
            )
            await self._send_message_to_event_bus(topic_message)

    async def _yield_response(
        self,
        chat_request: ChatRequest,
        redis_client,
        cache_key: _CacheKeyForOngoingChatTurn,
        sequence_id: int,
        chat_message: ChatResponse,
    ) -> None:
        await self._persist_chat_response(
            conversation_id=chat_request.conversation_id,
            username=chat_request.username,
            agent_instance_id=chat_request.agent_instance_id,
            turn_id=chat_request.turn_id,
            resp=chat_message,
        )

        import app.schemas.conversation.chat as chat_schemas

        topic_message = TopicMessage(
            conversation_id=chat_request.conversation_id,
            turn_id=chat_request.turn_id,
            seq=sequence_id,
            chat_response=chat_schemas.ChatResponse.from_pb(chat_message),
        )

        # add to cache for ongoing chat retrieval
        await redis_client.rpush(
            cache_key.chat_responses_cache_key,
            topic_message.model_dump_json(by_alias=True, exclude_none=True),
        )
        await redis_client.expire(
            cache_key.chat_responses_cache_key,
            ONGOING_CHAT_CACHE_TIME_TO_LIVE,
        )

        await self._send_message_to_event_bus(topic_message)

        if sequence_id == 1 or chat_message.is_final:
            self._logger.info(
                "chat_stream_response_emitted conversation_id=%s turn_id=%s seq=%s content_type=%s is_final=%s is_internal=%s",
                chat_request.conversation_id,
                chat_request.turn_id,
                sequence_id,
                chat_message.content.type.name,
                chat_message.is_final,
                chat_message.is_internal,
            )

    async def _drain_response_queue(
        self,
        response_queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None],
        yield_response,
        chat_request: ChatRequest,
    ) -> None:
        accumulated_text: Content = Content.from_text("")
        while True:
            update = await response_queue.get()
            if update is None:
                break
            if isinstance(update, ChatResponse):
                await yield_response(update)
                continue
            if isinstance(update, ChatResponseUpdate):
                parts, accumulated_text = self._extract_parts_from_update(update, accumulated_text, chat_request)
                accumulated_text = await self._yield_parts(parts, accumulated_text, yield_response)

        # Flush any remaining accumulated text response.
        # Use a try/finally to guarantee the END event is always sent, even if
        # the DB persist for the accumulated text fails or hangs.
        try:
            if accumulated_text.text:
                await yield_response(
                    self._build_chat_response(
                        self._build_text_content(accumulated_text.text),
                        is_final=False,
                        is_internal=True,
                    )
                )
        except Exception:
            self._logger.exception(
                "chat_drain_accumulated_text_persist_failed conversation_id=%s turn_id=%s",
                chat_request.conversation_id,
                chat_request.turn_id,
            )
        finally:
            await yield_response(self._build_chat_response(self._build_end_content(), is_final=True, is_internal=False))

    def _extract_parts_from_update(
        self,
        update: ChatResponseUpdate,
        accumulated_text: Content,
        chat_request: ChatRequest,
    ) -> tuple[list[ChatContent], Content]:
        parts: list[ChatContent] = []
        for content in update.contents or []:
            # FunctionCallContent and FunctionResultContent are handled elsewhere.
            if content.type in ("function_call", "function_result"):
                continue
            if content.type == "text":
                chunk = content.text or ""
                if not chunk:
                    continue
                accumulated_text += content
                parts.append(self._build_text_content(chunk))
            else:
                self._logger.debug(
                    "chat_stream_non_visible_content_skipped conversation_id=%s turn_id=%s content_type=%s",
                    chat_request.conversation_id,
                    chat_request.turn_id,
                    content.type,
                )
        return parts, accumulated_text

    async def _yield_parts(
        self,
        parts: list[ChatContent],
        accumulated_text: Content,
        yield_response,
    ) -> Content:
        for part in parts:
            if part.type != ChatContentType.TEXT and accumulated_text.text:
                # Flush accumulated text response before yielding non-text content
                await yield_response(
                    self._build_chat_response(
                        self._build_text_content(accumulated_text.text),
                        is_final=False,
                        is_internal=True,
                    )
                )
                accumulated_text = Content.from_text("")
            await yield_response(self._build_chat_response(part, is_final=False, is_internal=False))
        return accumulated_text

    async def get_plan(self, request: GetPlanRequest) -> GetPlanResponse:
        try:
            plan = await read_plan(
                agent_instance_id=request.agent_instance_id,
                turn_id=request.turn_id,
                conversation_id=request.conversation_id,
                username=request.username,
            )
        except Exception as exc:
            self._logger.warning("get_plan failed (possibly partial write): %s", exc)
            return error_response(GetPlanResponse(), 1, str(exc))
        status = PlanStatus.NO_PLAN if plan is None else plan.get_plan_status_from_step_status()

        return success_response(GetPlanResponse(GetPlanData(plan=plan.to_pb() if plan else None, status=status.to_pb())))

    async def cancel_plan(self, request: CancelPlanRequest) -> CancelPlanResponse:
        await cancel_plan_async(
            agent_instance_id=request.agent_instance_id,
            turn_id=request.turn_id,
            conversation_id=request.conversation_id,
            username=request.username,
        )
        try:
            from app.biz.task_runtime.manager import cancel_turn_task_runtime_once

            plan_editor = PlanEditor(
                agent_instance_id=request.agent_instance_id,
                turn_id=request.turn_id,
                conversation_id=request.conversation_id,
                username=request.username,
            )
            cancelled_count = await cancel_turn_task_runtime_once(
                ToolContext(
                    username=request.username,
                    agent_id="",
                    agent_instance_id=request.agent_instance_id or None,
                    turn_id=request.turn_id,
                    project_id=0,
                    conversation_id=request.conversation_id,
                    response_queue=asyncio.Queue(),
                    plan_editor=plan_editor,
                )
            )
            if cancelled_count:
                self._logger.info(
                    "cancel_plan_task_runtime_cancelled conversation_id=%s turn_id=%s batch_count=%s",
                    request.conversation_id,
                    request.turn_id,
                    cancelled_count,
                )
        except Exception:
            self._logger.warning(
                "cancel_plan_task_runtime_cleanup_failed conversation_id=%s turn_id=%s",
                request.conversation_id,
                request.turn_id,
                exc_info=True,
            )
        return success_response(CancelPlanResponse())

    async def generate_onboard_recommendation_tasks(
        self, request: GenerateOnboardRecommendationTasksRequest
    ) -> GenerateOnboardRecommendationTasksResponse:
        from app.llmhubs.request_builder import build_llm_request
        from app.schemas.conversation.api import RecommendationTasks

        workspace_context = get_skill_knowledge_context(
            request.project_id,
            request.agent_id,
            retrieve_knowledge_summary=True,
        )
        prompt = render_prompt_file(
            PromptFile.RECOMMENDATION_TASK,
            fallback="",
            knowledge_list=json.dumps(workspace_context.get("knowledge", []), ensure_ascii=False, indent=2),
            skills_list=json.dumps(workspace_context.get("skills", []), ensure_ascii=False, indent=2),
        )
        self._logger.info(
            "onboard_recommendation_context_ready project_id=%s agent_id=%s knowledge_count=%d skill_count=%d",
            request.project_id,
            request.agent_id,
            len(workspace_context.get("knowledge", [])),
            len(workspace_context.get("skills", [])),
        )
        generation = await app.llmhubs.generate(
            request=build_llm_request(
                [
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": prompt}],
                    }
                ],
                response_format=RecommendationTasks,
            )
        )
        text = (generation.outputs[0].text if generation.outputs else "") or ""
        self._logger.debug("onboard_recommendation_llm_response preview=%s", _text_preview(text))
        try:
            json_object = _load_recommendation_tasks_json(text or "")
            outputs = RecommendationTasks.model_validate(json_object)
            return success_response(outputs.to_pb())
        except json.JSONDecodeError as exc:
            self._logger.warning("Failed to decode JSON from LLM response: %s. Response preview: %s", exc, _text_preview(text))
            return error_response(GenerateOnboardRecommendationTasksResponse(), 1, "Failed to decode LLM response")
        except pydantic.ValidationError as exc:
            self._logger.warning(
                "Failed to validate LLM response with Pydantic model: %s. Response preview: %s", exc, _text_preview(text)
            )
            return error_response(GenerateOnboardRecommendationTasksResponse(), 1, "Failed to validate LLM response")

    async def _persist_chat_response(
        self, conversation_id: int, username: str, agent_instance_id: int, turn_id: int, resp: ChatResponse
    ):
        content = resp.content
        if content is None:
            return
        if content.type == ChatContentType.TEXT and content.content == "":
            return
        if resp.is_final and content.type == ChatContentType.END:
            return
        if not resp.is_internal and content.type not in {
            ChatContentType.TRAIN_CONTEXT,
            ChatContentType.FUNCTION_CALL,
            ChatContentType.FUNCTION_RESULT,
            ChatContentType.PLAN,
            ChatContentType.ERROR,
        }:
            return

        # construct message entity
        message = app.schemas.conversation.Message(
            turn_id=turn_id,
            conversation_id=conversation_id,
            username=username,
            agent_instance_id=agent_instance_id,
            role="assistant",
            content_type=content.type,
            content=content.content or "",
            function_context=content.function_context or FunctionContext(),
            created_at=resp.timestamp,
            updated_at=resp.timestamp,
        )

        # persist message via reverse gRPC (run in thread to avoid blocking the event loop)
        from app.biz.reverse_grpc.conversation import ReverseConversationService

        conversation_service = ReverseConversationService.get_instance()
        try:
            await asyncio.to_thread(conversation_service.create_message, message)
        except Exception:
            self._logger.exception(
                "chat_response_persist_failed conversation_id=%s turn_id=%s "
                "agent_instance_id=%s content_type=%s is_internal=%s is_final=%s",
                conversation_id,
                turn_id,
                agent_instance_id,
                content.type.name,
                resp.is_internal,
                resp.is_final,
            )
            raise

    async def _build_user_message(
        self,
        chat_request: ChatRequest,
    ) -> Message:
        """Compatibility wrapper: build the downstream chat agent user message."""
        return await asyncio.to_thread(self._build_user_message_from_sections, chat_request)

    def _build_user_message_from_sections(
        self,
        chat_request: ChatRequest,
    ) -> Message:
        msg = chat_request.message.content or ""
        if chat_request.message.attachments:
            attachment_names = ", ".join(att.name for att in chat_request.message.attachments)
            msg += f"\nMy Attachments: {attachment_names}"
        self._logger.info(
            "chat_user_message_build conversation_id=%s turn_id=%s text_len=%d attachment_count=%d",
            chat_request.conversation_id,
            chat_request.turn_id,
            len(msg),
            len(chat_request.message.attachments),
        )
        return self._build_user_message_with_images(message=msg, attachments=chat_request.message.attachments)

    def _build_context_sections(self, chat_request: ChatRequest, skill_loader: SkillLoader) -> dict[str, str]:
        """Render all reusable context sections; safe to call multiple times."""
        sections: dict[str, str] = {
            "workspace_attachments": self._build_workspace_attachments_section(
                chat_request.agent_instance_id, chat_request.username, chat_request.conversation_id
            ),
            "workspace_knowledge": self._build_workspace_knowledge_section(
                chat_request.agent_instance_id, chat_request.username, chat_request.conversation_id
            ),
            "prior_rerun_sources": self._build_prior_rerun_sources_section(
                chat_request.agent_instance_id, chat_request.username, chat_request.conversation_id
            ),
            "skills": skill_loader.render_cards_section(),
        }
        try:
            workspace = CHAT_FS.get_workspace_path(
                chat_request.agent_instance_id,
                chat_request.username,
                chat_request.conversation_id,
            )
            adapter_sections = collect_prompt_sections(PromptSectionContext(chat_request=chat_request, workspace=workspace))
        except Exception as exc:
            self._logger.warning("Failed to collect adapter prompt sections: %s", exc)
            adapter_sections = {}
        for name, value in adapter_sections.items():
            if value:
                sections[name] = value
        return sections

    def _build_prior_conversation_section(self, chat_request: ChatRequest) -> str:
        try:
            return _build_prior_conversation_section(
                agent_instance_id=chat_request.agent_instance_id,
                username=chat_request.username,
                conversation_id=chat_request.conversation_id,
                current_turn_id=chat_request.turn_id,
            )
        except Exception as exc:
            self._logger.warning("Failed to build prior conversation section: %s", exc)
            return ""

    def _direct_tool_excerpts(self) -> list[ToolExcerpt]:
        # A compact list of frequently-used tools so the intent LLM can choose
        # between the INSPECT and TASK routes. The chat agent later receives the
        # full tool list selected by the route.
        # TODO: command execution is no longer a main-loop tool; it is unified
        # under the task runtime (TaskManager.submit_prepared -> command_backend).
        tools = [
            CONTEXT_TOOL,
            READ_TOOL,
            GREP_TOOL,
            WRITE_FILE_TOOL,
            EDIT_TOOL,
            REMOVE_TOOL,
            REPORT_TOOL,
        ]
        return [ToolExcerpt.from_agent_framework_function_tool(t) for t in tools]

    def _build_skills_section(self, agent_instance_id: int, username: str, conversation_id: int = 0) -> str:
        """Read skills/index.json from workspace and format as a skills list."""
        try:
            workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
            skills_index = workspace / "skills" / "index.json"
            if not skills_index.exists():
                return ""
            loaded = json.loads(skills_index.read_text(encoding="utf-8"))
            if not isinstance(loaded, list) or not loaded:
                return ""
            lines = ["These are the skills you can use:\n"]
            for skill in loaded:
                name = skill.get("name", "")
                description = skill.get("description", "")
                if name:
                    lines.append(f"- name: {name}")
                    lines.append(f"  description: {description}")
            return "\n".join(lines) if len(lines) > 1 else ""
        except Exception as exc:
            self._logger.warning("Failed to build skills section: %s", exc)
            return ""

    def _build_capability_cards_section(
        self,
        agent_instance_id: int,
        username: str,
        *,
        project_id: int = 0,
        agent_id: str = "",
        conversation_id: int = 0,
    ) -> str:
        try:
            workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
            section = SkillLoader(workspace, project_id=project_id, agent_id=agent_id).render_cards_section()
            if section:
                return section
            return self._build_skills_section(agent_instance_id, username, conversation_id)
        except Exception as exc:
            self._logger.warning("Failed to build capability cards section: %s", exc)
            return self._build_skills_section(agent_instance_id, username, conversation_id)

    def _build_workspace_attachments_section(self, agent_instance_id: int, username: str, conversation_id: int) -> str:
        try:
            workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
            index_path = workspace / "attachments" / "index.json"
            if not index_path.exists():
                return ""
            loaded = json.loads(index_path.read_text(encoding="utf-8"))
            if not isinstance(loaded, list) or not loaded:
                return ""
            lines = ["Workspace attachments available:"]
            for item in loaded:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "")
                path = str(item.get("path") or "")
                if not name or not path:
                    continue
                lines.append(f"- {name}: {path}")
            return "\n".join(lines) if len(lines) > 1 else ""
        except Exception as exc:
            self._logger.warning("Failed to build workspace attachments section: %s", exc)
            return ""

    def _build_workspace_knowledge_section(self, agent_instance_id: int, username: str, conversation_id: int) -> str:
        try:
            workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
            knowledge_dir = workspace / "knowledge"
            index_path = knowledge_dir / "index.json"
            if not index_path.exists():
                return ""
            loaded = json.loads(index_path.read_text(encoding="utf-8"))
            if not isinstance(loaded, list) or not loaded:
                return ""
            lines = ["Workspace project knowledge available:"]
            for item in loaded[:8]:
                if not isinstance(item, dict):
                    continue
                knowledge_id = str(item.get("id") or "")
                name = str(item.get("name") or knowledge_id)
                knowledge_type = str(item.get("type") or "")
                if not knowledge_id:
                    continue
                label = f"{name} ({knowledge_type})" if knowledge_type else name
                lines.append(f"- {label}: knowledge/{knowledge_id}")
            workbook_paths = _workspace_knowledge_workbook_paths(workspace)
            if workbook_paths:
                lines.append("Knowledge workbook sources available for delegate kind=workbook:")
                for path in workbook_paths[:8]:
                    lines.append(f"- {path}")
            return "\n".join(lines) if len(lines) > 1 else ""
        except Exception as exc:
            self._logger.warning("Failed to build workspace knowledge section: %s", exc)
            return ""

    def _build_prior_rerun_sources_section(self, agent_instance_id: int, username: str, conversation_id: int = 0) -> str:
        try:
            workspace = CHAT_FS.get_workspace_path(agent_instance_id, username, conversation_id)
            sources = _load_prior_rerun_sources(workspace)
            if not sources:
                return ""
            lines = [
                "Prior delegated task sources available for repeat or referenced execution requests (newest first):",
                "Use the newest matching source before parsing older attachments.",
            ]
            for source in sources[:3]:
                lines.extend(_format_prior_rerun_source(source))
            return "\n".join(lines)
        except Exception as exc:
            self._logger.warning("Failed to build prior rerun sources section: %s", exc)
            return ""

    def _build_chat_response(self, content: ChatContent, *, is_final: bool, is_internal: bool) -> ChatResponse:
        return ChatResponse(
            content=content,
            timestamp=self._current_timestamp_ms(),
            is_final=is_final,
            is_internal=is_internal,
        )

    def _build_end_content(self) -> ChatContent:
        return ChatContent(type=ChatContentType.END)

    def _build_text_content(self, text: str) -> ChatContent:
        return ChatContent(
            type=ChatContentType.TEXT,
            content=text,
        )

    @staticmethod
    def _current_timestamp_ms() -> int:
        return int(datetime.now(UTC).timestamp() * 1000)

    @staticmethod
    def _build_intent_attachments(attachments: list[Attachment]) -> list[SchemaAttachment]:
        return [
            attachment if isinstance(attachment, SchemaAttachment) else SchemaAttachment.from_pb(attachment)
            for attachment in attachments
        ]

    def _build_user_message_with_images(self, message: str, attachments: list[Attachment]) -> Message:
        image_contents = self._build_image_contents(attachments)
        contents = [Content.from_text(message), *image_contents]
        return Message(role="user", contents=contents)

    def _build_image_contents(self, attachments: list[Attachment]) -> list[Content]:
        if not attachments:
            return []

        contents: list[Content] = []
        for attachment in attachments:
            attachment_type = str(attachment.type or "").lower()
            if not attachment_type.startswith("image"):
                continue
            link = attachment.sas_url or attachment.uri
            if not link:
                continue
            link_str = str(link)
            media_type = self._resolve_image_media_type(attachment_type, attachment.name or link_str)
            if "seaweedfs-filer" in link_str:
                content = self._fetch_image_as_base64_content(link_str, media_type)
                if content is not None:
                    contents.append(content)
            else:
                contents.append(Content.from_uri(uri=link_str, media_type=media_type))

        self._logger.debug("chat_image_contents_built count=%d", len(contents))
        return contents

    @staticmethod
    def _resolve_image_media_type(declared_type: str, filename: str) -> str:
        """Ensure the media type is a valid image MIME type (e.g. image/png)."""
        if "/" in declared_type and declared_type != "image":
            return declared_type

        import mimetypes

        guessed, _ = mimetypes.guess_type(filename)
        if guessed and guessed.startswith("image/"):
            return guessed
        return "image/png"

    def _fetch_image_as_base64_content(self, url: str, media_type: str) -> Content | None:
        """Fetch an image from an internal URL and return it as base64-encoded Content."""
        import base64
        import requests

        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            b64 = base64.b64encode(resp.content).decode("ascii")
            data_uri = f"data:{media_type};base64,{b64}"
            return Content.from_uri(uri=data_uri, media_type=media_type)
        except Exception as exc:
            self._logger.warning("Failed to fetch internal image %s: %s", url, exc)
            return None

    def _summarize_non_image_attachments(self, attachments: list[Attachment] | None) -> str:
        if not attachments:
            return ""
        summary: list[str] = []
        for attachment in attachments:
            if attachment.type.lower().startswith("image"):
                continue
            summary += [
                "",
                f"Attachment name: {attachment.name}",
                f"Attachment type: {attachment.type}",
                f"Attachment uri: {attachment.sas_url or attachment.uri}",
                "",
            ]
        return "\n".join(summary)

    async def _ensure_event_bus_sender(self):
        if self._event_bus_sender is not None:
            return
        event_bus = EventBus.get_instance()
        self._event_bus_sender = event_bus.get_topic_sender(self._event_bus_topic_name)

    async def _send_message_to_event_bus(self, topic_message: TopicMessage):
        try:
            await self._ensure_event_bus_sender()
            payload = topic_message.model_dump_json(by_alias=True, exclude_none=True, exclude_defaults=True, exclude_unset=True)
            self._logger.debug(
                "chat_event_bus_publish conversation_id=%s turn_id=%s seq=%s content_type=%s is_final=%s",
                topic_message.conversation_id,
                topic_message.turn_id,
                topic_message.seq,
                topic_message.chat_response.content.type,
                topic_message.chat_response.is_final,
            )
            await self._event_bus_sender.send(bytes(payload, encoding="utf-8"))
        except Exception:
            self._logger.warning(
                "chat_event_bus_publish_failed conversation_id=%s turn_id=%s seq=%s content_type=%s is_final=%s",
                topic_message.conversation_id,
                topic_message.turn_id,
                topic_message.seq,
                topic_message.chat_response.content.type.name,
                topic_message.chat_response.is_final,
                exc_info=True,
            )


class _CacheKeyForOngoingChatTurn(BaseModel):
    turn_id_cache_key: str
    chat_responses_cache_key: str


def _get_ongoing_chat_cache_key(conversation_id: int, turn_id: int) -> _CacheKeyForOngoingChatTurn:
    return _CacheKeyForOngoingChatTurn(
        turn_id_cache_key=f"ongoing-chat:conversation:{conversation_id}",
        chat_responses_cache_key=f"ongoing-chat:conversation:{conversation_id}:turn:{turn_id}",
    )


def _prompt_mode_for_route(route: ChatRouteMode) -> str:
    if route == ChatRouteMode.FAST:
        return "fast"
    if route == ChatRouteMode.INSPECT:
        return "inspect"
    return "task"


def _model_for_route(route: ChatRouteMode, requested_model: str | None) -> str | None:
    if route == ChatRouteMode.FAST:
        fast_model = os.getenv(_FAST_MODEL_ENV, "").strip()
        if fast_model:
            return fast_model
    return requested_model


def _load_prior_rerun_sources(workspace: Path) -> list[dict[str, Any]]:
    history_dir = workspace / "history"
    if not history_dir.exists():
        return []
    sources: list[dict[str, Any]] = []
    for turn_dir in sorted(history_dir.glob("turn-*"), key=_history_turn_sort_key, reverse=True):
        source_dir = turn_dir / RERUN_SOURCES_DIR
        if not source_dir.exists():
            continue
        for source_path in sorted(source_dir.glob("*.json"), reverse=True):
            source = _load_prior_rerun_source(source_path, workspace)
            if source:
                sources.append(source)
    return sorted(sources, key=_prior_rerun_source_sort_key, reverse=True)


def _workspace_knowledge_workbook_paths(workspace: Path) -> list[str]:
    knowledge_dir = workspace / "knowledge"
    if not knowledge_dir.exists():
        return []
    suffixes = {".xlsx", ".xlsm", ".csv"}
    paths: list[str] = []
    for path in sorted(knowledge_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in suffixes:
            paths.append(path.relative_to(workspace).as_posix())
    return paths


def _history_turn_sort_key(path: Path) -> int:
    try:
        return int(path.name.removeprefix("turn-"))
    except ValueError:
        return -1


def _load_prior_rerun_source(source_path: Path, workspace: Path) -> dict[str, Any] | None:
    try:
        loaded = json.loads(source_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(loaded, dict) or not isinstance(loaded.get("tasks"), list) or not loaded["tasks"]:
        return None
    loaded = compact_rerun_source_payload(loaded)
    loaded["workspace_path"] = source_path.relative_to(workspace).as_posix()
    return loaded


def _prior_rerun_source_sort_key(source: dict[str, Any]) -> tuple[int, int]:
    return (_safe_int(source.get("turn_id"), -1), _safe_int(source.get("created_at"), 0))


def _safe_int(value: object, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _format_prior_rerun_source(source: dict[str, Any]) -> list[str]:
    turn_id = source.get("turn_id") or "unknown"
    batch_id = source.get("batch_id") or "unknown"
    task_count = source.get("task_count") or len(source.get("tasks") or [])
    path = source.get("workspace_path") or ""
    lines = [
        f"- turn {turn_id}, batch {batch_id}: {task_count} delegated task(s); source: {path}",
        f"  reason: {source.get('reason') or ''}",
    ]
    lines.append(f"  task titles: {_prior_rerun_task_titles(source)}")
    inline_payload = _inline_prior_rerun_payload(source)
    if inline_payload:
        lines.append("  Use rerun_input_json directly; do not read the source JSON unless this payload is missing.")
        lines.append(f"  rerun_input_json: {inline_payload}")
    else:
        lines.append("  Read the source JSON path above to recover the full TaskSpec list before delegating.")
    return lines


def _prior_rerun_task_titles(source: dict[str, Any], *, limit: int = 8) -> str:
    titles = [str(task.get("title") or task.get("task_id") or "") for task in source.get("tasks") or [] if isinstance(task, dict)]
    shown = [title for title in titles if title][:limit]
    suffix = f"; +{len(titles) - limit} more" if len(titles) > limit else ""
    return "; ".join(shown) + suffix if shown else "unknown"


def _inline_prior_rerun_payload(source: dict[str, Any], *, max_chars: int = RERUN_SOURCE_INLINE_MAX_CHARS) -> str:
    payload = {
        "reason": source.get("reason") or "rerun previous delegated tests",
        "join_strategy": source.get("join_strategy") or "partial_ok",
        "tasks": source.get("tasks") or [],
    }
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return serialized if len(serialized) <= max_chars else ""
