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

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
import pytest

from android_tester import utils
from android_tester.utils import fetch_apk

APK_BYTES = b"PK\x03\x04fake-apk-payload"


# ---------------------------------------------------------------------------
# Local-source branch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_local_source_yields_existing_path(tmp_path: Path) -> None:
    apk = tmp_path / "app.apk"
    apk.write_bytes(APK_BYTES)

    async with fetch_apk(str(apk)) as path:
        assert path.is_file()
        assert path.read_bytes() == APK_BYTES


@pytest.mark.asyncio
async def test_local_source_yields_absolute_normalized_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Relative + `..` segments are normalised to an absolute path."""
    sub = tmp_path / "sub"
    sub.mkdir()
    apk = sub / "app.apk"
    apk.write_bytes(APK_BYTES)

    monkeypatch.chdir(sub)
    relative = os.path.join("..", "sub", "app.apk")

    async with fetch_apk(relative) as path:
        assert path.is_absolute()
        assert path == apk.resolve()


@pytest.mark.asyncio
async def test_local_source_expands_user(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apk = tmp_path / "app.apk"
    apk.write_bytes(APK_BYTES)

    # Point ~ at tmp_path so ~/app.apk resolves to our fixture file.
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    async with fetch_apk("~/app.apk") as path:
        assert path == apk.resolve()


@pytest.mark.asyncio
async def test_local_source_missing_raises(tmp_path: Path) -> None:
    missing = tmp_path / "nope.apk"

    with pytest.raises(FileNotFoundError) as excinfo:
        async with fetch_apk(str(missing)):
            pass

    # Source string is surfaced in the error message (repr-quoted).
    assert repr(str(missing)) in str(excinfo.value)


@pytest.mark.asyncio
async def test_local_source_directory_raises(tmp_path: Path) -> None:
    """A directory must not satisfy ``is_file``."""
    with pytest.raises(FileNotFoundError):
        async with fetch_apk(str(tmp_path)):
            pass


@pytest.mark.asyncio
async def test_local_source_yields_same_path_each_call(
    tmp_path: Path,
) -> None:
    """Local sources are not copied — the path is the real file."""
    apk = tmp_path / "app.apk"
    apk.write_bytes(APK_BYTES)

    async with fetch_apk(str(apk)) as p1:
        first = p1
    async with fetch_apk(str(apk)) as p2:
        assert p2 == first
        assert p2.exists()  # not deleted on exit


@pytest.mark.asyncio
async def test_unknown_scheme_falls_through_to_local(
    tmp_path: Path,
) -> None:
    """Schemes other than http/https are treated as local paths."""
    with pytest.raises(FileNotFoundError):
        async with fetch_apk("ftp://example.com/app.apk"):
            pass


# ---------------------------------------------------------------------------
# URL-source branch (httpx mocked via MockTransport)
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_httpx(monkeypatch: pytest.MonkeyPatch):
    """Replace `utils.httpx.AsyncClient` with a factory that injects
    an `httpx.MockTransport`. Returns an installer accepting a handler
    `Callable[[httpx.Request], httpx.Response]`.
    """
    real_client = httpx.AsyncClient

    def install(handler):
        def factory(*args, **kwargs):
            kwargs.pop("transport", None)
            return real_client(
                *args,
                transport=httpx.MockTransport(handler),
                **kwargs,
            )

        monkeypatch.setattr(utils.httpx, "AsyncClient", factory)

    return install


@pytest.mark.asyncio
async def test_http_source_downloads_and_yields_temp_path(
    mock_httpx,
) -> None:
    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        return httpx.Response(200, content=APK_BYTES)

    mock_httpx(handler)

    async with fetch_apk("http://example.com/app.apk") as path:
        assert path.is_file()
        assert path.read_bytes() == APK_BYTES
        assert path.suffix == ".apk"

    assert seen_urls == ["http://example.com/app.apk"]


@pytest.mark.asyncio
async def test_https_source_downloads(mock_httpx) -> None:
    mock_httpx(lambda _req: httpx.Response(200, content=APK_BYTES))

    async with fetch_apk("https://example.com/app.apk") as path:
        assert path.read_bytes() == APK_BYTES


@pytest.mark.asyncio
async def test_url_source_cleans_up_on_normal_exit(mock_httpx) -> None:
    mock_httpx(lambda _req: httpx.Response(200, content=APK_BYTES))

    async with fetch_apk("https://example.com/app.apk") as path:
        captured = path
        assert captured.exists()

    assert not captured.exists()


@pytest.mark.asyncio
async def test_url_source_cleans_up_when_body_raises(
    mock_httpx,
) -> None:
    mock_httpx(lambda _req: httpx.Response(200, content=APK_BYTES))

    captured: Path | None = None
    with pytest.raises(RuntimeError, match="boom"):
        async with fetch_apk("https://example.com/app.apk") as path:
            captured = path
            assert captured.exists()
            raise RuntimeError("boom")

    assert captured is not None
    assert not captured.exists()


@pytest.mark.asyncio
async def test_url_source_http_error_propagates(mock_httpx) -> None:
    mock_httpx(lambda _req: httpx.Response(404, content=b"not found"))

    with pytest.raises(httpx.HTTPStatusError):
        async with fetch_apk("https://example.com/missing.apk"):
            pass


@pytest.mark.asyncio
async def test_url_source_http_error_does_not_leak_tempfile(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mock_httpx,
) -> None:
    """The NamedTemporaryFile context manager removes the file even
    when the HTTP call fails before any bytes are written.
    """
    monkeypatch.setenv("TMPDIR", str(tmp_path))  # POSIX
    monkeypatch.setenv("TEMP", str(tmp_path))  # Windows
    monkeypatch.setenv("TMP", str(tmp_path))

    mock_httpx(lambda _req: httpx.Response(500))

    before = set(tmp_path.iterdir())
    with pytest.raises(httpx.HTTPStatusError):
        async with fetch_apk("https://example.com/app.apk"):
            pass
    after = set(tmp_path.iterdir())

    # No new files left behind in the temp dir.
    assert after == before


@pytest.mark.asyncio
async def test_url_source_network_error_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(
            *args, transport=httpx.MockTransport(handler), **kwargs
        )

    monkeypatch.setattr(utils.httpx, "AsyncClient", factory)

    with pytest.raises(httpx.ConnectError):
        async with fetch_apk("https://example.com/app.apk"):
            pass


@pytest.mark.asyncio
async def test_url_source_temp_path_is_writable_and_separate(
    mock_httpx,
) -> None:
    """Two concurrent-ish calls get distinct temp paths."""
    mock_httpx(lambda _req: httpx.Response(200, content=APK_BYTES))

    async with fetch_apk("https://example.com/a.apk") as p1:
        async with fetch_apk("https://example.com/b.apk") as p2:
            assert p1 != p2
            assert p1.read_bytes() == APK_BYTES
            assert p2.read_bytes() == APK_BYTES
        assert not p2.exists()
        assert p1.exists()
    assert not p1.exists()


# ---------------------------------------------------------------------------
# write_file_atomically
# ---------------------------------------------------------------------------


def test_write_file_atomically_creates_parents_and_writes(
    tmp_path: Path,
) -> None:
    target = tmp_path / "a" / "b" / "out.json"
    utils.write_file_atomically(target, '{"k": 1}')

    assert target.read_text(encoding="utf-8") == '{"k": 1}'
    # No leftover temp siblings.
    siblings = [p.name for p in target.parent.iterdir()]
    assert siblings == ["out.json"]


def test_write_file_atomically_overwrites_existing(
    tmp_path: Path,
) -> None:
    target = tmp_path / "out.txt"
    target.write_text("old", encoding="utf-8")

    utils.write_file_atomically(target, "new")

    assert target.read_text(encoding="utf-8") == "new"


def test_write_file_atomically_preserves_old_and_cleans_up_on_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "out.txt"
    target.write_text("old", encoding="utf-8")

    def boom(*args: Any, **kwargs: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(utils.os, "replace", boom)

    with pytest.raises(OSError, match="disk full"):
        utils.write_file_atomically(target, "new")

    # Target unchanged; no temp file leaked in the directory.
    assert target.read_text(encoding="utf-8") == "old"
    siblings = sorted(p.name for p in target.parent.iterdir())
    assert siblings == ["out.txt"]


def test_write_file_atomically_concurrent_threads_no_torn_file(
    tmp_path: Path,
) -> None:
    """Many threads writing distinct JSON to the same path.

    The final file must parse as JSON and equal exactly one of the
    inputs — never a torn mix. Also exercises that per-call temp paths
    don't collide between threads.
    """
    import json
    import threading

    target = tmp_path / "shared.json"
    n = 32
    payloads = [{"writer": i, "blob": "x" * 4096} for i in range(n)]
    barrier = threading.Barrier(n)
    errors: list[BaseException] = []

    def write(payload: dict[str, Any]) -> None:
        try:
            barrier.wait()
            utils.write_file_atomically(
                target, json.dumps(payload),
            )
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [
        threading.Thread(target=write, args=(p,)) for p in payloads
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"writer raised: {errors!r}"
    final = json.loads(target.read_text(encoding="utf-8"))
    assert final in payloads
    # No leftover temp files.
    leftover = [
        p.name for p in target.parent.iterdir() if p.name != "shared.json"
    ]
    assert leftover == []
