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
from datetime import UTC, datetime

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
from app.biz.chat.chat import build_error_response
from app.biz.chat.workspace_init import init_workspace
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
    GenerateOnboardRecommendationTasksData,
    GenerateOnboardRecommendationTasksRequest,
    GenerateOnboardRecommendationTasksResponse,
)
import app.llmhubs
from app.pb.common.common import Attachment
from app.schemas.conversation.chat import TopicMessage
from app.schemas.conversation.plan import Plan, PlanStatus
from app.storage import redis
from app.storage.fs import CHAT_FS
from app.tools import BUILTIN_TOOLS
from app.tools.common import ToolContext
from app.tools.plan import PlanEditor, read_plan
from app.tools.plan import cancel_plan as cancel_plan_async
from app.tools.sandbox_tools import SANDBOX_LIFECYCLE_TOOLS
from app.utils.eventbus import EventBus
from app.utils.response import error_response, success_response
from app.utils.runner import AsyncJobRunner

from .chat import RunOptions, build_agent
from .prompt import compose_system_prompt, PromptFile
from .context import get_skill_knowledge_context

ONGOING_CHAT_CACHE_TIME_TO_LIVE = 3 * 24 * 60 * 60  # 3 days
KEEPALIVE_INTERVAL_SECONDS = 5


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

    async def stream_chat(self, chat_request: ChatRequest) -> ChatDirectResponse:
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

        system_message = compose_system_prompt(
            PromptFile.SYSTEM,
            name=chat_request.agent_instance_name or "",
            role_name=chat_request.agent_role or "",
            project_name=chat_request.project_name or "",
            sico_port=os.getenv("SICO_PORT", "8080"),
        )

        async def on_plan_update(plan: Plan):
            # we only notify that there is a plan (or plan update)
            # but don't need to send the actual plan because
            # the frontend will poll the plan content automatically.
            chat_content = ChatContent(
                type=ChatContentType.PLAN,
            )
            await response_queue.put(
                self._build_chat_response(
                    chat_content,
                    is_final=False,
                    is_internal=False,
                )
            )

        plan_editor = PlanEditor(
            agent_instance_id=chat_request.agent_instance_id,
            turn_id=chat_request.turn_id,
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
        )

        agent = await build_agent(
            chat_request.username,
            chat_request.agent_id,
            chat_request.agent_instance_id,
            self._mem_runner,
            tool_context=tool_context,
            model=chat_request.model or None,
        )

        # Initialize workspace: copy skills, knowledge, history, attachments
        await init_workspace(
            agent_instance_id=chat_request.agent_instance_id,
            username=chat_request.username,
            turn_id=chat_request.turn_id,
            project_id=chat_request.project_id,
            agent_id=chat_request.agent_id,
            attachments=chat_request.message.attachments + chat_request.agent_attachments,
        )

        user_message = await self._build_user_message(chat_request)

        all_tools = BUILTIN_TOOLS + SANDBOX_LIFECYCLE_TOOLS
        tool_context.all_tools = all_tools

        sequence_id = 0

        async def yield_response(chat_message: ChatResponse):
            nonlocal sequence_id
            sequence_id += 1
            await self._yield_response(chat_request, redis_client, cache_key, sequence_id, chat_message)

        # start a background task to run the agent and put updates into the queue
        await self._stream_chat_runner.submit(
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
        )

        try:
            await self._drain_response_queue(response_queue, yield_response, chat_request)
            self._logger.info(
                "chat_stream_completed conversation_id=%s turn_id=%s emitted_seq_count=%d",
                chat_request.conversation_id,
                chat_request.turn_id,
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
            await clear_ongoing_chat_cache()
            send_keepalive_task.cancel()

        # Trigger experience playbook ingestion in the background (fire-and-forget)
        asyncio.ensure_future(
            self._try_experience_playbook_ingestion(
                agent_instance_id=chat_request.agent_instance_id,
                username=chat_request.username,
                turn_id=chat_request.turn_id,
                project_id=chat_request.project_id,
                conversation_id=chat_request.conversation_id,
            )
        )

        return ChatDirectResponse()

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

        # Flush any remaining accumulated text response
        if accumulated_text.text:
            await yield_response(
                self._build_chat_response(
                    self._build_text_content(accumulated_text.text),
                    is_final=False,
                    is_internal=True,
                )
            )
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

    async def _try_experience_playbook_ingestion(
        self,
        *,
        agent_instance_id: int,
        username: str,
        turn_id: int,
        project_id: int,
        conversation_id: int,
    ) -> None:
        """Run experience playbook ingestion from the conversation after chat finishes."""
        from app.experiences.service import EXPERIENCES_ENABLED

        if not EXPERIENCES_ENABLED:
            return

        if not agent_instance_id or not project_id:
            self._logger.warning(
                "Skipping experience ingestion: missing agent_instance_id=%s or project_id=%s",
                agent_instance_id,
                project_id,
            )
            return

        try:
            plan = await read_plan(
                agent_instance_id=agent_instance_id,
                turn_id=turn_id,
                username=username,
            )
            if plan is None:
                self._logger.info("No plan for turn %s, skipping experience ingestion", turn_id)
                return

            conversation_json = await asyncio.to_thread(
                CHAT_FS.read_conversation,
                agent_instance_id,
                username,
                turn_id,
            )
            if not conversation_json:
                self._logger.warning("No conversation.json for turn %s, skipping experience ingestion", turn_id)
                return

            from app.experiences.adapter import convert_to_trajectory_data
            from app.experiences.service import add_playbook

            trajectory = await convert_to_trajectory_data(conversation_json)
            if trajectory is None:
                self._logger.info("No trajectory found in conversation for turn %s, skipping experience ingestion", turn_id)
                return

            self._logger.info(
                "Experience playbook ingestion from chat: agent_instance=%s turn=%s task=%s steps=%s success=%s",
                agent_instance_id,
                turn_id,
                trajectory.task[:80],
                trajectory.total_steps,
                trajectory.success,
            )

            result = await add_playbook(
                trajectory_data=trajectory,
                project_id=project_id,
                agent_instance_id=agent_instance_id,
                conversation_id=conversation_id,
                turn_id=turn_id,
            )
            self._logger.info("Experience playbook ingestion result: %s", result)
        except Exception:
            self._logger.exception(
                "Experience playbook ingestion failed for agent_instance=%s turn=%s",
                agent_instance_id,
                turn_id,
            )

    async def get_plan(self, request: GetPlanRequest) -> GetPlanResponse:
        try:
            plan = await read_plan(
                agent_instance_id=request.agent_instance_id,
                turn_id=request.turn_id,
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
            username=request.username,
        )
        return success_response(CancelPlanResponse())


    async def generate_onboard_recommendation_tasks(
        self,
        request: GenerateOnboardRecommendationTasksRequest
    ) -> GenerateOnboardRecommendationTasksResponse:
        from app.llmhubs.request_builder import build_llm_request
        from app.schemas.conversation.api import RecommendationTasks
        workspace_context = get_skill_knowledge_context(
            request.project_id,
            request.agent_id,
            retrieve_knowledge_summary=True,
        )
        prompt = compose_system_prompt(
            PromptFile.RECOMMENDATION_TASK,
            knowledge_list=json.dumps(workspace_context.get("knowledge", []), ensure_ascii=False, indent=2),
            skills_list=json.dumps(workspace_context.get("skills", []), ensure_ascii=False, indent=2),
        )
        print(prompt)
        generation = await app.llmhubs.generate(request=build_llm_request(
            [{
                "role": "user",
                "content": [{"type": "text", "text": prompt}],
            }],
            response_format=RecommendationTasks,
        ))
        text = generation.outputs[0].text or ""
        try:
            json_object = json.loads(text)
            outputs = RecommendationTasks.model_validate(json_object)
            return success_response(GenerateOnboardRecommendationTasksResponse(
                data=GenerateOnboardRecommendationTasksData(
                    tasks=[a.to_pb() for a in outputs.tasks]
                )
            ))
        except json.JSONDecodeError as exc:
            self._logger.warning("Failed to decode JSON from LLM response: %s. Response text: %s", exc, text)
            return error_response(GenerateOnboardRecommendationTasksResponse(), 1, "Failed to decode LLM response")
        except pydantic.ValidationError as exc:
            self._logger.warning("Failed to validate LLM response with Pydantic model: %s. Response text: %s", exc, text)
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

        # persist message
        from app.biz.reverse_grpc.conversation import ReverseConversationService

        conversation_service = ReverseConversationService.get_instance()
        try:
            _ = conversation_service.create_message(message)
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

    async def _build_user_message(self, chat_request: ChatRequest) -> Message:
        msg = chat_request.message.content

        if chat_request.message.attachments:
            attachment_names = ", ".join(att.name for att in chat_request.message.attachments)
            msg += f"\nMy Attachments: {attachment_names}"

        # Append available skills
        skills_section = self._build_skills_section(chat_request.agent_instance_id, chat_request.username)
        if skills_section:
            msg += f"\n\n{skills_section}"

        self._logger.info(
            "chat_user_message_build conversation_id=%s turn_id=%s text_len=%d attachment_count=%d msg=%s",
            chat_request.conversation_id,
            chat_request.turn_id,
            len(msg),
            len(chat_request.message.attachments),
            msg,
        )

        # Only include image attachments in the user message so that the LLM is not confused
        return self._build_user_message_with_images(
            message=msg,
            attachments=chat_request.message.attachments,
        )

    def _build_skills_section(self, agent_instance_id: int, username: str) -> str:
        """Read skills/index.json from workspace and format as a skills list."""
        try:
            workspace = CHAT_FS.get_workspace_path(agent_instance_id, username)
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
            self._logger.debug("sending payload=%s", payload)
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
