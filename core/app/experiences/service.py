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
import hashlib
import json
import logging
import os
from collections import OrderedDict
from typing import Any

from app.experiences.llm import HubLLMClient, LLMClient
from app.experiences.playbook import ConsolidationConfig, Playbook, PlaybookStore, RetentionPolicy
from app.experiences.runner import ExperienceRunner, TrajectoryData

logger = logging.getLogger(__name__)

EXPERIENCES_ENABLED = os.getenv("EXPERIENCES_ENABLED", "false").lower() in ("true", "1", "yes")


def _use_screenshots_enabled() -> bool:
    """Whether the experience system should pass screenshots to the Reflector."""
    return os.getenv("EXPERIENCES_USE_SCREENSHOTS", "false").lower() in ("true", "1", "yes")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _retention_policy() -> RetentionPolicy:
    return RetentionPolicy(
        max_bullets=_env_int("EXPERIENCES_PLAYBOOK_CAP", 300),
        cold_after_days=_env_float("EXPERIENCES_PRUNE_COLD_AFTER_DAYS", 3.0),
        half_life_days=_env_float("EXPERIENCES_PRUNE_HALF_LIFE_DAYS", 20.0),
    )


def _prune_playbook(playbook: Playbook, agent_instance_id: int | None) -> None:
    """Bound the active playbook to the retention policy (best-effort; cap<=0 disables)."""
    policy = _retention_policy()
    if policy.max_bullets <= 0:
        return
    try:
        evicted = playbook.prune(policy)
    except Exception:
        logger.warning("playbook prune failed; agent_instance_id=%s", agent_instance_id, exc_info=True)
        return
    if evicted:
        logger.info(
            "playbook pruned: agent_instance_id=%s evicted=%d cap=%d",
            agent_instance_id,
            evicted,
            policy.max_bullets,
        )


def _build_llm_client() -> LLMClient:
    """Build the experience learning structured-output client from llmhubs."""
    return HubLLMClient()


def _build_consolidation_config() -> ConsolidationConfig:
    """Build consolidation config for llmhubs embedding usage."""
    return ConsolidationConfig()


def _trajectory_id(agent_instance_id: int | None, trajectory: TrajectoryData) -> str:
    """Content fingerprint of a trajectory, scoped to one agent.

    Hashes the full ``to_dict()`` (the contract every DW parser emits), so a
    verbatim replay yields the same id while a genuine re-execution does not.
    """
    try:
        payload = json.dumps(trajectory.to_dict(), sort_keys=True, default=str)
    except Exception:
        payload = repr(trajectory)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"{agent_instance_id}:{digest}"


