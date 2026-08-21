"""Parent tool-call payload rendering.

This renders what the *parent* turn shows back to the LLM and the plan UI for a
batch: the tool-call return payload (:func:`build_tool_payload`). It reads run
rows from the :class:`RunStore` passed in explicitly, so it stays free of manager
state.
"""

from __future__ import annotations

import logging
from typing import Any

from ...domain.models import BatchResult, TaskResult
from .tool_payload import (
    _add_playbook_hint_payload,
    result_to_tool_payload,
)
from ...storage.run_store import RunStore

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
