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

"""Async HTTP client for sandbox OpenAPI-generated tools."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol

import requests

from app.biz.reverse_grpc.sandbox import AioSandboxHttpFormField, ReverseSandboxService

_LOGGER = logging.getLogger(__name__)

_AIO_PROXY_PREFIX = "/api/sico/sandbox/resources/aio/"

Headers = dict[str, str]


@dataclass(slots=True)
class SandboxRequestOptions:
    agent_instance_id: int | str | None = None
    query: dict[str, Any] | None = None
    json_body: dict[str, Any] | None = None
    multipart_fields: dict[str, Any] | None = None
    headers: Headers | None = None


@dataclass(slots=True)
class RequestFormData:
    data: dict[str, str]
    files: dict[str, tuple[str, bytes]]


@dataclass(slots=True)
class RequestContext:
    method: str
    url: str
    headers: Headers
    query: dict[str, Any] | None
    json_body: dict[str, Any] | None
    form_data: RequestFormData | None


class RequestHandler(Protocol):
    async def __call__(self, ctx: RequestContext) -> dict[str, Any]: ...


class Middleware(Protocol):
    async def handle(self, ctx: RequestContext, next_handler: RequestHandler) -> dict[str, Any]: ...


class HttpToolClient:
    def __init__(
        self,
        default_headers: Headers | None = None,
        middleware: list[Middleware] | None = None,
        timeout: float = 60.0,
    ) -> None:
        self._default_headers = default_headers or {}
        self._middleware = middleware or []
        self._timeout = timeout

    async def close(self) -> None:
        return None

    async def request(
        self,
        method: str,
        path: str,
        *,
        base_url: str,
        options: SandboxRequestOptions | None = None,
        **legacy_options: Any,
    ) -> dict[str, Any]:
        request_options = _merge_options(options, legacy_options)

        if _is_aio_proxy_base_url(base_url):
            return await _proxy_aio_http_over_rgrpc(
                method=method,
                base_url=base_url,
                agent_instance_id=request_options.agent_instance_id,
                path=path,
                query=request_options.query,
                json_body=request_options.json_body,
                multipart_fields=request_options.multipart_fields,
            )

        context = RequestContext(
            method=method,
            url=_join_url(_resolve_base_url(base_url), path),
            headers={**self._default_headers, **(request_options.headers or {})},
            query=request_options.query,
            json_body=request_options.json_body,
            form_data=_build_form_data(request_options.multipart_fields),
        )

        handler: RequestHandler = self._send
        for middleware in reversed(self._middleware):
            handler = _wrap(middleware, handler)

        return await handler(context)

    async def _send(self, ctx: RequestContext) -> dict[str, Any]:
        return await asyncio.to_thread(self._send_sync, ctx)

    def _send_sync(self, ctx: RequestContext) -> dict[str, Any]:
        request_kwargs: dict[str, Any] = {
            "method": ctx.method,
            "url": ctx.url,
            "headers": ctx.headers,
            "params": ctx.query,
            "timeout": self._timeout,
        }
        if ctx.form_data is not None:
            request_kwargs["data"] = ctx.form_data.data or None
            request_kwargs["files"] = ctx.form_data.files or None
        elif ctx.json_body is not None:
            request_kwargs["json"] = ctx.json_body

        response = requests.request(**request_kwargs)
        body: Any = response.text
        content_type = response.headers.get("content-type", "")
        if "json" in content_type.lower():
            try:
                body = response.json()
            except json.JSONDecodeError:
                _LOGGER.warning(
                    "HTTP %s %s returned JSON content-type but body is not valid JSON",
                    ctx.method,
                    ctx.url,
                )
        return {"status": response.status_code, "body": body}


def _merge_options(options: SandboxRequestOptions | None, values: dict[str, Any]) -> SandboxRequestOptions:
    base = options or SandboxRequestOptions()
    return SandboxRequestOptions(
        agent_instance_id=_option_value(values, "agent_instance_id", base.agent_instance_id),
        query=_option_value(values, "query", base.query),
        json_body=_option_value(values, "json_body", base.json_body),
        multipart_fields=_option_value(values, "multipart_fields", base.multipart_fields),
        headers={**(base.headers or {}), **(values.get("headers") or {})},
    )


def _option_value(values: dict[str, Any], key: str, default: Any) -> Any:
    value = values.get(key)
    return default if value is None else value


def _wrap(middleware: Middleware, next_handler: RequestHandler) -> RequestHandler:
    async def handler(ctx: RequestContext) -> dict[str, Any]:
        return await middleware.handle(ctx, next_handler)

    return handler


def _resolve_base_url(base_url: str) -> str:
    value = str(base_url or "").strip()
    if not value:
        raise ValueError("base_url is required")
    if value.startswith(("http://", "https://")):
        return value
    raise ValueError(f"Unsupported relative sandbox base_url: {value}")


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{str(path).lstrip('/')}"


def _is_aio_proxy_base_url(base_url: str) -> bool:
    return str(base_url or "").strip().startswith(_AIO_PROXY_PREFIX)


async def _proxy_aio_http_over_rgrpc(
    *,
    method: str,
    base_url: str,
    agent_instance_id: int | str | None,
    path: str,
    query: dict[str, Any] | None,
    json_body: dict[str, Any] | None,
    multipart_fields: dict[str, Any] | None,
) -> dict[str, Any]:
    normalized_agent_instance_id = str(agent_instance_id or "").strip()
    if not normalized_agent_instance_id:
        raise ValueError("agent_instance_id is required for aio sandbox HTTP tools")

    service = ReverseSandboxService.get_instance()
    response = await asyncio.to_thread(
        service.proxy_aio_http,
        agent_instance_id=normalized_agent_instance_id,
        proxy_base_path=base_url,
        method=method,
        path=path,
        query=query,
        json_body=json_body,
        form_fields=_build_aio_proxy_form_fields(multipart_fields),
    )

    body: Any = response.body_text
    if response.content_type and "json" in response.content_type.lower():
        try:
            body = json.loads(response.body_text)
        except json.JSONDecodeError:
            _LOGGER.warning("rgrpc aio proxy returned JSON content-type but body is not valid JSON")
    return {"status": response.status_code, "body": body}


def _build_form_data(multipart_fields: dict[str, Any] | None) -> RequestFormData | None:
    if not multipart_fields:
        return None

    data: dict[str, str] = {}
    files: dict[str, tuple[str, bytes]] = {}
    for key, value in multipart_fields.items():
        if isinstance(value, bytes):
            files[key] = (key, value)
        else:
            data[key] = str(value)
    return RequestFormData(data=data, files=files)


def _build_aio_proxy_form_fields(multipart_fields: dict[str, Any] | None) -> list[AioSandboxHttpFormField]:
    fields: list[AioSandboxHttpFormField] = []
    for key, value in (multipart_fields or {}).items():
        if isinstance(value, bytes):
            fields.append(
                AioSandboxHttpFormField(
                    name=key,
                    bytes_value=value,
                    file_name=key,
                    content_type="application/octet-stream",
                )
            )
            continue
        fields.append(AioSandboxHttpFormField(name=key, text_value=str(value)))
    return fields