class ExperienceService:
    """Stateless-ish service that owns one ExperienceRunner per agent instance."""

    def __init__(self) -> None:
        self._store = PlaybookStore()
        # Cache runners keyed by agent_instance_id
        self._runners: dict[int | None, ExperienceRunner] = {}
        # Per-agent_instance_id locks: fire-and-forget dispatch in
        # DWExperienceHooks can schedule many concurrent learn_from_trajectory
        # calls for the same agent_instance_id (e.g. a 50-case batch in
        # per_batch mode). Without serialization the in-memory runner playbook
        # and the on-disk file race each other; the lock ensures
        # reflector -> curator -> save runs to completion for one trajectory
        # before the next starts. Different agent_instance_ids run in parallel.
        self._locks: dict[int | None, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

        # Trajectory ids already learned, so a retried run that replays the same
        # trajectory is not learned twice. Checked under the per-agent lock;
        # cleared wholesale past a cap so the process cannot leak.
        self._learned_ids: set[str] = set()

    async def _get_lock(self, agent_instance_id: int | None) -> asyncio.Lock:
        async with self._locks_guard:
            lock = self._locks.get(agent_instance_id)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[agent_instance_id] = lock
            return lock

    def _get_runner(
        self,
        agent_instance_id: int | None,
    ) -> ExperienceRunner:
        key = agent_instance_id
        if key not in self._runners:
            playbook = self._store.load_or_create(agent_instance_id)
            llm = _build_llm_client()
            consolidation_config = _build_consolidation_config()
            runner = ExperienceRunner(
                llm=llm,
                playbook=playbook,
                consolidation_config=consolidation_config,
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
        """Service-layer wrapper around ``ExperienceRunner.learn_from_trajectory``.

        Adds the operational concerns missing from the pure runner:
        ``EXPERIENCES_ENABLED`` gate, per-``agent_instance_id`` runner cache,
        per-``agent_instance_id`` ``asyncio.Lock`` so concurrent dispatches
        for the same agent serialize, and disk persistence after the runner
        returns. Different agents proceed in parallel.

        Does not construct LLM inputs or implement Reflector / Curator
        behavior. The lock is held across the runner call, so LLM round-trip
        time counts against the lock — this is intentional so the on-disk
        save runs after the delta apply and before another writer for the
        same agent begins.
        """
        if not EXPERIENCES_ENABLED:
            return {"skipped": True, "reason": "EXPERIENCES_ENABLED is not set"}

        runner = self._get_runner(agent_instance_id)
        lock = await self._get_lock(agent_instance_id)
        async with lock:
            trajectory_id = _trajectory_id(agent_instance_id, trajectory)
            if trajectory_id in self._learned_ids:
                logger.info(
                    "EPE learning skipped (already learned this trajectory): agent_instance_id=%s",
                    agent_instance_id,
                )
                return {"skipped": True, "reason": "trajectory already learned"}
            if len(self._learned_ids) >= 1024:
                self._learned_ids.clear()
            self._learned_ids.add(trajectory_id)

            result = await runner.learn_from_trajectory(
                trajectory,
                progress=progress,
            )
            _prune_playbook(runner.playbook, agent_instance_id)
            await asyncio.to_thread(
                self._store.save,
                runner.playbook,
                agent_instance_id,
            )
        return {
            "skipped": False,
            "operations_applied": result.get("operations_applied", 0),
            "add_operations": result.get("add_operations", 0),
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


# Running per-turn total of applied operations, so the PLAYBOOK_INGESTION
# message reflects the whole turn (all batch cases) rather than the last case.
_TURN_OP_TOTALS: OrderedDict[tuple[int, int], int] = OrderedDict()
_TURN_OP_TOTALS_CAP = 512


def _accumulate_turn_operations(conversation_id: int, turn_id: int, num_operations: int) -> int:
    key = (conversation_id, turn_id)
    total = _TURN_OP_TOTALS.get(key, 0) + num_operations
    _TURN_OP_TOTALS[key] = total
    _TURN_OP_TOTALS.move_to_end(key)
    while len(_TURN_OP_TOTALS) > _TURN_OP_TOTALS_CAP:
        _TURN_OP_TOTALS.popitem(last=False)
    return total


def emit_playbook_ingestion(
    conversation_id: int,
    turn_id: int,
    num_operations: int,
    agent_instance_id: int,
    playbook_id: int = 0,
) -> None:
    """Emit the per-turn ``PLAYBOOK_INGESTION`` chat message that drives the ingestion badge."""
    try:
        from app.biz.reverse_grpc.conversation import ReverseConversationService
        from app.pb.conversation.chat import ChatContentType
        from app.schemas.conversation import Message

        turn_operations = _accumulate_turn_operations(conversation_id, turn_id, num_operations)
        ReverseConversationService.get_instance().create_message(
            Message(
                conversation_id=conversation_id,
                turn_id=turn_id,
                role="assistant",
                content_type=ChatContentType.PLAYBOOK_INGESTION,
                content=json.dumps(
                    {"numOperations": turn_operations, "playbookId": playbook_id},
                    ensure_ascii=False,
                ),
                agent_instance_id=agent_instance_id,
            )
        )
    except Exception as msg_err:
        logger.warning("Failed to create PLAYBOOK_INGESTION message: %s", msg_err)


async def add_playbook(
    trajectory_data: TrajectoryData,
    project_id: int,
    agent_instance_id: int,
    conversation_id: int = 0,
    turn_id: int = 0,
) -> dict[str, Any]:
    """Public ingestion API for a single ``TrajectoryData``.

    Entry point for callers outside the experiences package. Delegates to
    ``ExperienceService.learn_from_trajectory`` for the learn-and-persist
    work, then layers on the backend side effects: upsert the knowledge
    playbook via ``ReverseKnowledgeService`` and emit a
    ``PLAYBOOK_INGESTION`` chat message on the originating conversation.
    Side-effect failures are logged but do not abort the call — the
    playbook is already persisted by then.

    Returns the runner's summary plus ``playbookId`` / ``created`` from the
    knowledge upsert.
    """
    svc = _get_service()
    result = await svc.learn_from_trajectory(
        trajectory=trajectory_data,
        agent_instance_id=agent_instance_id,
    )

    # Surface only newly-added experiences (ADD) in the ingestion badge; UPDATE/TAG/REMOVE are excluded.
    num_operations = int(result.get("add_operations", 0))
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

    emit_playbook_ingestion(conversation_id, turn_id, num_operations, agent_instance_id, playbook_id)

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
