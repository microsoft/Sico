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

"""Playbook storage and mutation logic for experience learning."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

from .delta import DeltaBatch, DeltaOperation


@dataclass
class ConsolidationVerdict:
    """Record of a Curator decision to keep two entries separate."""

    verdict: Literal["keep_both"]
    rationale: str
    cosine_score: float
    judged_at: str
    judge_model: str = ""


@dataclass
class Bullet:
    """Single playbook entry."""

    id: str
    section: str
    content: str
    helpful: int = 0
    harmful: int = 0
    neutral: int = 0
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    embedding: list[float] | None = None
    status: Literal["active", "invalid"] = "active"

    def apply_metadata(self, metadata: dict[str, int]) -> None:
        for key, value in metadata.items():
            if hasattr(self, key):
                setattr(self, key, int(value))

    def tag(self, tag: str, increment: int = 1) -> None:
        if tag not in ("helpful", "harmful", "neutral"):
            raise ValueError(f"Unsupported tag: {tag}")
        current = getattr(self, tag)
        setattr(self, tag, current + increment)
        self.updated_at = datetime.now(UTC).isoformat()

    def to_llm_dict(self) -> dict[str, Any]:
        """
        Return dictionary with only LLM-relevant fields.

        Excludes created_at and updated_at which are internal metadata
        not useful for LLM strategy selection.

        Returns:
            Dict with id, section, content, helpful, harmful, neutral
        """
        return {
            "id": self.id,
            "section": self.section,
            "content": self.content,
            "helpful": self.helpful,
            "harmful": self.harmful,
            "neutral": self.neutral,
        }


_VERDICT_FIELD_MAP = {
    "decision": "verdict",
    "reasoning": "rationale",
    "decided_at": "judged_at",
    "similarity_at_decision": "cosine_score",
}
_VERDICT_VALUE_MAP = {"KEEP": "keep_both"}


def _migrate_verdict_dict(d: dict) -> dict:
    result = {}
    for k, v in d.items():
        new_k = _VERDICT_FIELD_MAP.get(k, k)
        result[new_k] = _VERDICT_VALUE_MAP.get(v, v) if new_k == "verdict" else v
    result.setdefault("judge_model", "")
    return result


def _days_since(iso_timestamp: str, now: datetime) -> float:
    """Days from an ISO timestamp to ``now``; 0.0 if unparseable (treated as just-touched)."""
    try:
        return (now - datetime.fromisoformat(iso_timestamp)).total_seconds() / 86400
    except (ValueError, TypeError):
        return 0.0


@dataclass(frozen=True)
class RetentionPolicy:
    """Bounds the playbook's active set when it exceeds ``max_bullets``.

    Removes disposable entries (net-negative, or cold = never used and
    untouched for ``cold_after_days``) first; if still over the cap, the
    survivors with the lowest keep score (smoothed hit-rate discounted by
    staleness).
    """

    max_bullets: int = 500
    cold_after_days: float = 3.0
    half_life_days: float = 20.0  # staleness discount: idle value halves every N days

    def is_disposable(self, bullet: Bullet, now: datetime) -> bool:
        """Whether an entry can be dropped outright, before any ranking."""
        if bullet.harmful > bullet.helpful:
            return True
        never_used = bullet.helpful == bullet.harmful == bullet.neutral == 0
        return never_used and _days_since(bullet.updated_at, now) > self.cold_after_days

    def keep_score(self, bullet: Bullet, now: datetime) -> float:
        """Score in [0, 1] for ranking survivors; higher means more worth keeping.

        Smoothed hit-rate (quality and confidence in one: small samples are
        pulled toward 0.5, large samples approach the true rate) discounted by
        a bounded time-decay, so staleness erodes value but a proven entry is
        never floored below half its rate by age alone.
        """
        hit_rate = (bullet.helpful + 1) / (bullet.helpful + bullet.harmful + bullet.neutral + 2)
        half_life = max(self.half_life_days, 1e-6)
        decay = max(0.5, 0.5 ** (_days_since(bullet.updated_at, now) / half_life))
        return hit_rate * decay


class Playbook:
    """Structured context store for experience learning."""

    def __init__(self) -> None:
        self._bullets: dict[str, Bullet] = {}
        self._sections: dict[str, list[str]] = {}
        self._next_id = 0
        self._similarity_decisions: dict[frozenset[str], ConsolidationVerdict] = {}

    def __repr__(self) -> str:
        """Concise representation for debugging and object inspection."""
        return f"Playbook(bullets={len(self._bullets)}, sections={list(self._sections.keys())})"

    def __str__(self) -> str:
        """
        Human-readable representation showing actual playbook content.

        Uses markdown format for readability since this is
        typically used for debugging/inspection, not LLM prompts.
        """
        if not self._bullets:
            return "Playbook(empty)"
        return self._as_markdown_debug()

    # ------------------------------------------------------------------ #
    # CRUD utils
    # ------------------------------------------------------------------ #
    def add_bullet(
        self,
        section: str,
        content: str,
        bullet_id: str | None = None,
        metadata: dict[str, int] | None = None,
    ) -> Bullet:
        bullet_id = bullet_id or self._generate_id(section)
        metadata = metadata or {}
        bullet = Bullet(id=bullet_id, section=section, content=content)
        bullet.apply_metadata(metadata)
        self._bullets[bullet_id] = bullet
        self._sections.setdefault(section, []).append(bullet_id)
        return bullet

    def update_bullet(
        self,
        bullet_id: str,
        *,
        content: str | None = None,
        metadata: dict[str, int] | None = None,
    ) -> Bullet | None:
        bullet = self._bullets.get(bullet_id)
        if bullet is None:
            return None
        if content is not None:
            bullet.content = content
        if metadata:
            bullet.apply_metadata(metadata)
        bullet.updated_at = datetime.now(UTC).isoformat()
        return bullet

    def tag_bullet(self, bullet_id: str, tag: str, increment: int = 1) -> Bullet | None:
        bullet = self._bullets.get(bullet_id)
        if bullet is None:
            return None
        bullet.tag(tag, increment=increment)
        return bullet

    def remove_bullet(self, bullet_id: str, soft: bool = False) -> None:
        """Remove a bullet from the playbook.

        Args:
            bullet_id: ID of the bullet to remove
            soft: If True, mark as invalid instead of deleting (for audit trail)
        """
        bullet = self._bullets.get(bullet_id)
        if bullet is None:
            return

        if soft:
            # Soft delete: mark as invalid but keep in storage
            bullet.status = "invalid"
            bullet.updated_at = datetime.now(UTC).isoformat()
        else:
            # Hard delete: remove entirely
            self._bullets.pop(bullet_id, None)
            section_list = self._sections.get(bullet.section)
            if section_list:
                self._sections[bullet.section] = [bid for bid in section_list if bid != bullet_id]
                if not self._sections[bullet.section]:
                    del self._sections[bullet.section]

    def get_bullet(self, bullet_id: str) -> Bullet | None:
        return self._bullets.get(bullet_id)

    def bullets(self, include_invalid: bool = False) -> list[Bullet]:
        """Get all bullets in the playbook.

        Args:
            include_invalid: If True, include soft-deleted bullets

        Returns:
            List of bullets (active only by default)
        """
        if include_invalid:
            return list(self._bullets.values())
        return [b for b in self._bullets.values() if b.status == "active"]

    def prune(self, policy: RetentionPolicy, *, now: datetime | None = None) -> int:
        """Remove low-value entries until the active set fits ``policy.max_bullets``.

        Drops disposable entries first; if still over the cap, drops the
        survivors with the lowest keep score. Returns the number removed.
        """
        active = self.bullets()
        if len(active) <= policy.max_bullets:
            return 0
        now = now or datetime.now(UTC)

        evict = {b.id for b in active if policy.is_disposable(b, now)}
        survivors = [b for b in active if b.id not in evict]
        overflow = len(survivors) - policy.max_bullets
        if overflow > 0:
            # Evict the lowest keep score first; least recently updated breaks ties.
            survivors.sort(key=lambda b: (policy.keep_score(b, now), b.updated_at))
            evict.update(b.id for b in survivors[:overflow])

        for bullet_id in evict:
            self.remove_bullet(bullet_id)
        return len(evict)

    # ------------------------------------------------------------------ #
    # Consolidation verdicts
    # ------------------------------------------------------------------ #
    def get_similarity_decision(self, bullet_id_a: str, bullet_id_b: str) -> ConsolidationVerdict | None:
        """Get a prior consolidation verdict for a pair of entries."""
        pair_key = frozenset([bullet_id_a, bullet_id_b])
        return self._similarity_decisions.get(pair_key)

    def set_similarity_decision(
        self,
        bullet_id_a: str,
        bullet_id_b: str,
        decision: ConsolidationVerdict,
    ) -> None:
        """Store a consolidation verdict for a pair of entries."""
        pair_key = frozenset([bullet_id_a, bullet_id_b])
        self._similarity_decisions[pair_key] = decision

    def has_keep_decision(self, bullet_id_a: str, bullet_id_b: str) -> bool:
        """Check if there is a keep verdict for this entry pair."""
        verdict = self.get_similarity_decision(bullet_id_a, bullet_id_b)
        return verdict is not None and verdict.verdict == "keep_both"

    # ------------------------------------------------------------------ #
    # Serialization
    # ------------------------------------------------------------------ #
    def to_dict(self) -> dict[str, object]:
        # Serialize similarity decisions with string keys (JSON doesn't support frozenset)
        similarity_decisions_serialized = {
            ",".join(sorted(pair_ids)): asdict(decision) for pair_ids, decision in self._similarity_decisions.items()
        }
        return {
            "bullets": {bullet_id: asdict(bullet) for bullet_id, bullet in self._bullets.items()},
            "sections": self._sections,
            "next_id": self._next_id,
            "similarity_decisions": similarity_decisions_serialized,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> Playbook:
        instance = cls()
        bullets_payload = payload.get("bullets", {})
        if isinstance(bullets_payload, dict):
            for bullet_id, bullet_value in bullets_payload.items():
                if isinstance(bullet_value, dict):
                    # Handle new optional fields with defaults for backwards compatibility
                    bullet_data = dict(bullet_value)
                    if "embedding" not in bullet_data:
                        bullet_data["embedding"] = None
                    if "status" not in bullet_data:
                        bullet_data["status"] = "active"
                    instance._bullets[bullet_id] = Bullet(**bullet_data)
        sections_payload = payload.get("sections", {})
        if isinstance(sections_payload, dict):
            instance._sections = {
                section: list(ids) if isinstance(ids, Iterable) else [] for section, ids in sections_payload.items()
            }
        next_id_value = payload.get("next_id", 0)
        instance._next_id = int(cast(int | str, next_id_value)) if next_id_value is not None else 0
        # Deserialize consolidation verdicts
        similarity_decisions_payload = payload.get("similarity_decisions", {})
        if isinstance(similarity_decisions_payload, dict):
            for pair_key_str, decision_value in similarity_decisions_payload.items():
                if isinstance(decision_value, dict):
                    pair_ids = frozenset(pair_key_str.split(","))
                    dv = _migrate_verdict_dict(dict(decision_value))
                    instance._similarity_decisions[pair_ids] = ConsolidationVerdict(**dv)
        return instance

    def dumps(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    @classmethod
    def loads(cls, data: str) -> Playbook:
        payload = json.loads(data)
        if not isinstance(payload, dict):
            raise ValueError("Playbook serialization must be a JSON object.")
        return cls.from_dict(payload)

    def save_to_file(self, path: str) -> None:
        """Save playbook to a JSON file.

        Args:
            path: File path where to save the playbook

        Example:
            >>> playbook.save_to_file("trained_model.json")
        """
        file_path = Path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("w", encoding="utf-8") as f:
            f.write(self.dumps())

    @classmethod
    def load_from_file(cls, path: str) -> Playbook:
        """Load playbook from a JSON file.

        Args:
            path: File path to load the playbook from

        Returns:
            Playbook instance loaded from the file

        Example:
            >>> playbook = Playbook.load_from_file("trained_model.json")

        Raises:
            FileNotFoundError: If the file doesn't exist
            json.JSONDecodeError: If the file contains invalid JSON
            ValueError: If the JSON doesn't represent a valid playbook
        """
        file_path = Path(path)
        if not file_path.exists():
            raise FileNotFoundError(f"Playbook file not found: {path}")
        with file_path.open("r", encoding="utf-8") as f:
            return cls.loads(f.read())

    # ------------------------------------------------------------------ #
    # Delta application
    # ------------------------------------------------------------------ #
    def apply_delta(self, delta: DeltaBatch) -> None:
        for operation in delta.operations:
            self._apply_operation(operation)

    def _apply_operation(self, operation: DeltaOperation) -> None:
        op_type = operation.type.upper()
        if op_type == "ADD":
            # Skip ADD if content is empty or None
            if not operation.content:
                return
            self.add_bullet(
                section=operation.section,
                content=operation.content,
                bullet_id=operation.bullet_id,
                metadata=operation.metadata,
            )
        elif op_type == "UPDATE":
            if operation.bullet_id is None:
                return
            self.update_bullet(
                operation.bullet_id,
                content=operation.content,
                metadata=operation.metadata,
            )
        elif op_type == "TAG":
            if operation.bullet_id is None:
                return
            # Only apply valid tag names as defensive measure
            valid_tags = {"helpful", "harmful", "neutral"}
            for tag, increment in operation.metadata.items():
                if tag in valid_tags:
                    self.tag_bullet(operation.bullet_id, tag, increment)
        elif op_type == "REMOVE":
            if operation.bullet_id is None:
                return
            self.remove_bullet(operation.bullet_id)

    # ------------------------------------------------------------------ #
    # Presentation helpers
    # ------------------------------------------------------------------ #
    def as_prompt(self) -> str:
        """
        Return TOON-encoded playbook for LLM prompts.

        Uses tab delimiters and excludes internal metadata (created_at, updated_at)
        for maximum token efficiency (~16-62% savings vs markdown).

        Returns:
            TOON-formatted string with bullets array

        Raises:
            ImportError: If python-toon is not installed
        """
        try:
            from toon import encode
        except ImportError:
            raise ImportError("TOON compression requires python-toon. Install with: pip install python-toon>=0.1.0")

        # Only include LLM-relevant fields (exclude created_at, updated_at)
        bullets_data = [b.to_llm_dict() for b in self.bullets()]

        # Use tab delimiter for 5-10% better compression than comma
        return encode({"bullets": bullets_data}, {"delimiter": "\t"})

    def as_markdown(self, section: str | None = None) -> str:
        """
        Return a human-readable markdown table representation of the playbook.

        This format is intended for user-facing display, inspection, and writing
        playbook content into the workspace for agent/tool consumption. It is
        more readable than TOON but uses more tokens, so `as_prompt()` remains
        the preferred format for direct LLM prompting when token efficiency
        matters.

        Args:
            section: Optional exact section name. When provided, only bullets
                from that section are returned.

        Returns:
            Markdown-formatted playbook string
        """
        parts: list[str] = [
            "| Category | Id | Strategy | Application Result |",
            "| :--- | :--- | :--- | :--- |",
        ]
        if section is None:
            sections_to_render = sorted(self._sections)
        else:
            sections_to_render = [section]

        for current_section in sections_to_render:
            bullet_ids = self._sections.get(current_section, [])
            for bullet_id in bullet_ids:
                bullet = self._bullets.get(bullet_id)
                if bullet is None or bullet.status != "active":
                    continue
                # Bullet ID format: {category}-{id}
                short_id = bullet.id.split("-", 1)[1] if "-" in bullet.id else bullet.id
                result = f"helpful={bullet.helpful}, harmful={bullet.harmful}, neutral={bullet.neutral}"
                parts.append(f"| {current_section} | {short_id} | {bullet.content} | {result} |")
        return "\n".join(parts)

    def stats(self) -> dict[str, object]:
        return {
            "sections": len(self._sections),
            "bullets": len(self._bullets),
            "tags": {
                "helpful": sum(b.helpful for b in self._bullets.values()),
                "harmful": sum(b.harmful for b in self._bullets.values()),
                "neutral": sum(b.neutral for b in self._bullets.values()),
            },
        }

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #
    def _generate_id(self, section: str) -> str:
        self._next_id += 1
        section_prefix = re.sub(r"[^a-z0-9]", "", section.split(maxsplit=1)[0].lower()) if section.strip() else ""
        section_prefix = section_prefix or "general"
        return f"{section_prefix}-{self._next_id:05d}"

    def _as_markdown_debug(self) -> str:
        return self.as_markdown()
