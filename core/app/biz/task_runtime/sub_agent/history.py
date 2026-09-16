"""Project local turn transcripts into compact framework-neutral history."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass

from app.storage.fs import ChatFS

from .loop import AgentContent, AgentMessage


@dataclass(frozen=True, slots=True)
class ConversationHistoryRequest:
    agent_instance_id: int
    username: str
    conversation_id: int
    before_turn_id: int
    token_budget: int


class ConversationHistoryLoader:
    def __init__(self, storage: ChatFS, *, count_tokens: Callable[[str], int]) -> None:
        self._storage = storage
        self._count_tokens = count_tokens

    def load(self, request: ConversationHistoryRequest) -> tuple[AgentMessage, ...]:
        selected: list[AgentMessage] = []
        used_tokens = 0
        turn_ids = [
            turn_id
            for turn_id in self._storage.list_turn_ids(
                request.agent_instance_id,
                request.username,
                request.conversation_id,
            )
            if turn_id < request.before_turn_id
        ]
        for turn_id in reversed(turn_ids):
            raw = self._storage.read_conversation(
                request.agent_instance_id,
                request.username,
                turn_id,
                conversation_id=request.conversation_id,
            )
            projected = _project_turn(raw)
            if not projected:
                continue
            serialized = json.dumps(
                [
                    {
                        "role": message.role,
                        "contents": [{"type": content.type, "text": content.text} for content in message.contents],
                    }
                    for message in projected
                ],
                ensure_ascii=False,
                separators=(",", ":"),
            )
            turn_tokens = self._count_tokens(serialized)
            if used_tokens + turn_tokens > request.token_budget:
                break
            selected[0:0] = projected
            used_tokens += turn_tokens
        return tuple(selected)


def _project_turn(raw: str | None) -> list[AgentMessage]:
    if not raw:
        return []
    try:
        messages = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(messages, list):
        return []

    projected: list[AgentMessage] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "")
        if role not in {"user", "assistant"}:
            continue
        contents = message.get("contents")
        if not isinstance(contents, list):
            continue
        text = "".join(
            str(content.get("text") or "")
            for content in contents
            if isinstance(content, dict) and content.get("type") == "text"
        )
        if text:
            projected.append(AgentMessage(role=role, contents=(AgentContent(type="text", text=text),)))
    return projected
