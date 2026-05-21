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

"""Upload a local skill package and register it."""

from __future__ import annotations

import io
import os
import zipfile
from pathlib import Path

from examples._shared.http import bearer_headers, env_int, json_request, multipart_request, print_json, require_env


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SKILL_PATH = REPO_ROOT / "skills" / "android-tester-skill"


def main() -> None:
    token = require_env("TOKEN")
    project_id = env_int("PROJECT_ID", 1)
    agent_id = os.environ.get("AGENT_ID", "").strip()
    skill_path = Path(os.environ.get("SKILL_PATH", str(DEFAULT_SKILL_PATH))).expanduser().resolve()

    file_name, file_bytes = load_skill_archive(skill_path)
    upload_response = multipart_request(
        "/api/sico/project/asset",
        fields={"project_id": project_id},
        files={"file": (file_name, file_bytes, "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )

    asset_id = upload_response["data"]["id"]
    skill_payload: dict[str, object] = {
        "projectId": project_id,
        "assetId": asset_id,
    }
    if agent_id:
        skill_payload["agentId"] = agent_id

    skill_response = json_request(
        "/api/sico/skills",
        method="POST",
        payload=skill_payload,
        headers=bearer_headers(token),
    )

    print("Upload response:")
    print_json(upload_response)
    print("\nCreate skill response:")
    print_json(skill_response)


def load_skill_archive(path: Path) -> tuple[str, bytes]:
    if not path.exists():
        raise RuntimeError(f"SKILL_PATH does not exist: {path}")
    if path.is_file():
        return path.name, path.read_bytes()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for child in sorted(path.rglob("*")):
            if child.is_file():
                archive.write(child, child.relative_to(path))
    return f"{path.name}.zip", buffer.getvalue()


if __name__ == "__main__":
    main()
