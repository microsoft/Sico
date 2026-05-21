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

"""Configuration for bullet deduplication."""

from dataclasses import dataclass


@dataclass
class DeduplicationConfig:
    """Configuration for bullet deduplication.

    Attributes:
        enabled: Whether deduplication is enabled (default: True)
        embedding_model: Model to use for computing embeddings
        similarity_threshold: Minimum similarity score to consider bullets as similar
        min_pairs_to_report: Minimum number of similar pairs before including in Curator prompt
        within_section_only: If True, only compare bullets within the same section
    """

    # Feature flags
    enabled: bool = True

    # Embedding settings
    embedding_model: str = "text-embedding-3-small"

    # Similarity thresholds
    similarity_threshold: float = 0.85

    # Cost control: only report similar pairs if >= this many found
    min_pairs_to_report: int = 1

    # Scope
    within_section_only: bool = True
