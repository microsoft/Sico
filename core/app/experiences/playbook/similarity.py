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

"""Embedding-based similarity scanning and consolidation report generation."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ..llm import LLMHubEmbeddingClient

try:
    import numpy as np
    _NUMPY_AVAILABLE = True
except ImportError:
    np = None
    _NUMPY_AVAILABLE = False

if TYPE_CHECKING:
    from .consolidator import ConsolidationConfig
    from .model import Bullet, Playbook

logger = logging.getLogger(__name__)


_SIMILARITY_REPORT_HEADER = """
## Similar Entries Detected

The following entry pairs have high semantic similarity and may need consolidation.
For each pair, decide how to handle it:
- **merge**: Combine into a single improved entry (provide merged_content and keep_id)
- **drop**: Remove one as redundant (specify bullet_id to drop)
- **keep**: Keep both separate if they serve different purposes (explain differentiation)
- **patch**: Refine one entry's content to clarify the difference (provide new_content)

"""

_PAIR_TEMPLATE = """### Pair {index}: {similarity:.0%} similar
**Entry A** [{id_a}] (helpful={helpful_a}, harmful={harmful_a})
> {content_a}

**Entry B** [{id_b}] (helpful={helpful_b}, harmful={harmful_b})
> {content_b}

"""


class SimilarityScanner:
    """Detect similar entry pairs using cosine similarity on embeddings."""

    def __init__(self, config: ConsolidationConfig | None = None):
        from .consolidator import ConsolidationConfig as _Config
        self.config = config or _Config()
        self._embedding_client = LLMHubEmbeddingClient(model=self.config.embedding_model)

    def compute_embedding(self, text: str) -> list[float] | None:
        """Compute embedding for a single text."""
        return self._compute_embedding(text)

    def compute_embeddings_batch(self, texts: list[str]) -> list[list[float] | None]:
        """Compute embeddings for multiple texts."""
        if not texts:
            return []
        return self._compute_embeddings_batch(texts)

    def _compute_embedding(self, text: str) -> list[float] | None:
        try:
            return self._embedding_client.embed(text)
        except Exception as e:
            logger.warning("Failed to compute embedding: %s", e)
            return None

    def _compute_embeddings_batch(self, texts: list[str]) -> list[list[float] | None]:
        try:
            return self._embedding_client.embed_batch(texts)
        except Exception as e:
            logger.warning("Failed to compute batch embeddings: %s", e)
            return [None] * len(texts)

    def cosine_similarity(self, a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two embedding vectors."""
        if not _NUMPY_AVAILABLE:
            dot = sum(x * y for x, y in zip(a, b))
            norm_a = sum(x * x for x in a) ** 0.5
            norm_b = sum(x * x for x in b) ** 0.5
            if norm_a == 0 or norm_b == 0:
                return 0.0
            return dot / (norm_a * norm_b)

        a_arr = np.array(a)
        b_arr = np.array(b)
        dot = np.dot(a_arr, b_arr)
        norm_a = np.linalg.norm(a_arr)
        norm_b = np.linalg.norm(b_arr)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(dot / (norm_a * norm_b))

    def ensure_embeddings(self, playbook: Playbook) -> int:
        """Ensure all active entries have embeddings computed.

        Returns:
            Number of embeddings computed this call.
        """
        needing = [b for b in playbook.bullets() if b.embedding is None]
        if not needing:
            return 0

        texts = [b.content for b in needing]
        embeddings = self.compute_embeddings_batch(texts)

        count = 0
        for bullet, embedding in zip(needing, embeddings):
            if embedding is not None:
                bullet.embedding = embedding
                count += 1

        logger.info("Computed %d embeddings", count)
        return count

    def detect_similar_pairs(
        self,
        playbook: Playbook,
        threshold: float | None = None,
    ) -> list[tuple[Bullet, Bullet, float]]:
        """Find all pairs of entries with similarity >= threshold.

        Returns:
            List of (entry_a, entry_b, score) tuples, sorted by score descending.
        """
        threshold = threshold or self.config.similarity_threshold
        similar_pairs: list[tuple[Bullet, Bullet, float]] = []

        bullets = playbook.bullets(include_invalid=False)

        if self.config.within_section_only:
            sections: dict[str, list] = {}
            for bullet in bullets:
                sections.setdefault(bullet.section, []).append(bullet)
            for section_bullets in sections.values():
                similar_pairs.extend(self._scan_list(section_bullets, playbook, threshold))
        else:
            similar_pairs = self._scan_list(bullets, playbook, threshold)

        similar_pairs.sort(key=lambda x: x[2], reverse=True)
        return similar_pairs

    def _scan_list(
        self,
        bullets: list[Bullet],
        playbook: Playbook,
        threshold: float,
    ) -> list[tuple[Bullet, Bullet, float]]:
        pairs: list[tuple[Bullet, Bullet, float]] = []
        for i, bullet_a in enumerate(bullets):
            if bullet_a.embedding is None:
                continue
            for bullet_b in bullets[i + 1:]:
                if bullet_b.embedding is None:
                    continue
                if playbook.has_keep_decision(bullet_a.id, bullet_b.id):
                    continue
                score = self.cosine_similarity(bullet_a.embedding, bullet_b.embedding)
                if score >= threshold:
                    pairs.append((bullet_a, bullet_b, score))
        return pairs


