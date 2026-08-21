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
