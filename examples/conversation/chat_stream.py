"""Stream a chat response over SSE."""

from __future__ import annotations

import json
import os

from examples._shared.http import bearer_headers, env_int, post_sse, print_json, require_env


def main() -> None:
    token = require_env("TOKEN")
    agent_instance_id = env_int("AGENT_INSTANCE_ID", 1)
    message = os.environ.get(
        "CHAT_MESSAGE",
        "Summarize what Sico is in two short sentences.",
    )

    print(f"Streaming chat for agentInstanceId={agent_instance_id}")

    for event_name, data in post_sse(
        "/api/sico/conversation/chat",
        payload={
            "message": message,
            "agentInstanceId": agent_instance_id,
            "attachments": [],
        },
        headers=bearer_headers(token),
    ):
        if event_name == "keepalive":
            continue

        print(f"\n[event] {event_name}")
        if not data:
            print("(empty data)")
            continue

        try:
            print_json(json.loads(data))
        except json.JSONDecodeError:
            print(data)


if __name__ == "__main__":
    main()
