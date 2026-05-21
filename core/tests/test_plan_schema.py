from app.schemas.conversation.plan import ToolCall, ToolCallStatus


def test_tool_call_status_roundtrip_through_pb():
    tool_call = ToolCall(
        tool_name="Run Command",
        message="Retrying: pytest",
        tool_call_status=ToolCallStatus.RETRY_RUNNING,
    )

    roundtrip = ToolCall.from_pb(tool_call.to_pb())
    data = roundtrip.model_dump(by_alias=True)

    assert roundtrip.tool_call_status == ToolCallStatus.RETRY_RUNNING
    assert data["toolCallStatus"] == ToolCallStatus.RETRY_RUNNING