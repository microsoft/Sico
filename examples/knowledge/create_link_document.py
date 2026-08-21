"""Create a link-backed knowledge document."""

from __future__ import annotations

import os

from examples._shared.http import bearer_headers, env_int, json_request, print_json, require_env


def main() -> None:
    token = require_env("TOKEN")
    project_id = env_int("PROJECT_ID", 1)
    link_url = os.environ.get("DOC_URL", "https://github.com/microsoft/Sico")
    name = os.environ.get("DOC_NAME", "Sico GitHub Repository")
    agent_id = os.environ.get("AGENT_ID", "").strip()

    payload: dict[str, object] = {
        "projectId": project_id,
        "linkUrl": link_url,
        "documentType": 2,
        "name": name,
    }
    if agent_id:
        payload["agentId"] = agent_id

    response = json_request(
        "/api/sico/knowledge/document",
        method="POST",
        payload=payload,
        headers=bearer_headers(token),
    )

    print_json(response)


if __name__ == "__main__":
    main()
