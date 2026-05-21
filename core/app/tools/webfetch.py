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

import logging
from typing import Any

import requests
from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from markdownify import markdownify
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolExecutionInfo, ToolType
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5MB
_DEFAULT_TIMEOUT = 30  # seconds
_MAX_TIMEOUT = 120  # seconds

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/143.0.0.0 Safari/537.36"
)

_ACCEPT_HEADER = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,"
    "text/markdown;q=0.8,text/plain;q=0.7,*/*;q=0.1"
)


def _convert_html_to_markdown(html: str) -> str:
    return markdownify(
        html,
        heading_style="ATX",
        bullets="-",
        code_language="",
        strip=["script", "style", "meta", "link"],
    )


class WebFetchInput(BaseModel):
    url: str = Field(description="The URL to fetch content from. Must be a fully-formed valid URL starting with http:// or https://.")
    timeout: int | None = Field(
        default=None,
        description=f"Optional timeout in seconds (max {_MAX_TIMEOUT}). Defaults to {_DEFAULT_TIMEOUT}s.",
    )


def _validate_and_normalize_url(url: str) -> tuple[str | None, str | None]:
    if not url:
        return None, "url is required"
    if not url.startswith("http://") and not url.startswith("https://"):
        return None, "URL must start with http:// or https://"
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    return url, None


async def _perform_webfetch(
    url: str,
    timeout: int,
    ctx: ToolContext | None,
    tool_call_id: str,
) -> dict[str, Any]:
    headers = {
        "User-Agent": _USER_AGENT,
        "Accept": _ACCEPT_HEADER,
        "Accept-Language": "en-US,en;q=0.9",
    }

    response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)

    content_length = response.headers.get("content-length")
    if content_length and int(content_length) > _MAX_RESPONSE_SIZE:
        return {"error_message": "Response too large (exceeds 5MB limit)", "content": ""}

    if len(response.content) > _MAX_RESPONSE_SIZE:
        return {"error_message": "Response too large (exceeds 5MB limit)", "content": ""}

    if not response.ok:
        return {"error_message": f"Request failed with status code: {response.status_code}", "content": ""}

    content_type = response.headers.get("content-type", "")
    content = response.text
    title = f"{url} ({content_type})"

    if "text/html" in content_type:
        content = _convert_html_to_markdown(content)

    ret: dict[str, Any] = {
        "error_message": "",
        "content": content,
        "title": title,
        "url": url,
    }
    if ctx:
        message = f"Fetched {len(content)} bytes from {url}"
        await ctx.plan_editor.update_tool_call_message(tool_call_id, message)
        ret["tool_call_id"] = tool_call_id
        ret["message"] = message

    return ret


async def _webfetch_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    url, err = _validate_and_normalize_url(str(kwargs.get("url", "")).strip())
    if err is not None:
        return {"error_message": err, "content": ""}

    timeout_raw = kwargs.get("timeout")
    timeout = min(int(timeout_raw) if timeout_raw is not None else _DEFAULT_TIMEOUT, _MAX_TIMEOUT)
    timeout = max(1, timeout)

    _LOGGER.info("WebFetch tool start url=%s timeout=%s", url, timeout)

    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    tool_call_id = await ctx.plan_editor.create_tool_call(
        "Web Fetch", f"Fetching URL: {url}",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="webfetch"
        )
    )

    try:
        return await _perform_webfetch(url, timeout, ctx, tool_call_id)

    except requests.Timeout:
        _LOGGER.warning("WebFetch tool timed out url=%s", url)
        if ctx:
            await ctx.plan_editor.update_tool_call_message(tool_call_id, f"Request timed out after {timeout}s")
        return {"error_message": f"Request timed out after {timeout}s", "content": ""}

    except requests.ConnectionError as exc:
        _LOGGER.warning("WebFetch tool connection error url=%s error=%s", url, exc)
        if ctx:
            await ctx.plan_editor.update_tool_call_message(tool_call_id, "Connection error.")
        return {"error_message": f"Connection error: {exc}", "content": ""}

    except Exception as exc:
        _LOGGER.error("WebFetch tool failed url=%s error=%s", url, exc)
        if ctx:
            await ctx.plan_editor.update_tool_call_message(tool_call_id, "Failed to fetch URL.")
        return {"error_message": str(exc), "content": ""}


WEBFETCH_TOOL = FunctionTool(
    name="webfetch",
    description=(
        "Fetch content from a specified URL and return it as markdown.\n"
        "Takes a URL as input, fetches the content, and converts HTML pages to markdown.\n"
        "Use this tool when you need to retrieve and analyze web content.\n\n"
        "Usage notes:\n"
        "- The URL must be a fully-formed valid URL starting with http:// or https://\n"
        "- HTTP URLs will be automatically upgraded to HTTPS\n"
        "- HTML content is automatically converted to markdown\n"
        "- This tool is read-only and does not modify any files\n"
        "- Results may be summarized if the content is very large\n"
        "- Maximum response size: 5MB\n"
        "- Default timeout: 30s, maximum: 120s"
    ),
    input_model=WebFetchInput,
    func=_webfetch_func,
)
