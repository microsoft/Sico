"""Contract tests for representative frontend ``ToolCall`` wire payloads.

The examples are deliberately hand-authored in camelCase rather than generated
from the model. This keeps the wire contract independent of the serializer and
prevents moving this test from silently disconnecting it from external fixture
paths.
"""

from __future__ import annotations

import pytest

from app.schemas.conversation.plan import ToolCall

_TOOL_CALL_EXAMPLES = (
    pytest.param(
        {
            "toolName": "Run Tasks",
            "toolCallId": 20,
            "toolCallStatus": 3,
            "executionInfo": {
                "builtinToolName": "delegate",
                "taskRuntime": {
                    "currentStage": "execute",
                    "attempt": 1,
                    "maxAttempts": 2,
                },
            },
            "subCalls": [
                {
                    "toolName": "TaskRun",
                    "toolCallId": 21,
                    "subCallIndex": 0,
                    "toolCallStatus": 3,
                    "executionInfo": {
                        "taskRuntime": {
                            "currentStage": "execute",
                            "attempt": 1,
                            "maxAttempts": 2,
                        }
                    },
                }
            ],
        },
        id="completed-batch",
    ),
    pytest.param(
        {
            "toolName": "TaskRun",
            "message": "Legacy failure prose",
            "toolCallId": 30,
            "toolCallStatus": 2,
            "executionInfo": {
                "taskRuntime": {
                    "currentStage": "release",
                    "sandboxId": "emulator:device-1",
                    "sandboxType": "emulator",
                    "attempt": 2,
                    "maxAttempts": 2,
                }
            },
            "deliverables": [
                {
                    "type": 5,
                    "acquiredSandbox": {
                        "sandboxId": "emulator:device-1",
                        "sandboxType": "emulator",
                        "endpoint": "127.0.0.1:5555",
                        "displayName": "emulator sandbox",
                    },
                }
            ],
        },
        id="failed-run-with-sandbox",
    ),
)


def _strip_message(node: object) -> object:
    """Recursively drop every ``message`` key (incl. nested ``subCalls``)."""
    if isinstance(node, dict):
        return {key: _strip_message(value) for key, value in node.items() if key != "message"}
    if isinstance(node, list):
        return [_strip_message(item) for item in node]
    return node


@pytest.mark.parametrize("raw", _TOOL_CALL_EXAMPLES)
def test_example_conforms_to_tool_call_schema(raw: dict[str, object]) -> None:
    tool_call = ToolCall.model_validate(raw)

    # Structured fields, not prose, must carry identity and progress.
    assert tool_call.tool_name == raw["toolName"]
    assert len(tool_call.sub_calls) == len(raw.get("subCalls", []))

    # The camelCase proto3-JSON wire form round-trips without loss.
    restored = ToolCall.model_validate(tool_call.model_dump(by_alias=True))
    assert restored == tool_call


@pytest.mark.parametrize("raw", _TOOL_CALL_EXAMPLES)
def test_example_outcome_is_renderable_without_message(raw: dict[str, object]) -> None:
    """Every fact the UI needs is reachable from structured fields alone.

    We physically strip the deprecated ``message`` prose (recursively, including
    nested ``subCalls``) and prove the example still validates and exposes its
    identity/progress/outcome structurally, so a frontend that ignores
    ``message`` loses nothing.
    """
    tool_call = ToolCall.model_validate(_strip_message(raw))

    # No `message` survives anywhere in the parsed tree.
    assert not tool_call.message
    assert all(not child.message for child in tool_call.sub_calls)

    # A parent batch exposes its children structurally (ordered by index).
    if tool_call.sub_calls:
        indices = [child.sub_call_index for child in tool_call.sub_calls]
        assert indices == sorted(indices)

    # Progress/outcome is conveyed by tool_call_status + sub_calls + task_runtime,
    # so the UI never has to parse the deprecated `message` prose.
    assert tool_call.tool_call_status or tool_call.sub_calls or tool_call.execution_info.task_runtime.current_stage
