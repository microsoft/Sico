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

"""Android device controller.

Layout
------
ADBRunner          - low-level ``adb`` subprocess wrapper
AndroidController  - high-level controller built on top of ``ADBRunner``
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from android_tester.image_store import Image

logger = logging.getLogger(__name__)


# -- constants ------------------------------------------------

_ADB_SHELL_META = frozenset(
    r"""\"'$`!#&|;()<>{}[]*?~^"""
)

_PACKAGE_NAME_PATTERN = re.compile(
    r"^[a-zA-Z][a-zA-Z0-9_]*"
    r"(\.[a-zA-Z][a-zA-Z0-9_]*)+$"
)
_RECENT_BLOCK_PATTERN = re.compile(
    r"(?=\* Recent #)",
)
_ACTIVITY_COMPONENT_PATTERN = re.compile(
    r"mActivityComponent=(\S+)/",
)
_ACTIVITY_TYPE_PATTERN = re.compile(
    r"activityType=(\d+)",
)
_ACTIVITIES_LIST_PATTERN = re.compile(
    r"Activities=\[([^\]]*)\]",
)

_RUNTIME_PERMISSIONS_TO_REVOKE: tuple[str, ...] = (
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
)

_EXTRA_RESET_PACKAGES: tuple[str, ...] = (
    "com.android.printspooler",
)


# -- exceptions ----------------------------------------------


class ADBError(Exception):
    """Base error for ADB operations."""


class DeviceConnectionError(ADBError):
    """Raised when a device cannot be reached."""


class ADBCommandError(ADBError):
    """Raised when an ADB shell command fails."""

    def __init__(
        self,
        command: str,
        stderr: str,
        stdout: str = "",
        returncode: int | None = None,
    ) -> None:
        self.command = command
        self.stderr = stderr
        self.stdout = stdout
        self.returncode = returncode
        parts = [f"ADB command failed: {command}"]
        if returncode is not None:
            parts.append(f"exit={returncode}")
        if stderr:
            parts.append(f"stderr={stderr}")
        if stdout:
            parts.append(f"stdout={stdout}")
        super().__init__(" | ".join(parts))


class UnknownAppError(ADBError):
    """Raised when an app name cannot be resolved."""


# -- data -----------------------------------------------------


@dataclass(slots=True)
class ADBResult:
    returncode: int | None
    stdout: str
    stderr: str
    stdout_bytes: bytes = b""


# -- ADB runner -----------------------------------------------


def _resolve_adb_binary(adb_binary: str | None) -> str:
    """Resolve *adb_binary* to an absolute path via ``shutil.which``.

    If *adb_binary* is ``None``, ``"adb"`` is searched on ``PATH``.
    If *adb_binary* is already an absolute path, it is returned as-is
    without further validation (so callers can supply a non-standard
    binary). Raises :class:`DeviceConnectionError` if ``adb`` cannot
    be located on ``PATH``.
    """
    name = adb_binary or "adb"
    if Path(name).is_absolute():
        return name
    resolved = shutil.which(name)
    if resolved is None:
        raise DeviceConnectionError(
            f"Could not find {name!r} on PATH. Install Android"
            " platform-tools or pass an explicit adb_binary path."
        )
    return resolved


class ADBRunner:
    """Thin async wrapper around the ``adb`` binary."""

    def __init__(
        self,
        device_id: str,
        adb_binary: str | None = None,
        command_timeout: float | None = None,
    ) -> None:
        self.device_id = device_id
        self.adb_binary = _resolve_adb_binary(adb_binary)
        self.command_timeout = command_timeout

    async def ensure_connected(self) -> None:
        if await self.is_connected():
            return
        await self.run_raw(
            [self.adb_binary, "connect", self.device_id],
            check=False,
        )
        if not await self.is_connected():
            raise DeviceConnectionError(
                f"Device {self.device_id!r} is not reachable"
            )

    async def is_connected(self) -> bool:
        proc = await self.run(
            ["shell", "echo", "ready"], check=False,
        )
        return (
            proc.returncode == 0 and "ready" in proc.stdout
        )

    async def shell(self, command: str) -> ADBResult:
        return await self.run(["shell", command])

    async def run(
        self,
        adb_args: list[str],
        output_path: Path | None = None,
        check: bool = True,
    ) -> ADBResult:
        base = [
            self.adb_binary, "-s", self.device_id, *adb_args,
        ]
        return await self.run_raw(
            base, output_path=output_path, check=check,
        )

    async def run_raw(
        self,
        args: list[str],
        output_path: Path | None = None,
        check: bool = True,
    ) -> ADBResult:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self.command_timeout,
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            raise ADBCommandError(
                " ".join(args),
                f"timed out after {self.command_timeout}s",
            )
        if output_path is not None:
            output_path.parent.mkdir(
                parents=True, exist_ok=True,
            )
            output_path.write_bytes(stdout)
        text_out = stdout.decode("utf-8", errors="replace")
        text_err = stderr.decode("utf-8", errors="replace")
        if check and process.returncode != 0:
            raise ADBCommandError(
                " ".join(args),
                text_err.strip(),
                stdout=text_out.strip(),
                returncode=process.returncode,
            )
        return ADBResult(
            returncode=process.returncode,
            stdout=text_out,
            stderr=text_err,
            stdout_bytes=stdout,
        )


