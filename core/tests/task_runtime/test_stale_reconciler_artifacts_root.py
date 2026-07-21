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

"""Regression tests for :meth:`StaleReconciler._artifacts_root`.

The background reconciler builds its ``TaskManager`` without a ``sidechain_root``.
With the DB-backed store (which has no ``batch_dir``) the manager's ``_batch_dir``
callable raises ``ValueError``. Previously that propagated through ``_aggregate``
and was swallowed by ``reconcile()``'s ``contextlib.suppress(Exception)``, leaving
stale batches stuck in ``running`` forever. ``_artifacts_root`` now falls back to
the same per-owner workspace path the live submit path uses.
"""

from pathlib import Path
import pytest
from types import SimpleNamespace
import sys

from app.biz.task_runtime import stale_reconciler as stale_reconciler_module
from app.biz.task_runtime.stale_reconciler import StaleReconciler
from app.biz.task_runtime.workspace import workspace_layout


def _reconciler(batch_dir) -> StaleReconciler:
    return StaleReconciler(store=None, sandbox=None, progress=None, batch_dir=batch_dir)


def _raise_value_error(_batch_id: str) -> Path:
    raise ValueError("sidechain_root is required for stores without batch_dir")


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX host-path prefix assertion uses forward-slash semantics")
def test_artifacts_root_uses_batch_dir_when_available() -> None:
    reconciler = _reconciler(lambda batch_id: Path("/srv/runtime") / batch_id)
    batch = SimpleNamespace(batch_id="batch-abc")
    runs = [SimpleNamespace(username="jason@ms.com", agent_instance_id=588)]

    assert reconciler._artifacts_root(batch, runs) == "/srv/runtime/batch-abc"


def test_artifacts_root_falls_back_to_owner_workspace() -> None:
    reconciler = _reconciler(_raise_value_error)
    batch = SimpleNamespace(batch_id="batch-abc")
    runs = [
        SimpleNamespace(username=None, agent_instance_id=None),
        SimpleNamespace(username="jason@ms.com", agent_instance_id=588),
    ]

    expected = workspace_layout().workspace_path(588, "jason@ms.com") / "results" / "batch-abc"
    assert reconciler._artifacts_root(batch, runs) == str(expected)


def test_artifacts_root_falls_back_to_batch_id_without_owner() -> None:
    reconciler = _reconciler(_raise_value_error)
    batch = SimpleNamespace(batch_id="batch-abc")
    runs = [SimpleNamespace(username=None, agent_instance_id=None)]

    assert reconciler._artifacts_root(batch, runs) == "batch-abc"


def test_plan_conversation_id_does_not_fall_back_to_legacy_plan(monkeypatch) -> None:
    class FakeLayout:
        def plan_exists(self, _agent_instance_id: int, _username: str, _turn_id: int, *, conversation_id: int) -> bool:
            return conversation_id == 0

    monkeypatch.setattr(stale_reconciler_module, "workspace_layout", lambda: FakeLayout())
    run = SimpleNamespace(agent_instance_id=571, username="alice")
    batch = SimpleNamespace(parent_conversation_id=730, parent_turn_id=14)

    assert stale_reconciler_module._plan_conversation_id_for_batch(run, batch) == 730


def test_plan_conversation_id_returns_zero_without_parent_conversation() -> None:
    run = SimpleNamespace(agent_instance_id=571, username="alice")
    batch = SimpleNamespace(parent_conversation_id=0, parent_turn_id=14)

    assert stale_reconciler_module._plan_conversation_id_for_batch(run, batch) == 0
