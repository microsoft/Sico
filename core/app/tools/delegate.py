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

"""Expose the chat :class:`Adapter` registry as a single ``delegate`` function tool.

The whole adapter registry is surfaced to the TASK-route chat agent as one
``delegate`` :class:`FunctionTool`; the agent selects the task builder via the
``kind`` argument (e.g. ``general``, ``workbook``) rather than a separate
``delegate_<name>`` tool per adapter. Invoking the tool is the agent's
one-shot way to (1) expand the selected adapter's input into a
:class:`PreparedTaskBatch`, (2) submit it to the task runtime, and (3) receive
the task-runtime tool payload (batch_id, runs, statuses) as the function
result. Live task progress reaches the frontend separately, through the
:class:`~app.tools.plan.PlanEditor` the task runtime writes to.

This module lives under :mod:`app.tools` so every :class:`FunctionTool` exposed
to the chat agent is colocated; the chat-adapter package only owns adapter
implementations and the registry factory.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field, create_model

from app.biz.chat.adapters.general.adapter import GeneralAdapterError
from app.biz.chat.adapters.workbook.adapter import WorkbookAdapterError
from app.biz.chat.types import Adapter, AdapterInput
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_DELEGATE_TOOL_NAME = "delegate"

_STRUCTURED_ADAPTER_ERRORS: tuple[type[Exception], ...] = (
    WorkbookAdapterError,
    GeneralAdapterError,
)


def _build_delegate_input_model(adapters: dict[str, Adapter]) -> type[BaseModel]:
    """Build the ``delegate`` input model with ``kind`` pinned to the live adapters.

    ``kind`` is typed as a :data:`typing.Literal` over the registered adapter
    names so strict structured-output mode rejects hallucinated kinds at the
    schema level instead of relying solely on the runtime ``unknown_delegate_kind``
    guard.
    """
    kind_type = Literal[tuple(adapters)]  # type: ignore[valid-type]
    return create_model(
        "DelegateInput",
        kind=(
            kind_type,
            Field(
                description=(
                    "Which task builder to use. See this tool's description for "
                    "when to pick each one."
                ),
            ),
        ),
        options_json=(
            str,
            Field(
                default="",
                description=(
                    "JSON-encoded options object for the selected `kind`. Use a JSON "
                    "string (not a nested object) so the schema stays compatible with "
                    "strict structured-output mode. Empty string means no options."
                ),
            ),
        ),
    )


def _delegate_tool_description(adapters: dict[str, Adapter]) -> str:
    kinds = ", ".join(f"`{name}`" for name in adapters)
    sections = "\n\n".join(f"When `kind` = `{name}`:\n{adapter.description}" for name, adapter in adapters.items())
    return (
        "Delegate durable work to the task runtime. Calling this tool builds a "
        "task batch from the supplied input AND submits it for execution in one "
        "shot; the return value is the task-runtime payload (batch_id, runs, "
        "statuses).\n\n"
        f"Set `kind` to choose the task builder (one of: {kinds}), then encode "
        "that builder's options as a JSON string in `options_json`.\n\n"
        f"{sections}"
    )


def build_adapter_tools(
    adapters: dict[str, Adapter],
) -> list[FunctionTool]:
    """Expose the adapter registry as a single ``delegate`` :class:`FunctionTool`.

    The agent selects the task builder via the ``kind`` argument instead of a
    separate ``delegate_<name>`` tool per adapter, so registering a new adapter
    never grows the chat agent's tool surface. The tool reads the per-turn
    :class:`ToolContext` from the framework's :class:`FunctionInvocationContext`
    (the same mechanism every other tool in :mod:`app.tools` uses), so it stays
    stateless w.r.t. the turn outside that context.
    """
    if not adapters:
        return []
    return [_build_delegate_tool(adapters)]


def _resolve_adapter(adapters: dict[str, Adapter], kind: str) -> Adapter | None:
    """Look up an adapter by ``kind``, falling back to a case-insensitive match."""
    adapter = adapters.get(kind)
    if adapter is not None or not kind:
        return adapter
    lowered = kind.lower()
    for name, candidate in adapters.items():
        if name.lower() == lowered:
            return candidate
    return None


def _build_delegate_tool(adapters: dict[str, Adapter]) -> FunctionTool:
    async def _func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
        tool_context = get_tool_context(invocation_ctx)
        if tool_context is None:
            return {
                "error_message": "missing tool context",
                "code": "missing_tool_context",
                "details": {},
            }
        kind = str(kwargs.get("kind", "") or "").strip()
        adapter = _resolve_adapter(adapters, kind)
        if adapter is None:
            valid_kinds = sorted(adapters)
            return {
                "error_message": f"unknown delegate kind {kind!r}; valid kinds: {valid_kinds}",
                "code": "unknown_delegate_kind",
                "details": {"kind": kind, "valid_kinds": valid_kinds},
            }
        adapter_input = AdapterInput(options_json=str(kwargs.get("options_json", "") or ""))
        return await _run_adapter(adapter, tool_context, adapter_input)

    return FunctionTool(
        name=_DELEGATE_TOOL_NAME,
        description=_delegate_tool_description(adapters),
        input_model=_build_delegate_input_model(adapters),
        additional_properties={"max_output_length": 50_000},
        func=_func,
    )


async def _run_adapter(
    adapter: Adapter,
    tool_context: ToolContext,
    adapter_input: AdapterInput,
) -> dict[str, Any]:
    # Imported lazily to avoid a circular import via ``app.biz.chat.service``.
    from app.biz.task_runtime.context import TurnContext
    from app.biz.task_runtime.manager import default_task_manager

    try:
        prepared = await adapter.build_tasks(tool_context, adapter_input)
    except _STRUCTURED_ADAPTER_ERRORS as exc:
        _LOGGER.warning(
            "delegate_adapter_build_failed adapter=%s code=%s err=%s",
            adapter.name,
            exc.code,
            exc,
        )
        return {
            "error_message": str(exc),
            "code": exc.code,
            "details": exc.details,
        }
    except Exception as exc:  # noqa: BLE001
        _LOGGER.exception("delegate_adapter_build_unexpected_failure adapter=%s", adapter.name)
        return {
            "error_message": f"adapter {adapter.name!r} failed to build tasks: {exc}",
            "code": "adapter_build_failed",
            "details": {},
        }

    if not prepared.batch.tasks:
        return {
            "error_message": f"adapter {adapter.name!r} produced no tasks for the supplied input",
            "code": "adapter_no_tasks",
            "details": {},
        }

    _LOGGER.info("adapter_built_tasks adapter=%s tasks_len=%d", adapter.name, len(prepared.batch.tasks))
    if _LOGGER.isEnabledFor(logging.DEBUG):
        for idx, task in enumerate(prepared.batch.tasks):
            _LOGGER.debug(
                "adapter_task_detail adapter=%s task_idx=%d task_spec=%s",
                adapter.name,
                idx,
                task.model_dump_json(indent=2),
            )

    turn_ctx = TurnContext.from_tool_context(tool_context)
    manager = default_task_manager(turn_ctx)
    try:
        batch_result = await manager.submit_prepared(turn_ctx, prepared)
        _LOGGER.info(
            "run_adapter batch_results adapter=%s batch_id=%s results_len=%d",
            adapter.name,
            batch_result.batch_id,
            len(batch_result.results),
        )
        if _LOGGER.isEnabledFor(logging.DEBUG):
            _LOGGER.debug(
                "run_adapter batch_results_detail adapter=%s batch_id=%s details=%s",
                adapter.name,
                batch_result.batch_id,
                batch_result.model_dump_json(indent=2),
            )

        payload = await adapter.process_results(batch_result, prepared, manager)
        if _LOGGER.isEnabledFor(logging.DEBUG):
            _LOGGER.debug(
                "run_adapter tool_payload adapter=%s payload=%s",
                adapter.name,
                json.dumps(payload, indent=2),
            )
    except Exception as exc:  # noqa: BLE001
        _LOGGER.exception("delegate_adapter_submit_failed adapter=%s", adapter.name)
        return {
            "error_message": f"task runtime submit failed for adapter {adapter.name!r}: {exc}",
            "code": "task_submit_failed",
            "details": {},
        }

    return payload


__all__ = ["build_adapter_tools"]
