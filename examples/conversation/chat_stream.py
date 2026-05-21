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
