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

"""Integration tests for :class:`AndroidController.launch`.

These require a real Android device or emulator. The device is selected
via the ``ANDROID_TESTER_DEVICE_ID`` env var (e.g.
``127.0.0.1:16416``); tests are skipped when it is unset.

Run with:

    ANDROID_TESTER_DEVICE_ID=127.0.0.1:16416 \\
        uv run pytest -m integration tests/integration

The test launches ``com.android.settings``, which ships on every
Android image, so no extra installation is required.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from android_tester.android_controller import (
    ADBCommandError,
    AndroidController,
    UnknownAppError,
)

DEVICE_ID = os.environ.get("ANDROID_TESTER_DEVICE_ID")
APP_MAP_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "app_packages.json"
)

# Pre-installed on every Android build.
KNOWN_PACKAGE = "com.android.settings"
# Package name that is syntactically valid but not installed.
UNKNOWN_PACKAGE = "org.example.definitely.not.installed"
# Any device with a browser (or WebView VIEW handler) resolves this.
KNOWN_URL = "https://example.com"
# Unknown custom scheme — no activity should claim it.
UNHANDLED_URL = "sico-nonexistent-scheme://no-handler"


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        DEVICE_ID is None,
        reason=(
            "ANDROID_TESTER_DEVICE_ID env var not set; "
            "skipping device-backed integration tests."
        ),
    ),
]


@pytest.fixture
async def controller() -> AndroidController:
    assert DEVICE_ID is not None  # narrowed by skipif
    ctrl = AndroidController.create(
        device_id=DEVICE_ID,
        app_map_path=APP_MAP_PATH,
    )
    await ctrl.ensure_connected()
    return ctrl


async def test_launch_known_package(
    controller: AndroidController,
) -> None:
    """Launching a package that ships on every device succeeds."""
    await controller.launch(KNOWN_PACKAGE)


async def test_launch_unknown_package_raises(
    controller: AndroidController,
) -> None:
    """A syntactically valid but uninstalled package raises."""
    with pytest.raises(UnknownAppError):
        await controller.launch(UNKNOWN_PACKAGE)


async def test_open_link_known_url(
    controller: AndroidController,
) -> None:
    """Opening a standard https URL succeeds on any device with a
    browser/WebView VIEW handler."""
    await controller.open_link(KNOWN_URL)


async def test_open_link_unhandled_scheme_raises(
    controller: AndroidController,
) -> None:
    """A URL with no registered VIEW handler raises."""
    with pytest.raises(ADBCommandError):
        await controller.open_link(UNHANDLED_URL)
