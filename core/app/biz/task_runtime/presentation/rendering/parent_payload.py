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

"""Parent tool-call payload rendering.

This renders what the *parent* turn shows back to the LLM and the plan UI for a
batch: the tool-call return payload (:func:`build_tool_payload`). It reads run
rows from the :class:`RunStore` passed in explicitly, so it stays free of manager
state.
"""

from __future__ import annotations

import logging
from typing import Any

from ...models import BatchResult, TaskResult
from .tool_payload import (
    _add_playbook_hint_payload,
    result_to_tool_payload,
)
from ...store import RunStore

_LOGGER = logging.getLogger(__name__)


async def build_tool_payload(store: RunStore, result: BatchResult, *, keep_full_structure: bool = False) -> dict:
    payload = result_to_tool_payload(result, keep_full_structure=keep_full_structure)
    if result.total_count == 1 and result.results:
        await _add_single_result_execution_context(store, payload, result.results[0])
    return payload


async def _add_single_result_execution_context(store: RunStore, payload: dict, result: TaskResult) -> None:
    try:
        run = await store.get_run(result.run_id)
    except Exception:
        return
    execution_context: dict[str, Any] = {
        "runner": run.executor,
        "kind": run.spec.kind,
    }
    if run.spec.skill_name:
        execution_context["skill"] = run.spec.skill_name
    _add_playbook_hint_payload(payload, run)
    payload["execution_context"] = execution_context
