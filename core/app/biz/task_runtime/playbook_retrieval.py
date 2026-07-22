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

"""Retrieve scoped playbook experience for delegated task execution.

This is the *producer* side of EPE retrieval: for each task about to be turned
into a :class:`TaskRun`, look up the agent's learned playbook and inject the
most relevant bullets into ``TaskSpec.args["playbook_hints"]`` /
``args["playbook_shown_bullet_ids"]`` and into the task instructions. Downstream
consumers (``presentation/rendering/tool_payload.py`` and the skill executor)
read those args back out — they are the matching consumer side.
"""

from __future__ import annotations

import logging
import math
import os
import re
from collections import Counter
from dataclasses import dataclass

from app.experiences.playbook import Bullet, Playbook, PlaybookStore

from .context import TurnContext
from .models import SkillDispatch, TaskSpec

_LOGGER = logging.getLogger(__name__)


def _experiences_enabled() -> bool:
    return os.getenv("EXPERIENCES_ENABLED", "false").lower() in ("true", "1", "yes")


def _skill_name(task: TaskSpec) -> str:
    dispatch = task.dispatch
    return dispatch.skill_name if isinstance(dispatch, SkillDispatch) else ""


@dataclass(frozen=True)
class PlaybookHint:
    bullet_id: str
    section: str
    text: str
    score: float
    helpful: int = 0
    harmful: int = 0

    def as_payload(self) -> dict[str, object]:
        return {
            "bullet_id": self.bullet_id,
            "section": self.section,
            "text": self.text,
            "score": round(self.score, 4),
            "helpful": self.helpful,
            "harmful": self.harmful,
        }


@dataclass(frozen=True)
class PlaybookRetrievalOptions:
    # Semantic top-`limit` pool; keep the first `head_keep`, drop the rest below `tail_min_helpful`.
    limit: int = 30
    head_keep: int = 10
    tail_min_helpful: int = 2


class PlaybookRetriever:
    def __init__(self, store: PlaybookStore | None = None, options: PlaybookRetrievalOptions | None = None) -> None:
        self.store = store or PlaybookStore()
        self.options = options or PlaybookRetrievalOptions()

    def retrieve(self, *, agent_instance_id: int, task: TaskSpec, limit: int | None = None) -> list[PlaybookHint]:
        playbook = self.store.load(agent_instance_id)
        if playbook is None:
            return []
        return self.retrieve_from_playbook(playbook=playbook, task=task, limit=limit)

    def retrieve_from_playbook(self, *, playbook: Playbook, task: TaskSpec, limit: int | None = None) -> list[PlaybookHint]:
        effective_limit = self.options.limit if limit is None else limit
        ranked = _relevance_ranked(playbook, task)[:effective_limit]
        head = ranked[: self.options.head_keep]
        tail = [(b, s) for b, s in ranked[self.options.head_keep :] if b.helpful >= self.options.tail_min_helpful]
        return [PlaybookHint(b.id, b.section, b.content, s, b.helpful, b.harmful) for b, s in head + tail]


_EXPERIENCE_HEADER = "### Learned Experience (from past executions) ###\nFormat: - [ID] content (✓helpful ✗harmful)"

_EXPERIENCE_FOOTER = (
    "Experience usage: When deciding each action, consult the relevant experiences above as reference to improve task pass rate. "
    "✓/✗ only tie-breaks equally relevant entries. ✓0/✗0 = untested, not invalid. "
    "On conflict, prioritize the task instruction and current environment state over any experience. "
    'If you refer to one, cite it as "According to [ID] ..."; use only listed IDs.'
)


def wrap_experience_for_agent(instructions: str, hints: list[PlaybookHint]) -> str:
    if not hints:
        return instructions
    bullets = "\n".join(f"- [{h.bullet_id}] {h.text} (✓{h.helpful} ✗{h.harmful})" for h in hints)
    return f"{instructions.strip()}\n\nexperiences:[\n{_EXPERIENCE_HEADER}\n\n{bullets}\n\n{_EXPERIENCE_FOOTER}\n]"