# -- helpers --------------------------------------------------


def _escape_for_adb_input(text: str) -> str:
    """Escape *text* for ``adb shell input text``."""
    parts: list[str] = []
    for ch in text:
        if ch == " ":
            parts.append("%s")
        elif ch == "%":
            parts.append("%%")
        elif ch == "\\":
            parts.append("\\\\")
        elif ch in _ADB_SHELL_META:
            parts.append(f"\\{ch}")
        else:
            parts.append(ch)
    return "".join(parts)


# -- controller ------------------------------------------------


class AndroidController:
    """High-level Android device controller."""

    def __init__(
        self,
        runner: ADBRunner,
        app_map_path: Path,
    ) -> None:
        self._runner = runner
        self._app_map: dict[str, str] = json.loads(
            app_map_path.read_text(encoding="utf-8")
        )

    @classmethod
    def create(
        cls,
        device_id: str,
        app_map_path: Path,
        *,
        command_timeout: float | None = None,
        adb_binary: str | None = None,
    ) -> AndroidController:
        """Build an :class:`AndroidController` and its underlying
        :class:`ADBRunner` in one call.

        This is the preferred entry point for callers that don't need to
        share or customize the runner. Pass ``command_timeout=None`` to
        let ``adb`` calls run without a timeout. ``adb_binary`` defaults
        to whatever ``shutil.which("adb")`` resolves to.
        """
        runner = ADBRunner(
            device_id=device_id,
            adb_binary=adb_binary,
            command_timeout=command_timeout,
        )
        return cls(runner=runner, app_map_path=app_map_path)

    @property
    def device_id(self) -> str:
        return self._runner.device_id

    # -- connection / lifecycle --

    async def ensure_connected(self) -> None:
        await self._runner.ensure_connected()

    async def reset(self) -> None:
        """Bring the device to a clean baseline before a task."""
        await self._keyevent("KEYCODE_WAKEUP")
        await self._runner.shell("wm dismiss-keyguard")
        await self._keyevent("KEYCODE_HOME")

        await self.clear_running_apps()
        for pkg in _EXTRA_RESET_PACKAGES:
            await self._clear_app_data(pkg)

        await self._clean_shared_downloads()
        await self._clear_notifications()
        await self._keyevent("KEYCODE_HOME")

    # -- input actions --

    async def click(self, point: tuple[int, int]) -> None:
        x, y = map(int, point)
        await self._runner.shell(f"input tap {x} {y}")

    async def long_press(
        self,
        point: tuple[int, int],
        duration_ms: int = 800,
    ) -> None:
        x, y = map(int, point)
        await self._runner.shell(
            f"input swipe {x} {y} {x} {y} {duration_ms}"
        )

    async def drag(
        self,
        start: tuple[int, int],
        end: tuple[int, int],
        duration_ms: int = 400,
    ) -> None:
        x1, y1 = map(int, start)
        x2, y2 = map(int, end)
        await self._runner.shell(
            f"input swipe {x1} {y1} {x2} {y2} {duration_ms}"
        )

    async def scroll(
        self,
        start: tuple[int, int],
        end: tuple[int, int],
        duration_ms: int = 350,
    ) -> None:
        await self.drag(start, end, duration_ms=duration_ms)

    async def type_text(self, content: str) -> None:
        escaped = _escape_for_adb_input(content)
        await self._runner.shell(f"input text {escaped}")

    async def screenshot(self) -> Image:
        """Capture the current screen as a PNG :class:`Image`."""
        result = await self._runner.run(
            ["exec-out", "screencap", "-p"],
        )
        return Image.from_png_bytes(result.stdout_bytes)

    async def press_back(self) -> None:
        await self._keyevent("KEYCODE_BACK")

    async def press_home(self) -> None:
        await self._keyevent("KEYCODE_HOME")

    async def press_enter(self) -> None:
        await self._keyevent("KEYCODE_ENTER")

    async def press_recent_apps(self) -> None:
        await self._keyevent("KEYCODE_APP_SWITCH")

    async def wait(self, seconds: float = 1.0) -> None:
        await asyncio.sleep(seconds)

    async def _keyevent(self, key: str) -> None:
        await self._runner.shell(f"input keyevent {key}")

    # -- app management --

    async def launch(self, app_name: str) -> None:
        package = self._resolve_package(app_name)
        if not _PACKAGE_NAME_PATTERN.match(package):
            raise ValueError(
                f"Invalid Android package name: {package!r}"
            )
        try:
            await self._runner.run(
                [
                    "shell", "monkey",
                    "-p", package,
                    "-c", "android.intent.category.LAUNCHER",
                    "1",
                ],
            )
        except ADBCommandError as exc:
            combined = f"{exc.stdout}\n{exc.stderr}"
            if "No activities found to run" in combined:
                raise UnknownAppError(
                    f"No launchable activity for package {package!r}"
                )
            else:
                raise

    async def list_installed_packages(
        self,
        *,
        third_party_only: bool = False,
    ) -> frozenset[str]:
        """Return the set of installed package names on the device.

        With ``third_party_only=True`` only user-installed apps are
        returned (``pm list packages -3``); otherwise all packages
        including system apps are returned.
        """
        args = ["shell", "pm", "list", "packages"]
        if third_party_only:
            args.append("-3")
        proc = await self._runner.run(args, check=False)
        if proc.returncode != 0:
            logger.warning(
                "Failed to list installed packages: %s",
                proc.stderr.strip(),
            )
            return frozenset()
        packages: set[str] = set()
        for line in proc.stdout.splitlines():
            line = line.strip()
            if line.startswith("package:"):
                pkg = line[len("package:"):].strip()
                if pkg:
                    packages.add(pkg)
        return frozenset(packages)

    async def get_running_apps(self) -> frozenset[str]:
        """
        Return the package names of standard (activityType=1) apps in the
        recents stack.
        """
        proc = await self._runner.run(
            ["shell", "dumpsys", "activity", "recents"],
            check=False,
        )
        if proc.returncode != 0:
            logger.warning(
                "Failed to dump activity recents: %s",
                proc.stderr.strip(),
            )
            return frozenset()
        return frozenset(
            self._parse_clearable_packages(proc.stdout),
        )

    async def force_stop(self, package: str) -> None:
        """Force-stop *package* (``am force-stop``)."""
        await self._runner.run(
            ["shell", "am", "force-stop", package],
            check=False,
        )

    async def clear_running_apps(self) -> None:
        """
        Force-stop, clear, and revoke runtime permissions for every running
        standard (activityType=1) app.
        """
        for pkg in await self.get_running_apps():
            await self.force_stop(pkg)
            await self._clear_app_data(pkg)
            await self._revoke_runtime_permissions(pkg)

    # -- private helpers --

    async def _clear_app_data(self, package: str) -> None:
        proc = await self._runner.run(
            ["shell", "pm", "clear", package],
            check=False,
        )
        output = (proc.stderr or "") + (proc.stdout or "")
        if proc.returncode != 0:
            if "SecurityException" in output:
                logger.warning(
                    "Cannot clear %s - permission"
                    " restrictions. Enable 'Disable"
                    " Permission Monitoring' in"
                    " Developer Options.",
                    package,
                )
            else:
                logger.warning(
                    "Failed to clear app data for %s: %s",
                    package,
                    output.strip(),
                )

    async def _revoke_runtime_permissions(
        self, package: str,
    ) -> None:
        """Revoke commonly granted runtime permissions for *package*."""
        for perm in _RUNTIME_PERMISSIONS_TO_REVOKE:
            await self._runner.run(
                ["shell", "pm", "revoke", package, perm],
                check=False,
            )

    async def _clean_shared_downloads(self) -> None:
        """Remove every file in /sdcard/Download/."""
        await self._runner.run(
            [
                "shell",
                "rm -rf /sdcard/Download/* /sdcard/Download/.[!.]*",
            ],
            check=False,
        )

    async def _clear_notifications(self) -> None:
        """Dismiss every visible notification."""
        await self._runner.run(
            ["shell", "service", "call", "notification", "1"],
            check=False,
        )

    @staticmethod
    def _parse_clearable_packages(dump: str) -> set[str]:
        packages: set[str] = set()
        blocks = _RECENT_BLOCK_PATTERN.split(dump)
        for block in blocks:
            if not block.strip().startswith("* Recent #"):
                continue
            pkg_m = _ACTIVITY_COMPONENT_PATTERN.search(block)
            type_m = _ACTIVITY_TYPE_PATTERN.search(block)
            act_m = _ACTIVITIES_LIST_PATTERN.search(block)
            if not pkg_m or not type_m:
                continue
            pkg = pkg_m.group(1)
            activity_type = int(type_m.group(1))
            has_activities = bool(
                act_m and act_m.group(1).strip()
            )
            if activity_type == 1 and has_activities:
                packages.add(pkg)
        return packages

    def _resolve_package(self, app_name: str) -> str:
        key = app_name.strip().lower()
        package = self._app_map.get(key)
        if package:
            return package
        if _PACKAGE_NAME_PATTERN.match(key):
            return key
        for map_key, map_pkg in self._app_map.items():
            if map_key in key or key in map_key:
                return map_pkg
        raise UnknownAppError(
            f"Unknown app name: {app_name}"
        )

    def try_resolve_package(self, app_name: str) -> str | None:
        """Like :meth:`_resolve_package` but returns ``None`` instead
        of raising when the name cannot be resolved."""
        try:
            return self._resolve_package(app_name)
        except UnknownAppError:
            return None
