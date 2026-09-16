import logging
from time import monotonic
from typing import Any

import requests
from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from bs4 import BeautifulSoup
from markdownify import markdownify
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolExecutionInfo, ToolType
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5MB
_DEFAULT_TIMEOUT = 30  # seconds
_MAX_TIMEOUT = 120  # seconds

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

_ACCEPT_HEADER = "text/html,application/xhtml+xml,application/xml;q=0.9,text/markdown;q=0.8,text/plain;q=0.7,*/*;q=0.1"
_HTML_ACCEPT_HEADER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"


def _convert_html_to_markdown(html: str) -> str:
    return markdownify(
        html,
        heading_style="ATX",
        bullets="-",
        code_language="",
        strip=["script", "style", "meta", "link"],
    )


def _extract_html_title(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    if soup.title is None:
        return ""
    return soup.title.get_text(" ", strip=True)


def _extract_markdown_title(markdown: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _request_headers(accept: str) -> dict[str, str]:
    return {
        "User-Agent": _USER_AGENT,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
    }


def _response_too_large(response: requests.Response) -> bool:
    content_length = response.headers.get("content-length")
    if content_length and int(content_length) > _MAX_RESPONSE_SIZE:
        return True
    return len(response.content) > _MAX_RESPONSE_SIZE


def _fetch_html_title(url: str, timeout: float) -> str:
    try:
        response = requests.get(
            url,
            headers=_request_headers(_HTML_ACCEPT_HEADER),
            timeout=timeout,
            allow_redirects=True,
        )
        if not response.ok or _response_too_large(response):
            return ""
        if "text/html" not in response.headers.get("content-type", ""):
            return ""
        return _extract_html_title(response.text)
    except Exception as exc:
        _LOGGER.warning("WebFetch title lookup failed url=%s error=%s", url, exc)
        return ""


class WebFetchInput(BaseModel):
    url: str = Field(
        description="The URL to fetch content from. Must be a fully-formed valid URL starting with http:// or https://."
    )
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
        url = "https://" + url[len("http://") :]
    return url, None


async def _perform_webfetch(
    url: str,
    timeout: int,
    ctx: ToolContext | None,
    tool_call_id: str,
) -> dict[str, Any]:
    deadline = monotonic() + timeout
    response = requests.get(
        url,
        headers=_request_headers(_ACCEPT_HEADER),
        timeout=timeout,
        allow_redirects=True,
    )

    if _response_too_large(response):
        return {"error_message": "Response too large (exceeds 5MB limit)", "content": ""}

    if not response.ok:
        return {"error_message": f"Request failed with status code: {response.status_code}", "content": ""}

    content_type = response.headers.get("content-type", "")
    content = response.text
    title = ""

    if "text/html" in content_type:
        title = _extract_html_title(content)
        content = _convert_html_to_markdown(content)
    elif "text/markdown" in content_type:
        remaining_timeout = deadline - monotonic()
        if remaining_timeout > 0:
            title = _fetch_html_title(url, remaining_timeout)

    if not title:
        title = _extract_markdown_title(content)

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


async def fetch_url_as_markdown(url: str, timeout: int = _DEFAULT_TIMEOUT) -> dict[str, Any]:
    normalized_url, error = _validate_and_normalize_url(url.strip())
    if error is not None:
        return {"error_message": error, "content": ""}

    bounded_timeout = min(max(timeout, 1), _MAX_TIMEOUT)
    return await _perform_webfetch(normalized_url, bounded_timeout, None, "")


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
        "Web Fetch", f"Fetching URL: {url}", ToolExecutionInfo(tool_type=ToolType.BUILTIN, builtin_tool_name="webfetch")
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
        "- Maximum response size: 5MB\n"
        "- Default timeout: 30s, maximum: 120s\n"
        "- If the fetched content is very large, it will be automatically truncated. The full\n"
        "  content is saved to a temporary file in the workspace. An AI-generated summary may be\n"
        "  included in the tool response. Use the read or grep tool to inspect the full content."
    ),
    additional_properties={"summarize_on_truncate": True},
    input_model=WebFetchInput,
    func=_webfetch_func,
)
