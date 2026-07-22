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

"""Playbook package: models, delta operations, persistence, and consolidation."""

from .consolidator import (
    ConsolidationAction,
    ConsolidationConfig,
    ConsolidationKind,
    EntryConsolidator,
    apply_consolidation_actions,
)
from .delta import DeltaBatch, DeltaOperation
from .model import Bullet, ConsolidationVerdict, Playbook, RetentionPolicy
from .similarity import SimilarityScanner
from .store import PlaybookStore

__all__ = [
    # model
    "Bullet",
    "ConsolidationVerdict",
    "Playbook",
    "RetentionPolicy",
    # delta
    "DeltaBatch",
    "DeltaOperation",
    # store
    "PlaybookStore",
    # consolidation
    "ConsolidationConfig",
    "ConsolidationAction",
    "ConsolidationKind",
    "EntryConsolidator",
    "SimilarityScanner",
    "apply_consolidation_actions",
]
