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

"""Create a brand-new Digital Worker *type* (= a new Skill + a DW that owns it).

Important context:
    A DW's `role` is a fixed Go enum (Assistant / Android Tester / 3D Artist /
    Product Manager / Marketing) and cannot be extended via HTTP API.
    The actual *capability* of a DW is provided by a **Skill** — a directory
    containing a `SKILL.md` (with YAML frontmatter) plus any supporting code.
    Skills *can* be added at runtime via the public HTTP API.

This script does the full 4-step flow against a local server:
    1. Login -> JWT.
    2. Build a minimal in-memory skill zip (or load one from SKILL_DIR).
    3. POST /api/sico/project/asset      -> upload skill zip, get assetId.
    4. POST /api/sico/agent/single_agent -> create the DW (role = "Assistant").
       POST /api/sico/skills             -> register the skill, bound to that
                                            DW via `agentId`.
       POST /api/sico/agent/single_agent/deploy -> deploy a runnable instance.

Run:
    python examples/agent/create_dw_type.py

Useful env overrides:
    BASE_URL           default http://localhost:8080
    SICO_EMAIL         default operator@sico.local
    SICO_PASSWORD      default operator
    PROJECT_ID         default 1
    DW_TYPE_NAME       default "Web Researcher DW"
    DW_TYPE_ROLE       default "Assistant"   (must be one of AllAgentRoles)
    SKILL_NAME         default "web-researcher"
    SKILL_DESC         default short blurb shown to the model
    SKILL_DIR          optional path to an existing skill directory; if set,
                       it is zipped and uploaded instead of the inline demo.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any
from urllib import error, request


# ---------------------------------------------------------------------------
# Config

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
EMAIL = os.environ.get("SICO_EMAIL", "").strip() or "operator@sico.local"
PASSWORD = os.environ.get("SICO_PASSWORD", "operator")

PROJECT_ID = int(os.environ.get("PROJECT_ID", "1"))

# Append a timestamp suffix so reruns don't clash with the per-user unique
# (creator_username, name) constraint. Set DW_TYPE_NAME explicitly to disable.
_DW_NAME_BASE = os.environ.get("DW_TYPE_NAME", "").strip() or f"Web Researcher DW {int(time.time())}"
DW_TYPE_NAME = _DW_NAME_BASE
DW_TYPE_ROLE = os.environ.get("DW_TYPE_ROLE", "Assistant")  # one of AllAgentRoles
DW_TYPE_DESC = os.environ.get(
    "DW_TYPE_DESC",
    "Researches topics on the public web and writes a structured brief.",
)
DW_MODEL_KEY = os.environ.get("DW_MODEL_KEY", "").strip()

SKILL_NAME = os.environ.get("SKILL_NAME", "web-researcher")
SKILL_DESC = os.environ.get(
    "SKILL_DESC",
    "Research a topic on the public web and produce a structured brief.",
)
SKILL_DIR = os.environ.get("SKILL_DIR", "").strip()


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only)


def _post_json(path: str, payload: dict[str, Any], token: str | None = None) -> dict[str, Any]:
    return _send(path, method="POST", body=json.dumps(payload).encode("utf-8"), content_type="application/json", token=token)


def _post_multipart(
    path: str,
    fields: dict[str, str],
    file_name: str,
    file_bytes: bytes,
    token: str | None = None,
) -> dict[str, Any]:
    boundary = f"----SicoExample{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks += [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode(),
            b"\r\n",
        ]
    chunks += [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n'.encode(),
        b"Content-Type: application/zip\r\n\r\n",
        file_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    return _send(
        path, method="POST", body=b"".join(chunks), content_type=f"multipart/form-data; boundary={boundary}", token=token
    )


def _send(path: str, *, method: str, body: bytes | None, content_type: str | None, token: str | None) -> dict[str, Any]:
    url = f"{BASE_URL}{path if path.startswith('/') else '/' + path}"
    headers: dict[str, str] = {}
    if content_type:
        headers["Content-Type"] = content_type
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = request.Request(url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason} for {method} {path}: {details}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Request failed for {method} {path}: {exc}") from exc
    data = json.loads(raw) if raw else {}
    code = data.get("code")
    if code not in (None, 0):
        raise RuntimeError(f"{path} returned code={code} msg={data.get('msg')!r}")
    return data


# ---------------------------------------------------------------------------
# Skill package

INLINE_SKILL_MD = """\
---
name: {name}
description: {desc}
argument-hint: Describe the topic to research and the desired depth.
---

# {title} Skill

A minimal skill scaffold created by examples/agent/create_dw_type.py.

## When to use

- The user asks for a structured research brief on a public topic.
- Source links and short summaries are acceptable as output.

## Workflow

