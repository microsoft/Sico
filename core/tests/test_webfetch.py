from __future__ import annotations

from typing import Any

import pytest
import requests

from app.tools import webfetch


class FakeResponse:
    def __init__(self, text: str, content_type: str, *, ok: bool = True) -> None:
        self.text = text
        self.content = text.encode("utf-8")
        self.headers = {"content-type": content_type}
        self.ok = ok
        self.status_code = 200 if ok else 500


@pytest.mark.asyncio
async def test_webfetch_uses_title_from_html_response(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    def fake_get(url: str, **kwargs: Any) -> FakeResponse:
        calls.append({"url": url, **kwargs})
        return FakeResponse(
            "<html><head><title>Canonical title</title></head><body><h1>Body heading</h1></body></html>",
            "text/html; charset=utf-8",
        )

    monkeypatch.setattr(webfetch.requests, "get", fake_get)

    result = await webfetch.fetch_url_as_markdown("https://example.com/article")

    assert result["title"] == "Canonical title"
    assert "# Body heading" in result["content"]
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_webfetch_preserves_native_markdown_and_fetches_canonical_html_title(monkeypatch: pytest.MonkeyPatch) -> None:
    markdown = "# Function calling\n\nNative Markdown body."
    accepts: list[str] = []

    def fake_get(_url: str, **kwargs: Any) -> FakeResponse:
        accept = kwargs["headers"]["Accept"]
        accepts.append(accept)
        if accept == webfetch._HTML_ACCEPT_HEADER:
            return FakeResponse(
                "<html><head><title>Function calling | OpenAI API</title></head></html>",
                "text/html; charset=utf-8",
            )
        return FakeResponse(markdown, "text/markdown; charset=utf-8")

    monkeypatch.setattr(webfetch.requests, "get", fake_get)

    result = await webfetch.fetch_url_as_markdown("https://developers.openai.com/api/docs/guides/function-calling")

    assert result["content"] == markdown
    assert result["title"] == "Function calling | OpenAI API"
    assert accepts == [webfetch._ACCEPT_HEADER, webfetch._HTML_ACCEPT_HEADER]


@pytest.mark.asyncio
async def test_webfetch_falls_back_to_markdown_h1_when_title_request_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    markdown = "# Local fallback\n\nNative Markdown body."
    calls = 0

    def fake_get(_url: str, **_kwargs: Any) -> FakeResponse:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise requests.Timeout("title request timed out")
        return FakeResponse(markdown, "text/markdown; charset=utf-8")

    monkeypatch.setattr(webfetch.requests, "get", fake_get)

    result = await webfetch.fetch_url_as_markdown("https://example.com/article")

    assert result["error_message"] == ""
    assert result["content"] == markdown
    assert result["title"] == "Local fallback"


@pytest.mark.asyncio
async def test_webfetch_skips_title_request_when_timeout_budget_is_exhausted(monkeypatch: pytest.MonkeyPatch) -> None:
    markdown = "# Local fallback\n\nNative Markdown body."
    calls = 0
    timestamps = iter((100.0, 130.0))

    def fake_get(_url: str, **_kwargs: Any) -> FakeResponse:
        nonlocal calls
        calls += 1
        return FakeResponse(markdown, "text/markdown; charset=utf-8")

    monkeypatch.setattr(webfetch, "monotonic", lambda: next(timestamps))
    monkeypatch.setattr(webfetch.requests, "get", fake_get)

    result = await webfetch.fetch_url_as_markdown("https://example.com/article", timeout=30)

    assert calls == 1
    assert result["error_message"] == ""
    assert result["content"] == markdown
    assert result["title"] == "Local fallback"
