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

import time

from app.routers import emulators


class FakeMuMu:
    def __init__(self, *, fail_root_date: bool = False) -> None:
        self.calls: list[list[str]] = []
        self.fail_root_date = fail_root_date

    def _run_adb(self, args: list[str]) -> tuple[int, str, str]:
        self.calls.append(args)
        if args[-5:] == ["settings", "put", "global", "private_dns_mode", "off"]:
            return 1, "", "private dns unsupported"
        if self.fail_root_date and args[-4:] == ["su", "0", "date", "062004162026.00"]:
            return 1, "", "su unavailable"
        return 0, "", ""


def test_android_date_arg_uses_android_format(monkeypatch) -> None:
    fixed_time = time.struct_time((2026, 6, 20, 4, 16, 0, 5, 171, -1))
    monkeypatch.setattr(emulators.time, "localtime", lambda timestamp: fixed_time)

    assert emulators._android_date_arg(123) == "062004162026.00"


def test_run_android_reset_preflight_is_best_effort(monkeypatch) -> None:
    mumu = FakeMuMu()
    monkeypatch.setattr(emulators, "_android_date_arg", lambda: "062004162026.00")

    result = emulators._run_android_reset_preflight(mumu, "127.0.0.1:5555")

    assert ["-s", "127.0.0.1:5555", "shell", "settings", "put", "global", "captive_portal_mode", "0"] in mumu.calls
    assert ["-s", "127.0.0.1:5555", "shell", "svc", "wifi", "disable"] in mumu.calls
    assert ["-s", "127.0.0.1:5555", "shell", "svc", "wifi", "enable"] in mumu.calls
    assert ["-s", "127.0.0.1:5555", "shell", "su", "0", "date", "062004162026.00"] in mumu.calls
    assert ["-s", "127.0.0.1:5555", "shell", "settings", "put", "global", "auto_time", "0"] in mumu.calls
    assert "settings put global private_dns_mode off: private dns unsupported" in result["errors"]
    assert "settings put global captive_portal_mode 0" in result["applied"]


def test_run_android_reset_preflight_keeps_auto_time_when_root_date_fails(monkeypatch) -> None:
    mumu = FakeMuMu(fail_root_date=True)
    monkeypatch.setattr(emulators, "_android_date_arg", lambda: "062004162026.00")

    result = emulators._run_android_reset_preflight(mumu, "127.0.0.1:5555")

    assert ["-s", "127.0.0.1:5555", "shell", "su", "0", "date", "062004162026.00"] in mumu.calls
    assert ["-s", "127.0.0.1:5555", "shell", "settings", "put", "global", "auto_time", "0"] not in mumu.calls
    assert "su 0 date 062004162026.00: su unavailable" in result["errors"]
