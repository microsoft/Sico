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

"""Similarity detection for bullet deduplication."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.llmhubs.embedding import LLMHubEmbeddingClient

from .config import DeduplicationConfig

try:
    import numpy as np

    _NUMPY_AVAILABLE = True
except ImportError:
    np = None
    _NUMPY_AVAILABLE = False

if TYPE_CHECKING:
    from ..playbook import Bullet, Playbook

logger = logging.getLogger(__name__)


class SimilarityDetector:
    """Detect similar bullet pairs using cosine similarity on embeddings."""

    def __init__(self, config: DeduplicationConfig | None = None):
        self.config = config or DeduplicationConfig()
        self._embedding_client = LLMHubEmbeddingClient(model=self.config.embedding_model)

    def compute_embedding(self, text: str) -> list[float] | None:
        """Compute embedding for a single text.

        Args:
            text: Text to embed

        Returns:
            Embedding vector as list of floats, or None if embedding fails
        """
        return self._compute_embedding(text)

    def compute_embeddings_batch(self, texts: list[str]) -> list[list[float] | None]:
        """Compute embeddings for multiple texts (more efficient).

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors (None for any that fail)
        """
        if not texts:
            return []

        return self._compute_embeddings_batch(texts)

    def _compute_embedding(self, text: str) -> list[float] | None:
        try:
            return self._embedding_client.embed(text)
        except Exception as e:
            logger.warning(f"Failed to compute embedding via llmhubs config: {e}")
            return None

    def _compute_embeddings_batch(self, texts: list[str]) -> list[list[float] | None]:
        try:
            return self._embedding_client.embed_batch(texts)
        except Exception as e:
            logger.warning(f"Failed to compute batch embeddings via llmhubs config: {e}")
            return [None] * len(texts)

    def cosine_similarity(self, a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two embedding vectors.

        Args:
            a: First embedding vector
            b: Second embedding vector

        Returns:
            Cosine similarity score between 0 and 1
        """
        if not _NUMPY_AVAILABLE:
            # Fallback to pure Python
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
        """Ensure all active bullets have embeddings computed.

        Args:
            playbook: Playbook to process

        Returns:
            Number of embeddings computed
        """
        bullets_needing_embeddings = [b for b in playbook.bullets() if b.embedding is None]

        if not bullets_needing_embeddings:
            return 0

        texts = [b.content for b in bullets_needing_embeddings]
        embeddings = self.compute_embeddings_batch(texts)

        count = 0
        for bullet, embedding in zip(bullets_needing_embeddings, embeddings):
            if embedding is not None:
                bullet.embedding = embedding
                count += 1

        logger.info(f"Computed {count} embeddings for bullets")
        return count

    def detect_similar_pairs(
        self,
        playbook: Playbook,
        threshold: float | None = None,
    ) -> list[tuple[Bullet, Bullet, float]]:
        """Find all pairs of bullets with similarity >= threshold.

        Args:
            playbook: Playbook to search
            threshold: Similarity threshold (default: config.similarity_threshold)

        Returns:
            List of (bullet_a, bullet_b, similarity_score) tuples,
            sorted by similarity score descending
        """
        threshold = threshold or self.config.similarity_threshold
        similar_pairs: list[tuple[Bullet, Bullet, float]] = []

        # Get active bullets only
        bullets = playbook.bullets(include_invalid=False)

        # Group by section if configured
        if self.config.within_section_only:
            sections: dict[str, list] = {}
            for bullet in bullets:
                sections.setdefault(bullet.section, []).append(bullet)

            for section_bullets in sections.values():
                pairs = self._find_similar_in_list(section_bullets, playbook, threshold)
                similar_pairs.extend(pairs)
        else:
            similar_pairs = self._find_similar_in_list(bullets, playbook, threshold)

        # Sort by similarity descending
        similar_pairs.sort(key=lambda x: x[2], reverse=True)
        return similar_pairs

    def _find_similar_in_list(
        self,
        bullets: list[Bullet],
        playbook: Playbook,
        threshold: float,
    ) -> list[tuple[Bullet, Bullet, float]]:
        """Find similar pairs within a list of bullets."""
        pairs: list[tuple[Bullet, Bullet, float]] = []

        for i, bullet_a in enumerate(bullets):
            if bullet_a.embedding is None:
                continue

            for bullet_b in bullets[i + 1 :]:
                if bullet_b.embedding is None:
                    continue

                # Skip pairs with existing KEEP decisions
                if playbook.has_keep_decision(bullet_a.id, bullet_b.id):
                    continue

                similarity = self.cosine_similarity(bullet_a.embedding, bullet_b.embedding)

                if similarity >= threshold:
                    pairs.append((bullet_a, bullet_b, similarity))

        return pairs
