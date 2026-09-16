from __future__ import annotations

import json

from app.biz.task_runtime.sub_agent.history import ConversationHistoryLoader, ConversationHistoryRequest
from app.storage.fs import ChatFS


def _write(storage: ChatFS, turn: int, messages: list[dict]) -> None:
    storage.write_conversation(7, "alice", turn, json.dumps(messages), conversation_id=44)


def test_history_projects_prior_user_and_assistant_text_only(tmp_path) -> None:
    storage = ChatFS(tmp_path)
    _write(
        storage,
        1,
        [
            {"role": "user", "contents": [{"type": "text", "text": "prepare it"}]},
            {
                "role": "assistant",
                "contents": [
                    {"type": "text", "text": "prepared"},
                    {"type": "function_call", "name": "delegate", "call_id": "call-1"},
                ],
            },
            {"role": "tool", "contents": [{"type": "function_result", "call_id": "call-1", "result": "done"}]},
        ],
    )
    _write(storage, 2, [{"role": "user", "contents": [{"type": "text", "text": "retry it"}]}])

    history = ConversationHistoryLoader(storage, count_tokens=lambda value: len(value)).load(
        ConversationHistoryRequest(7, "alice", 44, before_turn_id=2, token_budget=10_000)
    )

    assert [(message.role, message.contents[0].text) for message in history] == [
        ("user", "prepare it"),
        ("assistant", "prepared"),
    ]


def test_history_keeps_whole_recent_turns_within_budget(tmp_path) -> None:
    storage = ChatFS(tmp_path)
    _write(storage, 1, [{"role": "user", "contents": [{"type": "text", "text": "old"}]}])
    _write(storage, 2, [{"role": "assistant", "contents": [{"type": "text", "text": "recent"}]}])

    def counter(value: str) -> int:
        return 6 if "recent" in value else 5

    history = ConversationHistoryLoader(storage, count_tokens=counter).load(
        ConversationHistoryRequest(7, "alice", 44, before_turn_id=3, token_budget=6)
    )

    assert [message.contents[0].text for message in history] == ["recent"]


def test_history_is_scoped_to_conversation(tmp_path) -> None:
    storage = ChatFS(tmp_path)
    storage.write_conversation(
        7,
        "alice",
        1,
        json.dumps([{"role": "user", "contents": [{"type": "text", "text": "other"}]}]),
        conversation_id=45,
    )

    history = ConversationHistoryLoader(storage, count_tokens=lambda value: len(value)).load(
        ConversationHistoryRequest(7, "alice", 44, before_turn_id=2, token_budget=10_000)
    )

    assert history == ()
