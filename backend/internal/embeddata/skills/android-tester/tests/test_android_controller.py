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

from pathlib import Path

import pytest

from android_tester.android_controller import (
    ADBCommandError,
    ADBResult,
    ADBRunner,
    AndroidController,
)


class FakeRunner(ADBRunner):
    def __init__(
        self,
        *,
        device_id: str,
        run_raw_outcomes: list[Exception | ADBResult],
    ) -> None:
        super().__init__(device_id=device_id, adb_binary=r"C:\\fake\\adb.exe")
        self._run_raw_outcomes = run_raw_outcomes
        self.calls: list[list[str]] = []
        self.ensure_connected_calls = 0

    async def run_raw(
        self,
        args: list[str],
        output_path: object = None,
        check: bool = True,
    ) -> ADBResult:
        self.calls.append(args)
        outcome = self._run_raw_outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async def ensure_connected(self, connect_wait: float = 6.0) -> None:
        self.ensure_connected_calls += 1


async def test_run_recovers_from_quoted_device_not_found() -> None:
    runner = FakeRunner(
        device_id="127.0.0.1:16416",
        run_raw_outcomes=[
            ADBCommandError(
                "adb -s 127.0.0.1:16416 shell input keyevent KEYCODE_HOME",
                "adb.EXE: device '127.0.0.1:16416' not found",
                returncode=1,
            ),
            ADBResult(returncode=0, stdout="ok", stderr=""),
        ],
    )

    result = await runner.run(["shell", "input keyevent KEYCODE_HOME"])

    assert result.stdout == "ok"
    assert runner.ensure_connected_calls == 1
    assert len(runner.calls) == 2


async def test_run_does_not_recover_for_non_connection_error() -> None:
    runner = FakeRunner(
        device_id="emulator-5554",
        run_raw_outcomes=[
            ADBCommandError(
                "adb -s emulator-5554 shell pm clear com.example.app",
                "java.lang.SecurityException: Permission denial",
                returncode=1,
            ),
        ],
    )

    with pytest.raises(ADBCommandError):
        await runner.run(["shell", "pm clear com.example.app"])

    assert runner.ensure_connected_calls == 0
    assert len(runner.calls) == 1


# ---------------------------------------------------------------------------
# File tools
# ---------------------------------------------------------------------------


def _build_controller(
    runner: ADBRunner,
    tmp_path: Path,
    resources_path: Path | None = None,
) -> AndroidController:
    app_map = tmp_path / "app_packages.json"
    app_map.write_text("{}", encoding="utf-8")
    return AndroidController(
        runner=runner,
        app_map_path=app_map,
        resources_path=resources_path,
    )


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("", "/sdcard"),
        ("Pictures", "/sdcard/Pictures"),
        ("/sdcard/Download", "/sdcard/Download"),
        ("/sdcard", "/sdcard"),
        ("Pictures/cat.jpg", "/sdcard/Pictures/cat.jpg"),
        ("Pictures/../Download", "/sdcard/Download"),
        ("Pictures/./cat.jpg", "/sdcard/Pictures/cat.jpg"),
    ],
)
def test_resolve_sdcard_path(raw: str, expected: str) -> None:
    assert AndroidController._resolve_sdcard_path(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["..", "../etc", "Pictures/../../data", "/sdcard/../data"],
)
def test_resolve_sdcard_path_rejects_escape(raw: str) -> None:
    with pytest.raises(ValueError):
        AndroidController._resolve_sdcard_path(raw)


def test_resolve_resource_returns_file(tmp_path: Path) -> None:
    res = tmp_path / "res"
    res.mkdir()
    (res / "cat.jpg").write_bytes(b"x")
    controller = _build_controller(
        FakeRunner(device_id="d", run_raw_outcomes=[]),
        tmp_path,
        resources_path=res,
    )
    resolved = controller._resolve_resource("cat.jpg")
    assert resolved == (res / "cat.jpg").resolve()


def test_resolve_resource_rejects_traversal(tmp_path: Path) -> None:
    res = tmp_path / "res"
    res.mkdir()
    (tmp_path / "secret.txt").write_bytes(b"x")
    controller = _build_controller(
        FakeRunner(device_id="d", run_raw_outcomes=[]),
        tmp_path,
        resources_path=res,
    )
    with pytest.raises(ValueError):
        controller._resolve_resource("../secret.txt")


def test_resolve_resource_without_config(tmp_path: Path) -> None:
    controller = _build_controller(
        FakeRunner(device_id="d", run_raw_outcomes=[]), tmp_path,
    )
    with pytest.raises(ValueError):
        controller._resolve_resource("cat.jpg")


def test_list_resources(tmp_path: Path) -> None:
    res = tmp_path / "res"
    (res / "sub").mkdir(parents=True)
    (res / "a.txt").write_bytes(b"x")
    (res / "sub" / "b.png").write_bytes(b"x")
    controller = _build_controller(
        FakeRunner(device_id="d", run_raw_outcomes=[]),
        tmp_path,
        resources_path=res,
    )
    assert controller.list_resources() == "a.txt\nsub/b.png"


def test_list_resources_unset(tmp_path: Path) -> None:
    controller = _build_controller(
        FakeRunner(device_id="d", run_raw_outcomes=[]), tmp_path,
    )
    assert "unset" in controller.list_resources()


async def test_put_file_pushes_and_scans(tmp_path: Path) -> None:
    res = tmp_path / "res"
    res.mkdir()
    (res / "cat.jpg").write_bytes(b"x")
    runner = FakeRunner(
        device_id="d",
        run_raw_outcomes=[
            ADBResult(returncode=0, stdout="", stderr=""),  # mkdir
            ADBResult(returncode=0, stdout="", stderr=""),  # push
            ADBResult(returncode=0, stdout="", stderr=""),  # broadcast
        ],
    )
    controller = _build_controller(runner, tmp_path, resources_path=res)

    await controller.put_file("cat.jpg", "Pictures")

    assert runner.calls[0][-1] == "mkdir -p '/sdcard/Pictures'"
    assert runner.calls[1][-2:] == [
        str((res / "cat.jpg").resolve()),
        "/sdcard/Pictures/cat.jpg",
    ]
    assert any("MEDIA_SCANNER_SCAN_FILE" in c for c in runner.calls[2])


async def test_delete_file_removes_and_scans(tmp_path: Path) -> None:
    runner = FakeRunner(
        device_id="d",
        run_raw_outcomes=[
            ADBResult(returncode=0, stdout="", stderr=""),  # rm
            ADBResult(returncode=0, stdout="", stderr=""),  # broadcast
        ],
    )
    controller = _build_controller(runner, tmp_path)

    await controller.delete_file("Pictures/cat.jpg")

    assert runner.calls[0][-1] == "rm -f '/sdcard/Pictures/cat.jpg'"
    assert any("MEDIA_SCANNER_SCAN_FILE" in c for c in runner.calls[1])


async def test_list_device_files(tmp_path: Path) -> None:
    runner = FakeRunner(
        device_id="d",
        run_raw_outcomes=[
            ADBResult(returncode=0, stdout="cat.jpg\ndog.png\n", stderr=""),
        ],
    )
    controller = _build_controller(runner, tmp_path)

    out = await controller.list_device_files("Pictures")

    assert out == "cat.jpg\ndog.png"
    assert runner.calls[0][-1] == "ls -1ap '/sdcard/Pictures'"
