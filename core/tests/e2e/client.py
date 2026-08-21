"""HTTP/SSE transport for the chat acceptance suite."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

SseEvent = tuple[str, str, float]


class ChatClient:
    def __init__(self, base_url: str, email: str, password: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = ""
        self.token = self._login(email, password)

    def _login(self, email: str, password: str) -> str:
        payload = self.json_request("/api/sico/rbac/login", method="POST", payload={"email": email, "password": password})
        token = payload.get("data", {}).get("tokenInfo", {}).get("accessToken", "")
        if not token:
            raise RuntimeError("login did not return an access token")
        return token

    def json_request(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        timeout: int = 60,
    ) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self._url(path, query), data=body, headers=headers, method=method)
        raw = _read(request, timeout)
        if not raw:
            return {}
        data = json.loads(raw.decode("utf-8"))
        code = data.get("code")
        if code not in (None, 0):
            raise RuntimeError(data.get("msg") or f"server returned code={code}")
        return data

    def stream_chat(self, message: str, agent_instance_id: int, *, timeout: int) -> list[SseEvent]:
        body = json.dumps({"message": message, "agentInstanceId": agent_instance_id, "attachments": []}).encode("utf-8")
        request = urllib.request.Request(
            self._url("/api/sico/conversation/chat", None),
            data=body,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            method="POST",
        )
        started = time.perf_counter()
        events: list[SseEvent] = []
        with urllib.request.urlopen(request, timeout=timeout) as response:
            name = "message"
            data_lines: list[str] = []
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    if data_lines:
                        events.append((name, "\n".join(data_lines), time.perf_counter() - started))
                    name, data_lines = "message", []
                    continue
                if line.startswith("event:"):
                    name = line.removeprefix("event:").strip() or "message"
                elif line.startswith("data:"):
                    data_lines.append(line.removeprefix("data:").lstrip())
            if data_lines:
                events.append((name, "\n".join(data_lines), time.perf_counter() - started))
        return events

    def agent_instance_ids_by_role(self) -> dict[str, int]:
        payload = self.json_request("/api/sico/agent/single_agent_instances", query={"page": 1, "pageSize": 50})
        instances = payload.get("data", {}).get("instances") or []
        ids: dict[str, int] = {}
        for instance in instances:
            if not isinstance(instance, dict):
                continue
            role = str(instance.get("role") or "")
            instance_id = _int_or_zero(instance.get("id"))
            if role and instance_id and role not in ids:
                ids[role] = instance_id
        return ids

    def plan(self, *, agent_instance_id: int, turn_id: int, conversation_id: int) -> dict[str, Any] | None:
        try:
            return self.json_request(
                "/api/sico/conversation/plan",
                query={"agentInstanceId": agent_instance_id, "turnId": turn_id, "conversationId": conversation_id},
            )
        except Exception:
            return None

    def batch_summaries(self, *, conversation_id: int, turn_id: int) -> list[dict[str, Any]]:
        # The batch rows are written after the SSE stream closes, so poll briefly.
        for attempt in range(6):
            payload = self.json_request(
                "/api/sico/conversation/batch_summaries",
                query={"conversationId": conversation_id, "turnId": turn_id, "page": 1, "pageSize": 20},
            )
            items = payload.get("data", {}).get("items") or []
            if items or attempt == 5:
                return items
            time.sleep(0.5)
        return []

    def _url(self, path: str, query: dict[str, Any] | None) -> str:
        if path.startswith(("http://", "https://")):
            url = path
        else:
            url = f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})}"
        return url


def _read(request: urllib.request.Request, timeout: int) -> bytes:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {exc.read().decode('utf-8', errors='replace')}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"request failed: {exc}") from exc


def _int_or_zero(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
