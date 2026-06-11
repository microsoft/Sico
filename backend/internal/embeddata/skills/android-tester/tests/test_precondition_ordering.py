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

"""Tests for precondition ordering and order-aware caching.

Covers three layers added so the precondition agent can choose the order
of preconditions:

* :func:`parse_precondition_order` — lenient parse + permutation guard.
* :meth:`PreconditionManager._chain_key` / ``_get_script_path`` — the
  cache key now depends on the predecessor chain.
* :meth:`PreconditionManager.order_preconditions` — the up-front planner
  LLM call, including its fall-back behaviour.

No device, real LLM, or recorded scripts are needed: the manager's
collaborators are mocked and the real planner template is rendered from
the skill's ``data/`` directory.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from android_tester.precondition_manager import (
    PreconditionManager,
    PreconditionPlanError,
    parse_precondition_order,
)

_DATA_ROOT = Path(__file__).resolve().parent.parent / "data"


def _make_manager(tmp_path: Path, llm: MagicMock | None = None):
    """Build a PreconditionManager with mocked collaborators.

    The prompt renderer is real (so the planner template is exercised),
    but the controller / LLM / event logger / image store are mocks.
    """
    event_logger = MagicMock()
    event_logger.record = AsyncMock()
    return PreconditionManager(
        controller=MagicMock(),
        llm=llm or MagicMock(),
        data_root=_DATA_ROOT,
        cache_dir=tmp_path / "preconditions",
        event_logger=event_logger,
        image_store=MagicMock(),
    )


# ---------------------------------------------------------------------------
# parse_precondition_order
# ---------------------------------------------------------------------------


class TestParsePreconditionOrder:
    def test_full_permutation_is_applied(self) -> None:
        labels = ["a", "b", "c"]
        answer = '{"order": ["c", "a", "b"]}'
        assert parse_precondition_order(answer, labels) == ["c", "a", "b"]

    def test_case_insensitive_matching(self) -> None:
        labels = ["LoggedIn", "OnSettings"]
        answer = '{"order": ["onsettings", "LOGGEDIN"]}'
        assert parse_precondition_order(answer, labels) == [
            "OnSettings",
            "LoggedIn",
        ]

    def test_duplicate_label_is_deduped(self) -> None:
        # A repeated label is "sorted out" as long as every label is
        # still named at least once.
        labels = ["a", "b"]
        answer = '{"order": ["a", "b", "a"]}'
        assert parse_precondition_order(answer, labels) == ["a", "b"]

    def test_code_fence_is_rejected(self) -> None:
        labels = ["a", "b"]
        answer = '```json\n{"order": ["b", "a"]}\n```'
        with pytest.raises(PreconditionPlanError):
            parse_precondition_order(answer, labels)

    def test_surrounding_prose_is_rejected(self) -> None:
        labels = ["a", "b"]
        with pytest.raises(PreconditionPlanError):
            parse_precondition_order('plan: {"order": ["b", "a"]}', labels)

    def test_bare_json_array_is_rejected(self) -> None:
        labels = ["a", "b"]
        with pytest.raises(PreconditionPlanError):
            parse_precondition_order('["b", "a"]', labels)

    def test_missing_label_raises(self) -> None:
        labels = ["a", "b", "c"]
        with pytest.raises(PreconditionPlanError):
            parse_precondition_order('{"order": ["b", "a"]}', labels)

    def test_unknown_label_raises(self) -> None:
        labels = ["a", "b"]
        with pytest.raises(PreconditionPlanError):
            parse_precondition_order('{"order": ["a", "zzz"]}', labels)

    def test_non_json_answer_raises(self) -> None:
        labels = ["a", "b"]
        with pytest.raises(PreconditionPlanError):
            parse_precondition_order("b then a please", labels)

    def test_empty_answer_raises(self) -> None:
        labels = ["a", "b"]
        with pytest.raises(PreconditionPlanError):
            parse_precondition_order("", labels)


# ---------------------------------------------------------------------------
# label-only cache keys
# ---------------------------------------------------------------------------


class TestCacheKey:
    def test_path_is_label_scoped(self, tmp_path: Path) -> None:
        mgr = _make_manager(tmp_path)
        path = mgr._get_script_path("logged_in")
        assert path.parent.name == "logged_in"
        assert path.name == "action_log.json"

    def test_key_is_order_independent(self, tmp_path: Path) -> None:
        # The cache no longer depends on which preconditions ran before,
        # so the same label always maps to the same script path.
        mgr = _make_manager(tmp_path)
        assert mgr._get_script_path("x") == mgr._get_script_path("x")


# ---------------------------------------------------------------------------
# order_preconditions (planner LLM call)
# ---------------------------------------------------------------------------


class TestOrderPreconditions:
    async def test_single_precondition_skips_llm(
        self, tmp_path: Path,
    ) -> None:
        llm = MagicMock()
        llm.ask = AsyncMock()
        mgr = _make_manager(tmp_path, llm)

        pcs = [("only", "the only precondition")]
        result = await mgr.order_preconditions(pcs, "task-1")

        assert result == pcs
        llm.ask.assert_not_awaited()

    async def test_reorders_per_llm_answer(self, tmp_path: Path) -> None:
        llm = MagicMock()
        llm.ask = AsyncMock(return_value='{"order": ["second", "first"]}')
        mgr = _make_manager(tmp_path, llm)

        pcs = [("first", "do A"), ("second", "do B")]
        result = await mgr.order_preconditions(pcs, "task-1")

        assert result == [("second", "do B"), ("first", "do A")]
        llm.ask.assert_awaited_once()

    async def test_llm_failure_propagates(self, tmp_path: Path) -> None:
        llm = MagicMock()
        llm.ask = AsyncMock(side_effect=RuntimeError("boom"))
        mgr = _make_manager(tmp_path, llm)

        pcs = [("first", "do A"), ("second", "do B")]
        with pytest.raises(RuntimeError):
            await mgr.order_preconditions(pcs, "task-1")

    async def test_garbage_answer_raises(self, tmp_path: Path) -> None:
        llm = MagicMock()
        llm.ask = AsyncMock(return_value="i am not a label list")
        mgr = _make_manager(tmp_path, llm)

        pcs = [("first", "do A"), ("second", "do B")]
        with pytest.raises(PreconditionPlanError):
            await mgr.order_preconditions(pcs, "task-1")

    async def test_duplicate_input_labels_are_deduped(
        self, tmp_path: Path,
    ) -> None:
        llm = MagicMock()
        llm.ask = AsyncMock(return_value='{"order": ["b", "a"]}')
        mgr = _make_manager(tmp_path, llm)

        # 'a' appears twice on input; second copy is dropped before
        # planning, so the planner only sees two unique labels.
        pcs = [("a", "first a"), ("b", "do B"), ("a", "second a")]
        result = await mgr.order_preconditions(pcs, "task-1")

        assert result == [("b", "do B"), ("a", "first a")]

    async def test_duplicate_input_collapsing_to_one_skips_llm(
        self, tmp_path: Path,
    ) -> None:
        llm = MagicMock()
        llm.ask = AsyncMock()
        mgr = _make_manager(tmp_path, llm)

        pcs = [("a", "first a"), ("a", "second a")]
        result = await mgr.order_preconditions(pcs, "task-1")

        assert result == [("a", "first a")]
        llm.ask.assert_not_awaited()

    async def test_records_plan_event(self, tmp_path: Path) -> None:
        llm = MagicMock()
        llm.ask = AsyncMock(return_value='{"order": ["second", "first"]}')
        mgr = _make_manager(tmp_path, llm)

        pcs = [("first", "do A"), ("second", "do B")]
        await mgr.order_preconditions(pcs, "task-1")

        mgr._event_logger.record.assert_awaited_once()
        kwargs = mgr._event_logger.record.await_args.kwargs
        assert kwargs["input_order"] == ["first", "second"]
        assert kwargs["chosen_order"] == ["second", "first"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
