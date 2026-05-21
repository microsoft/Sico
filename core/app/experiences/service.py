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

"""Experience learning integration service.

Wraps the Reflector→Curator pipeline so the chat module can
learn from conversation trajectories and persist playbook strategies.

Feature-flag gated: set ``EXPERIENCES_ENABLED=true`` to activate.

Usage:
    from app.experiences.service import ExperienceService

    service = ExperienceService()
    result = await service.learn_from_trajectory(
        trajectory=trajectory,
        project_id=1,
        agent_instance_id=129,
    )
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from app.experiences.deduplication.config import DeduplicationConfig
from app.experiences.llm import HubLLMClient, LLMClient
from app.experiences.playbook import Playbook
from app.experiences.runner import ExperienceRunner, TrajectoryData
from app.experiences.store import PlaybookStore

logger = logging.getLogger(__name__)

EXPERIENCES_ENABLED = os.getenv("EXPERIENCES_ENABLED", "false").lower() in ("true", "1", "yes")


def _use_screenshots_enabled() -> bool:
    """Whether the experience system should pass screenshots to the Reflector."""
    return os.getenv("EXPERIENCES_USE_SCREENSHOTS", "false").lower() in ("true", "1", "yes")


def _build_llm_client() -> LLMClient:
    """Build the experience learning structured-output client from llmhubs."""
    return HubLLMClient()


def _build_dedup_config() -> DeduplicationConfig:
    """Build deduplication config for llmhubs embedding usage."""
    return DeduplicationConfig(
        enabled=True,
        embedding_model="text-embedding-3-small",
        similarity_threshold=0.85,
        within_section_only=True,
    )


class ExperienceService:
    """Stateless-ish service that owns one ExperienceRunner per agent instance."""

    def __init__(self) -> None:
        self._store = PlaybookStore()
        # Cache runners keyed by agent_instance_id
        self._runners: dict[int | None, ExperienceRunner] = {}

    def _get_runner(
        self,
        agent_instance_id: int | None,
    ) -> ExperienceRunner:
        key = agent_instance_id
        if key not in self._runners:
            playbook = self._store.load_or_create(agent_instance_id)
            llm = _build_llm_client()
            dedup_config = _build_dedup_config()
            runner = ExperienceRunner(
                llm=llm,
                playbook=playbook,
                dedup_config=dedup_config,
                use_screenshots=_use_screenshots_enabled(),
            )
            self._runners[key] = runner
        return self._runners[key]

    async def learn_from_trajectory(
        self,
        trajectory: TrajectoryData,
        *,
        agent_instance_id: int | None = None,
        progress: str | None = None,
    ) -> dict[str, Any]:
        """Directly learn from a TrajectoryData."""
        if not EXPERIENCES_ENABLED:
            return {"skipped": True, "reason": "EXPERIENCES_ENABLED is not set"}

        runner = self._get_runner(agent_instance_id)
        result = await runner.learn_from_trajectory(
            trajectory,
            progress=progress,
        )
        await asyncio.to_thread(
            self._store.save,
            runner.playbook,
            agent_instance_id,
        )
        return {
            "skipped": False,
            "operations_applied": result.get("operations_applied", 0),
            "playbook_stats": runner.playbook.stats(),
        }

    async def get_playbook(
        self,
        agent_instance_id: int | None = None,
    ) -> Playbook | None:
        """Retrieve stored playbook (for injection into agent prompts)."""
        return await asyncio.to_thread(
            self._store.load,
            agent_instance_id,
        )


# ====================================================================== #
# Public top-level API functions
# ====================================================================== #

_default_service: ExperienceService | None = None


def _get_service() -> ExperienceService:
    """Lazy singleton so callers don't need to manage instance lifecycle."""
    global _default_service
    if _default_service is None:
        _default_service = ExperienceService()
    return _default_service


async def add_playbook(
    trajectory_data: TrajectoryData,
    project_id: int,
    agent_instance_id: int,
    conversation_id: int = 0,
    turn_id: int = 0,
) -> dict[str, Any]:
    """Learn from a trajectory and persist the updated playbook.

    This is the primary write API: given execution trajectory data,
    run the Reflector -> Curator pipeline to extract strategies and
    merge them into the playbook stored on disk.

    Args:
        trajectory_data: Structured trajectory from agent execution.
        agent_instance_id: Agent instance identifier.
        conversation_id: Conversation identifier (for message creation).
        turn_id: Turn identifier (for message creation).

    Returns:
        Summary dict with keys:
          - skipped (bool)
          - operations_applied (int)
          - playbook_stats (dict with sections, bullets, tags)
    """
    svc = _get_service()
    result = await svc.learn_from_trajectory(
        trajectory=trajectory_data,
        agent_instance_id=agent_instance_id,
    )

    num_operations = int(result.get("operations_applied", 0))
    playbook_id = 0
    created = False

    try:
        from app.biz.reverse_grpc.knowledge import ReverseKnowledgeService

        upsert_resp = await asyncio.to_thread(
            ReverseKnowledgeService.get_instance().upsert_knowledge_playbook,
            project_id=project_id,
            agent_instance_id=agent_instance_id,
        )
        playbook_id = int(upsert_resp.playbook_id)
        created = bool(upsert_resp.created)
    except Exception as upsert_err:
        logger.warning("Failed to upsert knowledge playbook: %s", upsert_err)

    try:
        from app.biz.reverse_grpc.conversation import ReverseConversationService
        from app.pb.conversation.chat import ChatContentType
        from app.schemas.conversation import Message

        ReverseConversationService.get_instance().create_message(
            Message(
                conversation_id=conversation_id,
                turn_id=turn_id,
                role="assistant",
                content_type=ChatContentType.PLAYBOOK_INGESTION,
                content=json.dumps(
                    {
                        "numOperations": num_operations,
                        "playbookId": playbook_id,
                    },
                    ensure_ascii=False,
                ),
                agent_instance_id=agent_instance_id,
            )
        )
    except Exception as msg_err:
        logger.warning("Failed to create PLAYBOOK_INGESTION message: %s", msg_err)

    result["playbookId"] = playbook_id
    result["created"] = created

    return result


async def read_playbook(
    agent_instance_id: int,
) -> str:
    """Read the stored playbook and return it as Markdown.

    Args:
        agent_instance_id: Agent instance identifier.

    Returns:
        Human-readable Markdown string of the playbook.
        Returns a notice string if no playbook exists yet.
    """
    svc = _get_service()
    playbook = await svc.get_playbook(agent_instance_id)
    if playbook is None:
        return "_No playbook found._"

    return playbook.as_markdown()
