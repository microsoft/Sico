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

"""Entry consolidation configuration, orchestrator, and action types."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from .similarity import SimilarityScanner, format_pair_for_logging, generate_similarity_report

if TYPE_CHECKING:
    from .model import Playbook

logger = logging.getLogger(__name__)


@dataclass
class ConsolidationConfig:
    """Configuration for entry consolidation.

    Attributes:
        enabled: Whether consolidation is enabled
        embedding_model: Model for computing embeddings; resolved from
            EXPERIENCES_EMBEDDING_MODEL env var when left empty
        similarity_threshold: Cosine similarity floor for flagging entry pairs
        min_pairs_to_report: Skip similarity report when fewer pairs are found
        within_section_only: Restrict comparison to entries within the same section
    """

    enabled: bool = True
    embedding_model: str = ""
    similarity_threshold: float = 0.84
    min_pairs_to_report: int = 1
    within_section_only: bool = True

    def __post_init__(self) -> None:
        if not self.embedding_model:
            self.embedding_model = os.getenv("EXPERIENCES_EMBEDDING_MODEL", "text-embedding-3-small")


class ConsolidationKind(StrEnum):
    MERGE = "merge"
    DROP = "drop"
    KEEP = "keep"
    PATCH = "patch"


@dataclass
class ConsolidationAction:
    """A single consolidation decision produced by the Curator."""

    kind: ConsolidationKind
    target_ids: list[str] = field(default_factory=list)
    payload: dict | None = None


def apply_consolidation_actions(
    actions: list[ConsolidationAction],
    playbook: Playbook,
) -> None:
    """Apply a list of consolidation actions to a playbook."""
    for action in actions:
        if action.kind == ConsolidationKind.MERGE:
            _apply_merge(action, playbook)
        elif action.kind == ConsolidationKind.DROP:
            _apply_drop(action, playbook)
        elif action.kind == ConsolidationKind.KEEP:
            _apply_keep(action, playbook)
        elif action.kind == ConsolidationKind.PATCH:
            _apply_patch(action, playbook)
        else:
            logger.warning("Unknown consolidation kind: %s", action.kind)


def _apply_merge(action: ConsolidationAction, playbook: Playbook) -> None:
    payload = action.payload or {}
    keep_id = payload.get("keep_id", "")
    keep_bullet = playbook.get_bullet(keep_id)
    if keep_bullet is None:
        logger.warning("merge: keep entry %s not found", keep_id)
        return

    for source_id in action.target_ids:
        if source_id == keep_id:
            continue
        source = playbook.get_bullet(source_id)
        if source is None:
            logger.warning("merge: source entry %s not found", source_id)
            continue
        keep_bullet.helpful += source.helpful
        keep_bullet.harmful += source.harmful
        keep_bullet.neutral += source.neutral
        playbook.remove_bullet(source_id, soft=True)
        logger.info("merge: absorbed %s into %s", source_id, keep_id)

    merged_content = payload.get("merged_content", "")
    if merged_content:
        keep_bullet.content = merged_content

    keep_bullet.embedding = None
    keep_bullet.updated_at = datetime.now(UTC).isoformat()
    logger.info("merge: completed into %s", keep_id)


def _apply_drop(action: ConsolidationAction, playbook: Playbook) -> None:
    for bullet_id in action.target_ids:
        bullet = playbook.get_bullet(bullet_id)
        if bullet is None:
            logger.warning("drop: entry %s not found", bullet_id)
            continue
        playbook.remove_bullet(bullet_id, soft=True)
        logger.info("drop: removed %s", bullet_id)


def _apply_keep(action: ConsolidationAction, playbook: Playbook) -> None:
    if len(action.target_ids) < 2:
        logger.warning("keep: need at least 2 entry ids")
        return

    from .model import ConsolidationVerdict

    payload = action.payload or {}
    rationale = payload.get("reasoning", "") or payload.get("differentiation", "")

    for i, id_a in enumerate(action.target_ids):
        for id_b in action.target_ids[i + 1:]:
            verdict = ConsolidationVerdict(
                verdict="keep_both",
                rationale=rationale,
                cosine_score=0.0,
                judged_at=datetime.now(UTC).isoformat(),
                judge_model="",
            )
            playbook.set_similarity_decision(id_a, id_b, verdict)
            logger.info("keep: stored verdict for (%s, %s)", id_a, id_b)


def _apply_patch(action: ConsolidationAction, playbook: Playbook) -> None:
    payload = action.payload or {}
    for bullet_id in action.target_ids:
        bullet = playbook.get_bullet(bullet_id)
        if bullet is None:
            logger.warning("patch: entry %s not found", bullet_id)
            continue
        new_content = payload.get("new_content", "")
        if new_content:
            bullet.content = new_content
        bullet.embedding = None
        bullet.updated_at = datetime.now(UTC).isoformat()
        logger.info("patch: updated %s", bullet_id)


class EntryConsolidator:
    """Coordinates embedding-based similarity scanning and Curator-driven consolidation.

    Workflow:
        1. Call get_similarity_report(playbook) before the Curator runs.
        2. Include the report in the Curator prompt.
        3. After the Curator responds, call apply_actions_from_response(response_data, playbook).
    """

    def __init__(self, config: ConsolidationConfig | None = None):
        self.config = config or ConsolidationConfig()
        self.scanner = SimilarityScanner(self.config)

    def get_similarity_report(self, playbook: Playbook) -> str | None:
        """Generate a similarity report to include in the Curator prompt.

        Returns:
            Formatted report string, or None if no similar pairs found or consolidation is off.
        """
        if not self.config.enabled:
            return None

        self.scanner.ensure_embeddings(playbook)
        similar_pairs = self.scanner.detect_similar_pairs(playbook)

        if len(similar_pairs) < self.config.min_pairs_to_report:
            return None

        logger.info("Found %d similar entry pairs", len(similar_pairs))
        for bullet_a, bullet_b, similarity in similar_pairs:
            logger.debug(format_pair_for_logging(bullet_a, bullet_b, similarity))

        return generate_similarity_report(similar_pairs)

    def parse_consolidation_actions(
        self, response_data: dict[str, Any]
    ) -> list[ConsolidationAction]:
        """Parse consolidation actions from a Curator response dict."""
        actions: list[ConsolidationAction] = []
        raw_ops = response_data.get("consolidation_operations", [])

        if not isinstance(raw_ops, list):
            logger.warning("consolidation_operations is not a list")
            return actions

        _kind_aliases = {"delete": "drop", "update": "patch"}

        for raw_op in raw_ops:
            if not isinstance(raw_op, dict):
                continue
            type_str = raw_op.get("type", "").lower()
            type_str = _kind_aliases.get(type_str, type_str)
            try:
                kind = ConsolidationKind(type_str)
            except ValueError:
                logger.warning("Unknown consolidation type: %s", raw_op.get("type"))
                continue

            try:
                if kind == ConsolidationKind.MERGE:
                    actions.append(ConsolidationAction(
                        kind=kind,
                        target_ids=raw_op.get("source_ids", []),
                        payload={
                            "keep_id": raw_op.get("keep_id", ""),
                            "merged_content": raw_op.get("merged_content", ""),
                            "reasoning": raw_op.get("reasoning", ""),
                        },
                    ))
                elif kind == ConsolidationKind.DROP:
                    bullet_id = raw_op.get("bullet_id", "")
                    actions.append(ConsolidationAction(
                        kind=kind,
                        target_ids=[bullet_id] if bullet_id else [],
                        payload={"reasoning": raw_op.get("reasoning", "")},
                    ))
                elif kind == ConsolidationKind.KEEP:
                    actions.append(ConsolidationAction(
                        kind=kind,
                        target_ids=raw_op.get("bullet_ids", []),
                        payload={
                            "differentiation": raw_op.get("differentiation", ""),
                            "reasoning": raw_op.get("reasoning", ""),
                        },
                    ))
                elif kind == ConsolidationKind.PATCH:
                    bullet_id = raw_op.get("bullet_id", "")
                    actions.append(ConsolidationAction(
                        kind=kind,
                        target_ids=[bullet_id] if bullet_id else [],
                        payload={
                            "new_content": raw_op.get("new_content", ""),
                            "reasoning": raw_op.get("reasoning", ""),
                        },
                    ))
            except Exception as e:
                logger.warning("Failed to parse consolidation action: %s", e)

        logger.info("Parsed %d consolidation actions", len(actions))
        return actions

    def apply_operations(
        self,
        actions: list[ConsolidationAction],
        playbook: Playbook,
    ) -> None:
        """Apply consolidation actions to the playbook."""
        if not actions:
            return
        logger.info("Applying %d consolidation actions", len(actions))
        apply_consolidation_actions(actions, playbook)

    def apply_operations_from_response(
        self,
        response_data: dict[str, Any],
        playbook: Playbook,
    ) -> list[ConsolidationAction]:
        """Parse and apply consolidation actions from a Curator response dict.

        Returns the list of actions applied.
        """
        actions = self.parse_consolidation_actions(response_data)
        self.apply_operations(actions, playbook)
        return actions
