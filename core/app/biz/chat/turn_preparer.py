"""Preparation of a fully bound main-chat turn."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from app.biz.chat.preparation import CapabilityRetriever, WorkspaceCapabilityCatalogue, build_default_preparation_service
from app.biz.chat.prompt import compose_system_prompt
from app.biz.chat.router import ChatRouteRequest, default_chat_router
from app.biz.chat.tool_registry import default_tool_registry
from app.biz.chat.turn import PreparedChatTurn
from app.biz.chat.turn_timing import TurnTimings, time_awaitable, time_sync
from app.biz.chat.types import ChatIntentCheckerInput, ChatRouteMode, ToolExcerpt
from app.biz.chat.workspace_init import WorkspaceInitOptions
from app.biz.llm.service import _model_definition_to_entry
from app.biz.task_runtime import default_agent_profile_resolver
from app.biz.task_runtime.capabilities.loader import SkillLoader
from app.biz.task_runtime.planning import ProfileQuery, ResolveContext, render_sandbox_delegation_section
from app.pb.conversation.api import ChatRequest
from app.storage.fs import CHAT_FS
from app.tools.capability_catalogue import build_capability_catalogue_tool
from app.tools.common import ToolContext
from app.tools.delegate import build_delegate_tool

_FAST_MODEL_ENV = "FAST_MODEL"


class ChatPreparationHost(Protocol):
    def _build_prior_conversation_section(self, chat_request: ChatRequest) -> str: ...

    def _direct_tool_excerpts(self) -> list[ToolExcerpt]: ...

    def _build_context_sections(
        self,
        chat_request: ChatRequest,
        skill_loader: SkillLoader,
        *,
        assigned_sandbox_types: frozenset[str],
    ) -> dict[str, str]: ...

    def _build_user_message_from_sections(
        self,
        chat_request: ChatRequest,
        context_sections: dict[str, str],
    ) -> Any: ...


class ChatTurnPreparer:
    """Build workspace context, route, prompt, tools, and the main agent."""

    def __init__(
        self,
        *,
        host: ChatPreparationHost,
        mem_runner: Any,
        init_workspace: Callable[..., Awaitable[None]],
        build_agent: Callable[..., Awaitable[Any]],
    ) -> None:
        self._host = host
        self._mem_runner = mem_runner
        self._init_workspace = init_workspace
        self._build_agent = build_agent
        self._logger = logging.getLogger(__name__)

    async def prepare(
        self,
        chat_request: ChatRequest,
        tool_context: ToolContext,
        assigned_sandbox_types: frozenset[str],
        timings: TurnTimings,
    ) -> PreparedChatTurn:
        workspace_started_at = time.perf_counter()
        await self._init_workspace(
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
        from app.biz.chat.skill_selector import select_skill_guides
        from app.biz.task_runtime.guides import SkillGuideRegistry, build_skill_prompt_section

        guide_registry = SkillGuideRegistry(
            workspace,
            project_id=int(chat_request.project_id or 0),
            agent_id=chat_request.agent_id,
        )
        prior_conversation_section = self._host._build_prior_conversation_section(chat_request)
        activated_guides = await select_skill_guides(
            guide_registry,
            chat_request.message.content or "",
            prior_conversation=prior_conversation_section,
        )
        executable_catalogue = "\n\n".join(
            section
            for section in (
                skill_loader.render_cards_section(compact=True),
                render_sandbox_delegation_section(assigned_sandbox_types),
            )
            if section
        )
        skills_section, activated_refs = build_skill_prompt_section(
            executable_catalogue,
            guide_registry,
            activated_guides,
        )
        tool_context.activated_skill_guides = list(activated_refs)
        if activated_refs:
            self._logger.info(
                "chat_skill_guides_activated conversation_id=%s turn_id=%s guides=%s",
                chat_request.conversation_id,
                chat_request.turn_id,
                [ref.model_dump() for ref in activated_refs],
            )

        capability_catalogue = WorkspaceCapabilityCatalogue()
        capability_retriever = CapabilityRetriever(capability_catalogue)
        profile_resolver = default_agent_profile_resolver()
        preparation_service = build_default_preparation_service(
            profile_resolver,
            capability_catalogue,
            capability_retriever,
        )
        capability_catalogue_tool = build_capability_catalogue_tool(capability_retriever)
        visible_profiles = profile_resolver.list_profiles(
            ProfileQuery(
                caller=ResolveContext(
                    username=chat_request.username,
                    agent_instance_id=chat_request.agent_instance_id,
                    project_id=chat_request.project_id,
                )
            )
        )
        delegate_tool = build_delegate_tool(
            preparation_service,
            available_profile_ids=tuple(profile.profile_id for profile in visible_profiles),
        )
        delegate_excerpt = ToolExcerpt.from_agent_framework_function_tool(delegate_tool)
        direct_tool_excerpts = self._host._direct_tool_excerpts()
        context_sections: dict[str, str] | None = None

        def get_context_sections() -> dict[str, str]:
            nonlocal context_sections
            if context_sections is None:
                context_sections = self._host._build_context_sections(
                    chat_request,
                    skill_loader,
                    assigned_sandbox_types=assigned_sandbox_types,
                )
            return context_sections

        def build_intent_input() -> ChatIntentCheckerInput:
            import app.schemas.common.common

            sections = get_context_sections()
            attachments = [
                app.schemas.common.common.Attachment.from_pb(item)
                for item in list(chat_request.message.attachments) + list(chat_request.agent_attachments)
            ]
            return ChatIntentCheckerInput(
                user_prompt=chat_request.message.content or "",
                attachments=attachments,
                delegate=delegate_excerpt,
                direct_tools=direct_tool_excerpts,
                workspace_attachments_section=sections.get("workspace_attachments", ""),
                source_manifests_section=sections.get("source_manifests", ""),
                workspace_knowledge_section=sections.get("workspace_knowledge", ""),
                prior_rerun_sources_section=sections.get("prior_rerun_sources", ""),
                prior_tabular_sources_section=sections.get("prior_tabular_sources", ""),
                prior_conversation_section=prior_conversation_section,
                skills_section=skills_section,
            )

        decision = await time_awaitable(
            timings,
            "route_ms",
            default_chat_router().decide(
                ChatRouteRequest(
                    user_prompt=chat_request.message.content or "",
                    has_attachments=bool(chat_request.message.attachments or chat_request.agent_attachments),
                    build_intent_input=build_intent_input,
                )
            ),
        )
        route = decision.route
        self._logger.info(
            "chat_route_decided conversation_id=%s turn_id=%s route=%s reason=%s",
            chat_request.conversation_id,
            chat_request.turn_id,
            route.value,
            decision.reason,
        )

        resolved_entry = _model_definition_to_entry(getattr(chat_request, "model_definition", None))
        agent = await time_awaitable(
            timings,
            "agent_build_ms",
            self._build_agent(
                chat_request.username,
                chat_request.agent_id,
                chat_request.agent_instance_id,
                self._mem_runner,
                tool_context=tool_context,
                model=_model_for_route(route, chat_request.model or None),
                resolved_entry=resolved_entry,
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
            skills_section=skills_section,
        )
        user_msg_started_at = time.perf_counter()
        agent_sections = get_context_sections() if route == ChatRouteMode.TASK else {}
        user_message = await asyncio.to_thread(
            self._host._build_user_message_from_sections,
            chat_request,
            agent_sections,
        )
        timings.record("user_message_build_ms", user_msg_started_at)

        tools_started_at = time.perf_counter()
        registry = default_tool_registry()
        all_tools = registry.tools_for_route(route)
        if registry.may_delegate(route):
            all_tools.append(capability_catalogue_tool)
            all_tools.append(delegate_tool)
        tool_context.all_tools = all_tools
        timings.record("tools_build_ms", tools_started_at)
        return PreparedChatTurn(
            route=route,
            agent=agent,
            user_message=user_message,
            system_message=system_message,
            tools=tuple(all_tools),
        )


def _prompt_mode_for_route(route: ChatRouteMode) -> str:
    if route == ChatRouteMode.FAST:
        return "fast"
    return "task"


def _model_for_route(route: ChatRouteMode, requested_model: str | None) -> str | None:
    if route == ChatRouteMode.FAST:
        fast_model = os.getenv(_FAST_MODEL_ENV, "").strip()
        if fast_model:
            return fast_model
    return requested_model
