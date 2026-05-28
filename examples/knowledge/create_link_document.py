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
