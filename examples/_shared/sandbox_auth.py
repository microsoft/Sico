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
