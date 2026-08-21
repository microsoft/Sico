"""Upload a project asset and register it as a knowledge document."""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path

from examples._shared.http import bearer_headers, env_int, json_request, multipart_request, print_json, require_env


REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    token = require_env("TOKEN")
    project_id = env_int("PROJECT_ID", 1)
    file_path = Path(os.environ.get("FILE_PATH", str(REPO_ROOT / "README.md"))).expanduser().resolve()
    agent_id = os.environ.get("AGENT_ID", "").strip()

    if not file_path.is_file():
        raise RuntimeError(f"FILE_PATH does not exist or is not a file: {file_path}")

    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    upload_response = multipart_request(
        "/api/sico/project/asset",
        fields={"project_id": project_id},
        files={"file": (file_path.name, file_path.read_bytes(), content_type)},
        headers={"Authorization": f"Bearer {token}"},
    )

    asset_id = upload_response["data"]["id"]
    document_payload: dict[str, object] = {
        "projectId": project_id,
        "assetId": asset_id,
        "documentType": 1,
        "name": file_path.name,
    }
    if agent_id:
        document_payload["agentId"] = agent_id

    document_response = json_request(
        "/api/sico/knowledge/document",
        method="POST",
        payload=document_payload,
        headers=bearer_headers(token),
    )

    print("Upload response:")
    print_json(upload_response)
    print("\nCreate knowledge document response:")
    print_json(document_response)


if __name__ == "__main__":
    main()
