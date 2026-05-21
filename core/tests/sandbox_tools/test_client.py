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

import pytest

from app.tools.sandbox_tools import client as client_module
from app.tools.sandbox_tools.client import HttpToolClient, SandboxRequestOptions


@pytest.mark.asyncio
async def test_request_builds_request_context_from_options(monkeypatch: pytest.MonkeyPatch) -> None:
    client = HttpToolClient(default_headers={"X-Default": "default"})
    captured: dict[str, object] = {}

    async def fake_send(ctx: object) -> dict[str, object]:
        captured["ctx"] = ctx
        return {"status": 200, "body": {"ok": True}}

    monkeypatch.setattr(client, "_send", fake_send)

    response = await client.request(
        "POST",
        "/v1/tools/run",
        base_url="https://sandbox.example.com/api",
        options=SandboxRequestOptions(
            query={"page": 1},
            json_body={"task": "demo"},
            headers={"X-Request": "request"},
        ),
    )

    ctx = captured["ctx"]
    assert response == {"status": 200, "body": {"ok": True}}
    assert ctx.method == "POST"
    assert ctx.url == "https://sandbox.example.com/api/v1/tools/run"
    assert ctx.headers == {"X-Default": "default", "X-Request": "request"}
    assert ctx.query == {"page": 1}
    assert ctx.json_body == {"task": "demo"}
    assert ctx.form_data is None


@pytest.mark.asyncio
async def test_request_forwards_options_to_aio_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_proxy(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"status": 202, "body": {"proxied": True}}

    monkeypatch.setattr(client_module, "_proxy_aio_http_over_rgrpc", fake_proxy)

    response = await HttpToolClient().request(
        "POST",
        "/run",
        base_url=f"{client_module._AIO_PROXY_PREFIX}demo",
        options=SandboxRequestOptions(
            agent_instance_id=123,
            query={"q": "value"},
            json_body={"task": "demo"},
            multipart_fields={"file": b"payload"},
        ),
    )

    assert response == {"status": 202, "body": {"proxied": True}}
    assert captured == {
        "method": "POST",
        "base_url": f"{client_module._AIO_PROXY_PREFIX}demo",
        "agent_instance_id": 123,
        "path": "/run",
        "query": {"q": "value"},
        "json_body": {"task": "demo"},
        "multipart_fields": {"file": b"payload"},
    }
