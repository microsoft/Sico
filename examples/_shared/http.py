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

"""Standard-library helpers for runnable Sico examples.

These utilities intentionally avoid third-party dependencies so examples can be
run with the system Python.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any
from urllib import error, parse, request


DEFAULT_BASE_URL = "http://localhost:8080"


def base_url() -> str:
    return os.environ.get("BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Set {name} before running this example.")
    return value


def bearer_headers(token: str | None = None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    auth_token = token or os.environ.get("TOKEN", "").strip()
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    return headers


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    return int(value)


def json_request(
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    url = build_url(path, query=query)
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = dict(headers or {})
    if body is not None and "Content-Type" not in request_headers:
        request_headers["Content-Type"] = "application/json"
    req = request.Request(url, data=body, headers=request_headers, method=method)

    raw = _request_bytes(req, timeout)

    if not raw:
        return {}

    data = json.loads(raw)
    code = data.get("code")
    if code not in (None, 0):
        raise RuntimeError(data.get("msg") or f"Server returned code={code}")
    return data


def multipart_request(
    path: str,
    *,
    fields: dict[str, Any] | None = None,
    files: dict[str, tuple[str, bytes, str]] | None = None,
    headers: dict[str, str] | None = None,
    method: str = "POST",
    timeout: int = 60,
) -> dict[str, Any]:
    boundary = f"----SicoExample{uuid.uuid4().hex}"
    body = _encode_multipart(fields or {}, files or {}, boundary)
    request_headers = dict(headers or {})
    request_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"

    req = request.Request(build_url(path), data=body, headers=request_headers, method=method)
    raw = _request_bytes(req, timeout)
    data = json.loads(raw.decode("utf-8"))
    code = data.get("code")
    if code not in (None, 0):
        raise RuntimeError(data.get("msg") or f"Server returned code={code}")
    return data


def post_sse(
    path: str,
    *,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    timeout: int = 300,
):
    body = json.dumps(payload).encode("utf-8")
    request_headers = dict(headers or {})
    if "Content-Type" not in request_headers:
        request_headers["Content-Type"] = "application/json"
    req = request.Request(build_url(path), data=body, headers=request_headers, method="POST")

    try:
        with request.urlopen(req, timeout=timeout) as resp:
            event_name = "message"
            data_lines: list[str] = []

            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    if data_lines:
                        yield event_name, "\n".join(data_lines)
                    event_name = "message"
                    data_lines = []
                    continue

                if line.startswith("event:"):
                    event_name = line.removeprefix("event:").strip() or "message"
                elif line.startswith("data:"):
                    data_lines.append(line.removeprefix("data:").lstrip())

            if data_lines:
                yield event_name, "\n".join(data_lines)
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {details}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc


def build_url(path: str, *, query: dict[str, Any] | None = None) -> str:
    full_path = path if path.startswith("/") else f"/{path}"
    url = f"{base_url()}{full_path}"
    if query:
        encoded = parse.urlencode({key: value for key, value in query.items() if value is not None})
        url = f"{url}?{encoded}"
    return url


def print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _request_bytes(req: request.Request, timeout: int) -> bytes:
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {details}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc


def _encode_multipart(
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]],
    boundary: str,
) -> bytes:
    chunks: list[bytes] = []
    boundary_line = f"--{boundary}\r\n".encode("utf-8")

    for name, value in fields.items():
        chunks.extend(
            [
                boundary_line,
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )

    for field_name, (file_name, file_bytes, content_type) in files.items():
        chunks.extend(
            [
                boundary_line,
                (
                    f'Content-Disposition: form-data; name="{field_name}"; '
                    f'filename="{file_name}"\r\n'
                ).encode("utf-8"),
                f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
                file_bytes,
                b"\r\n",
            ]
        )

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks)