def attach_playbook_hints(ctx: TurnContext, task: TaskSpec) -> TaskSpec:
    """Inject scoped playbook hints into ``task`` before it becomes a TaskRun.

    Best-effort: any retrieval failure (or an empty playbook) leaves the task
    untouched. Returns the (possibly enriched) task; never mutates the input.

    The experience is appended both to ``TaskSpec.instructions`` and, when the
    skill takes its instructions as an explicit ``args["instructions"]``
    parameter (strict-schema skills such as android-tester), to that args value.
    The skill executor keeps a non-empty ``args["instructions"]`` in preference
    to the field, so enriching only the field would never reach the running
    skill.
    """
    if not _experiences_enabled():
        _LOGGER.debug("playbook retrieval skipped: EXPERIENCES_ENABLED=false")
        return task
    if not task.required_sandbox and not _skill_name(task):
        return task
    agent_instance_id = int(ctx.agent_instance_id or 0)
    try:
        hints = PlaybookRetriever().retrieve(agent_instance_id=agent_instance_id, task=task)
    except Exception:
        _LOGGER.warning(
            "playbook retrieval failed; task=%s runs without experience",
            task.task_id,
            exc_info=True,
        )
        return task
    if not hints:
        _LOGGER.info(
            "playbook experience: no matching strategies for task=%s agent_instance=%s",
            task.task_id,
            agent_instance_id,
        )
        return task
    args = dict(task.args)
    args["playbook_hints"] = [hint.as_payload() for hint in hints]
    args["playbook_shown_bullet_ids"] = [hint.bullet_id for hint in hints]
    enriched_instructions = wrap_experience_for_agent(task.instructions, hints)
    args_instructions = args.get("instructions")
    enriched_args = isinstance(args_instructions, str) and bool(args_instructions.strip())
    if enriched_args:
        args["instructions"] = wrap_experience_for_agent(args_instructions, hints)
    # Dump the instructions the skill actually runs — ``args["instructions"]`` when
    # the skill reads from args (strict-schema skills), else the field — so the
    # injected experience can be eyeballed in the log.
    injected = args["instructions"] if enriched_args else enriched_instructions
    _LOGGER.info(
        "playbook experience injected: task=%s bullets=%d [%s] target=%s\ninstructions:\n%s",
        task.task_id,
        len(hints),
        ", ".join(h.bullet_id for h in hints),
        "instructions+args" if enriched_args else "instructions",
        injected,
    )
    return task.model_copy(update={"instructions": enriched_instructions, "args": args})


def _relevance_ranked(playbook: Playbook, task: TaskSpec) -> list[tuple[Bullet, float]]:
    """Rank bullets by one relevance method: embedding cosine when the playbook is embedded, BM25 otherwise."""
    bullets = playbook.bullets()
    query = f"{task.title}\n{task.instructions}"
    scores = _semantic_scores(bullets, query)
    if not scores:
        scores = _bm25_scores(bullets, _tokens(query))
    ranked = [(bullet, scores[bullet.id]) for bullet in bullets if scores.get(bullet.id, 0.0) > 0.0]
    ranked.sort(key=lambda item: item[1], reverse=True)
    return ranked


def _semantic_scores(bullets: list[Bullet], query: str) -> dict[str, float]:
    embedded = [bullet for bullet in bullets if bullet.embedding]
    if not embedded:
        return {}
    try:
        from app.experiences.playbook import SimilarityScanner

        scanner = SimilarityScanner()
        query_embedding = scanner.compute_embedding(query)
        if query_embedding is None:
            return {}
        return {bullet.id: scanner.cosine_similarity(query_embedding, bullet.embedding or []) for bullet in embedded}
    except Exception:
        return {}


def _bm25_scores(bullets: list[Bullet], query_terms: set[str]) -> dict[str, float]:
    if not bullets or not query_terms:
        return {}
    k1, b = 1.5, 0.75
    docs = [(bullet, _tokens(f"{bullet.section} {bullet.content}")) for bullet in bullets]
    avgdl = sum(len(doc) for _, doc in docs) / len(docs)
    df: Counter[str] = Counter()
    for _, doc in docs:
        df.update(query_terms & doc)
    n = len(docs)
    scores: dict[str, float] = {}
    for bullet, doc in docs:
        tf = Counter(doc)
        score = 0.0
        for term in query_terms & doc:
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf[term] * (k1 + 1) / (tf[term] + k1 * (1 - b + b * len(doc) / avgdl))
        if score > 0:
            scores[bullet.id] = score
    return scores


def _tokens(text: str) -> set[str]:
    return {token.lower() for token in re.findall(r"[a-zA-Z0-9_\u4e00-\u9fff]{2,}", text)}
