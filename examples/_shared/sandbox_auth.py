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

"""Helpers for sandbox-client HMAC examples."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid


def secret_env_key(client_id: str) -> str:
    sanitized = client_id.upper().replace("-", "_")
    return f"SANDBOX_CLIENT_SECRET_{sanitized}"


def resolve_secret(client_id: str) -> str:
    key = secret_env_key(client_id)
    value = os.environ.get(key, "").strip()
    if not value:
        raise RuntimeError(f"Set {key} before running this example.")
    return value


def signed_headers(
    client_id: str,
    *,
    instance_id: int | str,
    secret: str | None = None,
) -> dict[str, str]:
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    payload = f"{client_id}|{timestamp}|{nonce}"
    signature = hmac.new(
        (secret or resolve_secret(client_id)).encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    context_key = "agentInstanceId" if str(instance_id).isdigit() else "instanceId"
    context_value = int(instance_id) if str(instance_id).isdigit() else str(instance_id)
    context_json = json.dumps({context_key: context_value}, separators=(",", ":"))

    return {
        "X-Sico-Context": context_json,
        "X-Sico-Client-Id": client_id,
        "X-Sico-Timestamp": timestamp,
        "X-Sico-Nonce": nonce,
        "X-Sico-Signature": signature,
        "Content-Type": "application/json",
    }
