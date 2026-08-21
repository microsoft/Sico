"""Shared source inspection and tabular snapshot domain."""

from .errors import SourceError
from .models import (
    NormalizedRow,
    SheetManifest,
    SourceAccessContext,
    SourceManifest,
    TabularDocument,
    TabularRow,
    TabularScope,
    TabularSheet,
    canonical_case_id,
    canonical_case_id_pairs,
    normalize_header,
)
from .service import WorkspaceSourceService, is_supported_tabular_path
from .presentation import compact_manifest_payload, workbook_manifest_payload
from .tabular import GenericRowNormalizer, NormalizerSelector, TestCaseNormalizer, case_id_for_row

__all__ = [
    "GenericRowNormalizer",
    "NormalizedRow",
    "NormalizerSelector",
    "SheetManifest",
    "SourceAccessContext",
    "SourceError",
    "SourceManifest",
    "TabularDocument",
    "TabularRow",
    "TabularScope",
    "TabularSheet",
    "TestCaseNormalizer",
    "WorkspaceSourceService",
    "case_id_for_row",
    "canonical_case_id",
    "canonical_case_id_pairs",
    "compact_manifest_payload",
    "is_supported_tabular_path",
    "normalize_header",
    "workbook_manifest_payload",
]
