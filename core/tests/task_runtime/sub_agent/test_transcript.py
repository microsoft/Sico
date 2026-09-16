from __future__ import annotations

import json

import pytest

from app.biz.task_runtime.sub_agent.loop import AgentContent, CapabilityCall, ModelOutputDeltaEvent, ToolCallRequestedEvent
from app.biz.task_runtime.sub_agent.loop.transcript import AgentEventTranscript, encode_agent_loop_event


def test_encode_agent_loop_event_preserves_typed_event_payload() -> None:
    record = encode_agent_loop_event(
        ToolCallRequestedEvent(
            turn=2,
            call=CapabilityCall(capability="builtin:delegate", args={"goal": "run"}, call_id="call-1"),
        )
    )

    assert record["schema_version"] == 1
    assert record["event"] == "tool_call_requested"
    assert record["data"] == {
        "turn": 2,
        "call": {
            "capability": "builtin:delegate",
            "args": {"goal": "run"},
            "call_id": "call-1",
        },
    }
    assert isinstance(record["recorded_at_ms"], int)


@pytest.mark.asyncio
async def test_event_transcript_buffers_deltas_and_flushes_in_order(tmp_path) -> None:
    path = tmp_path / "events.jsonl"
    transcript = AgentEventTranscript(path)
    await transcript.reset()
    await transcript.append(ModelOutputDeltaEvent(turn=1, content=AgentContent(type="text", text="hello")))

    assert path.read_text(encoding="utf-8") == ""

    await transcript.append(
        ToolCallRequestedEvent(
            turn=1,
            call=CapabilityCall(capability="builtin:echo", call_id="call-1"),
        )
    )

    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert [record["event"] for record in records] == ["model_output_delta", "tool_call_requested"]
    assert records[0]["data"]["content"]["text"] == "hello"