1. **Clarify scope**: confirm the topic, time range, and required depth.
2. **Search**: use the `web_search` tool (or any available browsing tool) to
   gather 5-10 high-quality sources.
3. **Synthesize**: deduplicate and organize findings into:
   - TL;DR (3 bullets)
   - Key facts (bulleted, with inline `[source]` markers)
   - Open questions / contradictions
   - Source list (title + URL)
4. **Deliver**: respond in Markdown using the structure above.

## Constraints

- Do not fabricate sources. If a fact has no source, mark it `(unverified)`.
- Prefer primary sources over aggregators when available.
"""


def build_inline_skill_zip() -> tuple[str, bytes]:
    """Build a tiny in-memory zip containing just a SKILL.md."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            f"{SKILL_NAME}/SKILL.md",
            INLINE_SKILL_MD.format(
                name=SKILL_NAME,
                desc=SKILL_DESC,
                title=SKILL_NAME.replace("-", " ").title(),
            ),
        )
    return f"{SKILL_NAME}.zip", buf.getvalue()


def load_skill_dir(path: Path) -> tuple[str, bytes]:
    if not path.exists():
        raise RuntimeError(f"SKILL_DIR does not exist: {path}")
    if path.is_file():
        return path.name, path.read_bytes()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        for child in sorted(path.rglob("*")):
            if child.is_file():
                z.write(child, child.relative_to(path.parent))
    return f"{path.name}.zip", buf.getvalue()


# ---------------------------------------------------------------------------
# Flow steps


def login() -> str:
    print(f"[1/5] Login {EMAIL} @ {BASE_URL}")
    resp = _post_json(
        "/api/sico/rbac/login",
        {"email": EMAIL, "password": PASSWORD},
    )
    token = resp["data"]["tokenInfo"]["accessToken"]
    print("      ok, got JWT")
    return token


def upload_skill_asset(token: str) -> int:
    if SKILL_DIR:
        file_name, blob = load_skill_dir(Path(SKILL_DIR).expanduser().resolve())
        print(f"[2/5] Upload skill from {SKILL_DIR} ({len(blob)} bytes)")
    else:
        file_name, blob = build_inline_skill_zip()
        print(f"[2/5] Upload inline demo skill {file_name!r} ({len(blob)} bytes)")
    resp = _post_multipart(
        "/api/sico/project/asset",
        fields={"project_id": str(PROJECT_ID)},
        file_name=file_name,
        file_bytes=blob,
        token=token,
    )
    asset_id = int(resp["data"]["id"])
    print(f"      assetId = {asset_id}")
    return asset_id


def create_dw(token: str) -> str:
    print(f"[3/5] Create DW name={DW_TYPE_NAME!r} role={DW_TYPE_ROLE!r}")
    payload: dict[str, Any] = {
        "name": DW_TYPE_NAME,
        "desc": DW_TYPE_DESC,
        "iconUri": "",
        "role": DW_TYPE_ROLE,
    }
    if DW_MODEL_KEY:
        payload["llmhubConfig"] = {
            "modelKeys": [DW_MODEL_KEY],
            "defaultGlobalModelKey": DW_MODEL_KEY,
        }
    resp = _post_json("/api/sico/agent/single_agent", payload, token=token)
    agent_id = resp["data"]["agentId"]
    print(f"      agentId = {agent_id}")
    return agent_id


def register_skill(token: str, asset_id: int, agent_id: str) -> dict[str, Any]:
    print(f"[4/5] Register skill (assetId={asset_id}) -> DW {agent_id}")
    # Skill must be scoped to either a project OR an agent, not both.
    # We bind it to the DW we just created.
    resp = _post_json(
        "/api/sico/skills",
        {"agentId": agent_id, "assetId": asset_id},
        token=token,
    )
    skill = resp["data"]["skill"]
    print(f"      skillId = {skill.get('id')} name={skill.get('name')!r} status={skill.get('status')}")
    return skill


def deploy_dw(token: str, agent_id: str) -> dict[str, Any]:
    print(f"[5/5] Deploy DW {agent_id}")
    resp = _post_json(
        "/api/sico/agent/single_agent/deploy",
        {"agentId": agent_id, "name": DW_TYPE_NAME},
        token=token,
    )
    data = resp["data"]
    print(f"      instance id = {data.get('id')} employer = {data.get('employerUsername')}")
    return data


def main() -> int:
    token = login()
    asset_id = upload_skill_asset(token)
    agent_id = create_dw(token)
    skill = register_skill(token, asset_id, agent_id)
    instance = deploy_dw(token, agent_id)

    print("\nDone. Summary:")
    print(
        json.dumps(
            {
                "email": EMAIL,
                "projectId": PROJECT_ID,
                "agentId": agent_id,
                "assetId": asset_id,
                "skill": skill,
                "instance": instance,
                "accessToken": token,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        sys.exit(1)