def generate_similarity_report(
    similar_pairs: list[tuple[Bullet, Bullet, float]],
) -> str:
    """Generate a similarity report for the Curator prompt.

    Args:
        similar_pairs: List of (entry_a, entry_b, score) tuples.

    Returns:
        Formatted report string, empty string if no pairs.
    """
    if not similar_pairs:
        return ""

    parts = [_SIMILARITY_REPORT_HEADER]
    for i, (bullet_a, bullet_b, similarity) in enumerate(similar_pairs, 1):
        parts.append(
            _PAIR_TEMPLATE.format(
                index=i,
                similarity=similarity,
                id_a=bullet_a.id,
                helpful_a=bullet_a.helpful,
                harmful_a=bullet_a.harmful,
                content_a=bullet_a.content,
                id_b=bullet_b.id,
                helpful_b=bullet_b.helpful,
                harmful_b=bullet_b.harmful,
                content_b=bullet_b.content,
            )
        )

    parts.append(
        """
## Consolidation Operations Format

Include consolidation operations in your response under a `consolidation_operations` key.
Each operation must have a `type` field with one of: merge, drop, keep, patch.

```json
{
  "consolidation_operations": [
    {
      "type": "merge",
      "source_ids": ["entry-id-1", "entry-id-2"],
      "keep_id": "entry-id-1",
      "merged_content": "Improved combined strategy text",
      "reasoning": "Why merging improves the playbook"
    },
    {
      "type": "drop",
      "bullet_id": "entry-id-to-remove",
      "reasoning": "Why this entry is redundant"
    },
    {
      "type": "keep",
      "bullet_ids": ["entry-id-1", "entry-id-2"],
      "differentiation": "How they differ in purpose",
      "reasoning": "Why both are needed"
    },
    {
      "type": "patch",
      "bullet_id": "entry-id-to-update",
      "new_content": "Refined content with context tag like [Batch] or [API]",
      "reasoning": "How this clarifies the distinction"
    }
  ]
}
```

**Guidelines:**
- Consider helpful/harmful counts when deciding which entry to keep
- merge when entries are semantically identical or near-identical
- keep when they serve different contexts (batch vs real-time, different APIs, etc.)
- patch to add context tags like "[Batch Jobs]" or "[User-Facing API]" to differentiate
- drop only when one is clearly redundant with no unique value

"""
    )

    return "".join(parts)


def format_pair_for_logging(bullet_a: Bullet, bullet_b: Bullet, similarity: float) -> str:
    """Format a single pair for debug logging."""
    return (
        f"[{bullet_a.id}] '{bullet_a.content[:50]}...' "
        f"<-> [{bullet_b.id}] '{bullet_b.content[:50]}...' "
        f"({similarity:.0%} similar)"
    )
