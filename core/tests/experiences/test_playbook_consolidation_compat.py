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

"""Regression tests for playbook consolidation backwards-compatibility paths.

Two critical paths must survive indefinitely:
1. _migrate_verdict_dict: old on-disk SimilarityDecision format loads correctly.
2. _kind_aliases in EntryConsolidator: LLM responses using old operation words still parse.
"""

from app.experiences.playbook import (
    ConsolidationVerdict,
    ConsolidationKind,
    EntryConsolidator,
    Playbook,
)
from app.experiences.playbook.model import _migrate_verdict_dict


class TestMigrateVerdictDict:
    """Old SimilarityDecision dicts (pre-rename) deserialize to ConsolidationVerdict."""

    def test_old_field_names_are_remapped(self):
        old = {
            "decision": "KEEP",
            "reasoning": "They serve different contexts",
            "decided_at": "2025-01-01T00:00:00+00:00",
            "similarity_at_decision": 0.91,
        }
        result = _migrate_verdict_dict(old)
        assert result["verdict"] == "keep_both"
        assert result["rationale"] == "They serve different contexts"
        assert result["judged_at"] == "2025-01-01T00:00:00+00:00"
        assert result["cosine_score"] == 0.91
        assert result["judge_model"] == ""

    def test_new_field_names_pass_through(self):
        new = {
            "verdict": "keep_both",
            "rationale": "Different use cases",
            "judged_at": "2025-06-01T00:00:00+00:00",
            "cosine_score": 0.88,
            "judge_model": "gpt-5",
        }
        result = _migrate_verdict_dict(new)
        assert result == new

    def test_roundtrip_via_playbook_from_dict(self):
        """Old stored playbook JSON with SimilarityDecision loads cleanly."""
        old_payload = {
            "bullets": {},
            "sections": {},
            "next_id": 0,
            "similarity_decisions": {
                "a-00001,b-00002": {
                    "decision": "KEEP",
                    "reasoning": "batch vs realtime",
                    "decided_at": "2025-01-01T00:00:00+00:00",
                    "similarity_at_decision": 0.87,
                }
            },
        }
        pb = Playbook.from_dict(old_payload)
        verdict = pb.get_similarity_decision("a-00001", "b-00002")
        assert verdict is not None
        assert isinstance(verdict, ConsolidationVerdict)
        assert verdict.verdict == "keep_both"
        assert verdict.cosine_score == 0.87


class TestKindAliases:
    """EntryConsolidator accepts old LLM operation words via alias mapping."""

    def test_delete_maps_to_drop(self):
        """'delete' is an alias handled inside parse_consolidation_actions → DROP."""
        from unittest.mock import MagicMock

        consolidator = EntryConsolidator.__new__(EntryConsolidator)
        consolidator.config = MagicMock(enabled=True)
        consolidator.scanner = MagicMock()

        actions = consolidator.parse_consolidation_actions({
            "consolidation_operations": [
                {"type": "delete", "bullet_id": "x-00001", "reasoning": "redundant"},
            ]
        })
        assert len(actions) == 1
        assert actions[0].kind == ConsolidationKind.DROP

    def test_parse_old_delete_operation(self):
        """Full parse: LLM returns 'delete' → parsed as DROP action."""
        from unittest.mock import MagicMock

        consolidator = EntryConsolidator.__new__(EntryConsolidator)
        consolidator.config = MagicMock(enabled=True)
        consolidator.scanner = MagicMock()

        response = {
            "consolidation_operations": [
                {"type": "delete", "bullet_id": "x-00001", "reasoning": "redundant"},
            ]
        }
        actions = consolidator.parse_consolidation_actions(response)
        assert len(actions) == 1
        assert actions[0].kind == ConsolidationKind.DROP
        assert actions[0].target_ids == ["x-00001"]

    def test_parse_old_update_operation(self):
        """Full parse: LLM returns 'update' → parsed as PATCH action."""
        from unittest.mock import MagicMock

        consolidator = EntryConsolidator.__new__(EntryConsolidator)
        consolidator.config = MagicMock(enabled=True)
        consolidator.scanner = MagicMock()

        response = {
            "consolidation_operations": [
                {"type": "update", "bullet_id": "x-00002", "new_content": "refined"},
            ]
        }
        actions = consolidator.parse_consolidation_actions(response)
        assert len(actions) == 1
        assert actions[0].kind == ConsolidationKind.PATCH
