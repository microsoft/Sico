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
from android_tester.retry import call_with_retry_async
from android_tester.telemetry import measure_time
from android_tester.utils import fetch_apk

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
_AM_START_FAILURE_MARKERS = (
    "unable to resolve intent",
    "no activities found to run",
    "activity not started, unable to find",
    "error type",
    "error:",
)

_CONNECTION_FAILURE_MARKERS = (
    "device offline",
    "device not found",
    "no devices/emulators found",
    "device unauthorized",
    "error: closed",
    "timed out after",
)

_CONNECTION_FAILURE_REGEXES = (
    re.compile(r"device(?:\s+'[^']+')?\s+not found"),
)


def _is_connection_failure(exc: "ADBCommandError") -> bool:
    message = f"{exc.stderr}\n{exc.stdout}".lower()
    return (
        any(m in message for m in _CONNECTION_FAILURE_MARKERS)
        or any(rx.search(message) for rx in _CONNECTION_FAILURE_REGEXES)
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

_EXTRA_RESET_PACKAGES: frozenset[str] = frozenset({
    "com.android.printspooler",
})

_SWIPE_DURATIONS_MS: dict[str, int] = {
    "normal": 400,
    "high": 50,  # 63 is the minimum for closing apps on the recent apps screen
}

_SDCARD_ROOT = "/sdcard"

# On-device location for external-storage snapshots.
_DEFAULT_BACKUP_DIR = "/data/local/tmp/.android-tester/backup"

# External-storage trees snapshotted and restored around each run.
_SNAPSHOT_ROOTS: tuple[str, ...] = ("/storage/emulated/0",)


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

    async def ensure_connected(self, connect_wait: float = 6.0) -> None:
        """Ensure the device is reachable, with bounded retries.

        Emulators routinely drop into ``offline`` between commands.
        Recovery escalates through a few cheap-to-aggressive steps:

        1. ``adb -s <id> reconnect`` -- kicks just this transport, often
           the only thing that recovers a sticky ``offline`` state.
        2. ``adb disconnect`` + ``adb connect`` -- forces a fresh
           handshake when ``reconnect`` is not enough.

        After each step we poll the device state for a few seconds
        (``adb connect`` returns immediately but the transport may
        linger in ``offline`` briefly before flipping to ``device``).
        *connect_wait* bounds that final post-connect poll. The whole
        sequence is retried with exponential backoff before surfacing
        :class:`DeviceConnectionError`.
        """
        await call_with_retry_async(
            lambda: self._ensure_connected_once(connect_wait),
            on=DeviceConnectionError,
            max_retries=4,
            base_delay=2.0,
            label=f"ensure_connected({self.device_id})",
        )

    async def _ensure_connected_once(self, connect_wait: float) -> None:
        if await self.is_connected():
            logger.debug(
                "ensure_connected(%s): already online",
                self.device_id,
            )
            return

        state = await self._get_device_state()
        logger.debug(
            "ensure_connected(%s): not online, current state=%r",
            self.device_id, state,
        )

        # 1. Ask adb to re-handshake just this transport.
        if state in {"offline", "unauthorized"}:
            logger.debug(
                "ensure_connected(%s): trying `adb reconnect`",
                self.device_id,
            )
            await self.run_raw(
                [
                    self.adb_binary, "-s", self.device_id,
                    "reconnect",
                ],
                check=False,
            )
            if await self._wait_until_online(timeout=4.0):
                logger.debug(
                    "ensure_connected(%s): recovered via `adb reconnect`",
                    self.device_id,
                )
                return
            logger.debug(
                "ensure_connected(%s): `adb reconnect` did not "
                "restore the device within 4s",
                self.device_id,
            )

        # 2. Fall back to a full disconnect + connect cycle.
        logger.debug(
            "ensure_connected(%s): trying `adb disconnect` + "
            "`adb connect` (wait=%.1fs)",
            self.device_id, connect_wait,
        )
        await self.run_raw(
            [self.adb_binary, "disconnect", self.device_id],
            check=False,
        )
        await self.run_raw(
            [self.adb_binary, "connect", self.device_id],
            check=False,
        )
        if await self._wait_until_online(timeout=connect_wait):
            logger.debug(
                "ensure_connected(%s): recovered via "
                "disconnect+connect",
                self.device_id,
            )
            return

        final_state = await self._get_device_state()
        logger.debug(
            "ensure_connected(%s): all recovery steps exhausted; "
            "final state=%r",
            self.device_id, final_state,
        )
        raise DeviceConnectionError(
            f"Device {self.device_id!r} is not reachable"
        )

    async def _wait_until_online(
        self, timeout: float, poll_interval: float = 0.5,
    ) -> bool:
        """Poll ``adb devices`` until this device shows ``device``.

        Cheap: only talks to the local adb server, no per-poll shell
        roundtrip, so we can poll frequently within *timeout*.
        """
        loop = asyncio.get_running_loop()
        start = loop.time()
        deadline = start + timeout
        polls = 0
        while True:
            polls += 1
            state = await self._get_device_state()
            if state == "device":
                logger.debug(
                    "_wait_until_online(%s): online after %d "
                    "poll(s) in %.2fs",
                    self.device_id, polls, loop.time() - start,
                )
                return True
            if loop.time() >= deadline:
                logger.debug(
                    "_wait_until_online(%s): timed out after %.2fs "
                    "(last state=%r, %d poll(s))",
                    self.device_id, loop.time() - start, state, polls,
                )
                return False
            await asyncio.sleep(poll_interval)

    async def is_connected(self) -> bool:
        return await self._get_device_state() == "device"

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

    async def _get_device_state(self) -> str | None:
        """Return the device's state as reported by ``adb devices -l``.

        Possible values include ``"device"``, ``"offline"``,
        ``"unauthorized"``. Returns ``None`` when the device is not
        listed at all (e.g. never connected).
        """
        proc = await self.run_raw(
            [self.adb_binary, "devices", "-l"],
            check=False,
        )
        for raw_line in proc.stdout.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("List of devices"):
                continue
            parts = line.split()
            if parts and parts[0] == self.device_id:
                return parts[1] if len(parts) > 1 else None
        return None

    async def run(
        self,
        adb_args: list[str],
        output_path: Path | None = None,
        check: bool = True,
    ) -> ADBResult:
        """Run a device-targeted ``adb`` command.

        Transparently recovers from a single connection failure
        (offline / unauthorized / timeout) by re-running
        :meth:`ensure_connected` and retrying the command once.
        """
        base = [
            self.adb_binary, "-s", self.device_id, *adb_args,
        ]
        try:
            return await self.run_raw(
                base, output_path=output_path, check=check,
            )
        except ADBCommandError as exc:
            if not _is_connection_failure(exc):
                raise
            logger.warning(
                "ADB connection failure on %s; recovering: %s",
                self.device_id, exc,
            )
            await self.ensure_connected()
            logger.debug(
                "ADB recovery on %s succeeded; retrying command: %s",
                self.device_id, " ".join(adb_args),
            )
            return await self.run_raw(
                base, output_path=output_path, check=check,
            )

    async def shell(self, command: str) -> ADBResult:
        return await self.run(["shell", command])


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


def _quote_for_shell_single(text: str) -> str:
    """Return *text* as a single-quoted shell literal."""
    return "'" + text.replace("'", "'\"'\"'") + "'"


async def _broadcast_media_scan(
    runner: ADBRunner, remote_path: str,
) -> None:
    """Ask MediaStore to (re)index *remote_path*."""
    await runner.run(
        [
            "shell", "am", "broadcast",
            "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d", f"file://{remote_path}",
        ],
        check=False,
    )


class _FileBaseline:
    """Snapshots external storage at startup and restores it on cleanup.

    :meth:`snapshot` gzips a tar of each configured root before the run.
    :meth:`restore` then deletes the live contents of each root and
    re-extracts its snapshot.
    """

    def __init__(
        self,
        runner: ADBRunner,
        backup_dir: str,
        roots: tuple[str, ...] = _SNAPSHOT_ROOTS,
    ) -> None:
        self._runner = runner
        self._dir = backup_dir.rstrip("/")
        self._roots = roots
        self._snapshots: dict[str, str] = {}

    async def snapshot(self) -> None:
        """Archive each root so :meth:`restore` can recreate it."""
        await self._runner.ensure_connected()
        await self._runner.run(
            ["shell", f"mkdir -p {_quote_for_shell_single(self._dir)}"],
            check=False,
        )
        for root in self._roots:
            await self._snapshot_root(root)

    async def _snapshot_root(self, root: str) -> None:
        tarball = self._build_tarball_path(root)
        result = await self._runner.run(
            [
                "shell",
                f"tar -czf {_quote_for_shell_single(tarball)} "
                f"-C {_quote_for_shell_single(root)} .",
            ],
            check=False,
        )
        if result.returncode == 0:
            self._snapshots[root] = tarball
        else:
            logger.warning(
                "snapshot of %s failed: %s", root, result.stderr.strip(),
            )

    @staticmethod
    def _build_archive_name(root: str) -> str:
        return root.strip("/").replace("/", "_") or "root"

    def _build_tarball_path(self, root: str) -> str:
        return f"{self._dir}/{self._build_archive_name(root)}.tar.gz"

    async def restore(self) -> None:
        """Sync each snapshotted root to its archive, then rescan media."""
        if not self._snapshots:
            return
        await self._runner.ensure_connected()
        for root, tarball in self._snapshots.items():
            await self._sync_root(root, tarball)
        await self._rescan_media()
        await self._runner.run(
            ["shell", f"rm -rf {_quote_for_shell_single(self._dir)}"],
            check=False,
        )
        self._snapshots.clear()

    async def _sync_root(self, root: str, tarball: str) -> None:
        """Restore *root* to its snapshot without crossing mount points.

        Computes which files were created during the run, deletes just those, 
        then extracts the archive to bring back modified or deleted files.
        """
        archived = await self._read_archived_files(root, tarball)
        live = await self._read_live_files(root)
        await self._delete_files(sorted(live - archived))
        await self._extract_archive(root, tarball)

    async def _read_archived_files(
        self, root: str, tarball: str,
    ) -> set[str]:
        """Return the absolute paths of the files inside *tarball*."""
        result = await self._runner.run(
            ["shell", f"tar -tzf {_quote_for_shell_single(tarball)}"],
            check=False,
        )
        prefix = root.rstrip("/")
        files: set[str] = set()
        for line in result.stdout.splitlines():
            if not line or line.endswith("/"):  # skip blanks + directories
                continue
            relative = line[2:] if line.startswith("./") else line
            files.add(f"{prefix}/{relative}")
        return files

    async def _read_live_files(self, root: str) -> set[str]:
        """Return the absolute paths of the files currently under *root*."""
        result = await self._runner.run(
            ["shell", f"find {_quote_for_shell_single(root)} -type f"],
            check=False,
        )
        return {line for line in result.stdout.splitlines() if line}

    async def _delete_files(
        self, 
        paths: list[str], 
        batch_size: int = 200,
    ) -> None:
        """Delete *paths* in batches small enough for one shell command."""
        for start in range(0, len(paths), batch_size):
            batch = paths[start:start + batch_size]
            quoted = " ".join(_quote_for_shell_single(p) for p in batch)
            await self._runner.run(
                ["shell", f"rm -f {quoted}"], check=False,
            )

    async def _extract_archive(self, root: str, tarball: str) -> None:
        """Extract *tarball* into *root*, restoring its snapshot files."""
        await self._runner.run(
            [
                "shell",
                f"tar -xzf {_quote_for_shell_single(tarball)} "
                f"-C {_quote_for_shell_single(root)}",
            ],
            check=False,
        )

    async def _rescan_media(self) -> None:
        await self._runner.run(
            [
                "shell", "content", "call",
                "--uri", "content://media",
                "--method", "scan_volume",
                "--arg", "external_primary",
            ],
            check=False,
        )


# -- controller ------------------------------------------------


class AndroidController:
    """High-level Android device controller."""

    def __init__(
        self,
        runner: ADBRunner,
        app_map_path: Path,
        keep_app_state: frozenset[str] = frozenset(),
        resources_path: Path | None = None,
        backup_dir: str = _DEFAULT_BACKUP_DIR,
    ) -> None:
        self._runner = runner
        self._app_map: dict[str, str] = json.loads(
            app_map_path.read_text(encoding="utf-8")
        )
        self._keep_app_state = keep_app_state
        self._resources_path = resources_path
        self._baseline = _FileBaseline(runner, backup_dir)

    @classmethod
    def create(
        cls,
        device_id: str,
        app_map_path: Path,
        *,
        command_timeout: float | None = None,
        adb_binary: str | None = None,
        keep_app_state: frozenset[str] = frozenset(),
        resources_path: Path | None = None,
        backup_dir: str = _DEFAULT_BACKUP_DIR,
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
        return cls(
            runner=runner,
            app_map_path=app_map_path,
            keep_app_state=keep_app_state,
            resources_path=resources_path,
            backup_dir=backup_dir,
        )

    @property
    def keep_app_state(self) -> frozenset[str]:
        return self._keep_app_state

    @property
    def device_id(self) -> str:
        return self._runner.device_id

    @staticmethod
    def is_valid_package_name(name: str) -> bool:
        """Return ``True`` if *name* is a syntactically valid Android
        package name (e.g. ``com.example.app``).
        """
        return bool(_PACKAGE_NAME_PATTERN.match(name))

    # -- connection / lifecycle --

    async def ensure_connected(self) -> None:
        await self._runner.ensure_connected()

    async def reset(self) -> None:
        """Bring the device to a clean baseline before a task."""
        await self._keyevent("KEYCODE_WAKEUP")
        await self._runner.shell("wm dismiss-keyguard")
        await self._keyevent("KEYCODE_HOME")

        await self.clear_running_apps()
        for pkg in _EXTRA_RESET_PACKAGES - self._keep_app_state:
            await self._clear_app_data(pkg, suppress_warnings=True)

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
        duration_ms: int | None = None,
        speed: str = "normal",
    ) -> None:
        x1, y1 = map(int, start)
        x2, y2 = map(int, end)
        ms = (duration_ms
              if duration_ms is not None
              else self._get_swipe_duration(speed))
        await self._runner.shell(
            f"input swipe {x1} {y1} {x2} {y2} {ms}"
        )


    @staticmethod
    def _get_swipe_duration(speed: str) -> int:
        return _SWIPE_DURATIONS_MS.get(
            speed.lower(), _SWIPE_DURATIONS_MS["normal"],
        )

    async def scroll(
        self,
        start: tuple[int, int],
        end: tuple[int, int],
        duration_ms: int | None = None,
        speed: str = "normal",
    ) -> None:
        await self.drag(start, end, duration_ms=duration_ms, speed=speed)

    async def type_text(self, content: str) -> None:
        if not content:
            logger.warning(
                "type_text called with empty content on %s; skipping",
                self._runner.device_id,
            )
            return
        escaped = _escape_for_adb_input(content)
        await self._runner.shell(f"input text {escaped}")

    async def clipboard_get(self) -> str:
        """Return current clipboard text from Android shell."""
        proc = await self._runner.run(
            ["shell", "cmd", "clipboard", "get"],
            check=False,
        )
        return (proc.stdout or "").strip()

    async def clipboard_put(self, content: str) -> None:
        """Put *content* into the Android clipboard."""
        quoted = _quote_for_shell_single(content)
        await self._runner.shell(f"cmd clipboard set text {quoted}")

    async def clipboard_paste(self) -> None:
        """Paste clipboard content into the currently focused field."""
        proc = await self._runner.run(
            ["shell", "input", "keyevent", "KEYCODE_PASTE"],
            check=False,
        )
        if proc.returncode == 0:
            return
        # Fallback for devices that don't support KEYCODE_PASTE.
        text = await self.clipboard_get()
        if text:
            await self.type_text(text)

    @measure_time("screenshot_capture_duration")
    async def screenshot(self) -> Image:
        """Capture the current screen as a PNG :class:`Image`."""
        result = await self._runner.run(
            ["exec-out", "screencap", "-p"],
        )
        return Image.from_png_bytes(result.stdout_bytes)

    @measure_time("dump_ui_tree_duration")
    async def dump_ui_tree(self, n_retries: int = 3) -> str:
        """Dump the UI hierarchy via uiautomator and return raw XML."""
        async def dump_ui_tree_once() -> str:
            result = await self._runner.shell(
                "rm -f /sdcard/window_dump.xml"
                " && uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1"
                " && cat /sdcard/window_dump.xml",
            )
            if not result.stdout.strip():
                raise ADBCommandError(
                    "uiautomator dump",
                    "dump produced an empty file",
                )
            return result.stdout

        return await call_with_retry_async(
            dump_ui_tree_once,
            on=ADBError,
            max_retries=n_retries,
            base_delay=1.0,
            label="dump_ui_tree",
        )

    @measure_time("dump_stable_ui_tree_duration")
    async def dump_stable_ui_tree(
        self,
        *,
        max_polls: int = 3,
        poll_interval: float = 1.0,
    ) -> str:
        """Dump the UI tree, retrying until two consecutive dumps match.

        Returns immediately on a stable result or after *max_polls*
        attempts, whichever comes first.
        """
        prev_xml = ""
        xml = ""
        for _ in range(max_polls):
            xml = await self.dump_ui_tree()
            if xml == prev_xml:
                return xml
            prev_xml = xml
            await asyncio.sleep(poll_interval)
        return xml

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

    async def dispatch_action(
        self, name: str, args: dict[str, object],
    ) -> object | None:
        """Execute a named action with the given arguments.

        This is the single dispatch table for all supported actions.
        Callers that need extra logic (e.g. package resolution for
        ``Launch``) should handle that before calling this method.
        """
        match name.lower():
            case "click":
                self._require_args(name, args, "point")
                await self.click(args["point"])  # type: ignore[arg-type]
            case "longpress":
                self._require_args(name, args, "point")
                await self.long_press(args["point"])  # type: ignore[arg-type]
            case "drag":
                self._require_args(name, args, "start", "end")
                await self.drag(
                    args["start"],  # type: ignore[arg-type]
                    args["end"],  # type: ignore[arg-type]
                    speed=str(args.get("speed", "normal")),
                )
            case "scroll":
                self._require_args(name, args, "start", "end")
                await self.scroll(
                    args["start"],  # type: ignore[arg-type]
                    args["end"],  # type: ignore[arg-type]
                    speed=str(args.get("speed", "normal")),
                )
            case "type":
                self._require_args(name, args, "content")
                await self.type_text(str(args["content"]))
            case "clipboardget":
                return await self.clipboard_get()
            case "clipboardpaste":
                await self.clipboard_paste()
            case "clipboardput":
                self._require_args(name, args, "content")
                await self.clipboard_put(str(args["content"]))
            case "launch":
                self._require_args(name, args, "app")
                await self.launch(str(args["app"]).strip("'\""))
            case "openlink":
                self._require_args(name, args, "url")
                await self.open_link(str(args["url"]))
            case "installapk":
                self._require_args(name, args, "source")
                await self.install_apk(str(args["source"]))
            case "resourcelist":
                return self.list_resources()
            case "filelist":
                return await self.list_device_files(
                    str(args.get("path", "")),
                )
            case "fileput":
                self._require_args(name, args, "source", "dest")
                await self.put_file(
                    str(args["source"]), str(args["dest"]),
                )
            case "filedelete":
                self._require_args(name, args, "path")
                await self.delete_file(str(args["path"]))
            case "uninstall":
                self._require_args(name, args, "app")
                await self.uninstall(str(args["app"]))
            case "forcestop":
                self._require_args(name, args, "app")
                await self.force_stop(str(args["app"]))
            case "wait":
                await self.wait(1.0)
            case "pressback":
                await self.press_back()
            case "presshome":
                await self.press_home()
            case "pressenter":
                await self.press_enter()
            case "pressrecentapps":
                await self.press_recent_apps()
            case _:
                raise ValueError(f"Unsupported action: {name}")

        return None

    @staticmethod
    def _require_args(
        name: str, args: dict[str, object], *keys: str,
    ) -> None:
        """Raise :class:`ValueError` if any of keys is missing from args."""
        missing = sorted(k for k in keys if k not in args)
        if missing:
            raise ValueError(
                f"Action {name!r} missing required args:"
                f" {', '.join(missing)}",
            )

    # -- app management --

    async def launch(self, app_name: str) -> None:
        package = self._resolve_package(app_name)
        if not self.is_valid_package_name(package):
            raise ValueError(
                f"Invalid Android package name: {package!r}"
            )
        try:
            proc = await self._runner.run(
                [
                    "shell", "am", "start",
                    "-a", "android.intent.action.MAIN",
                    "-c", "android.intent.category.LAUNCHER",
                    "-p", package,
                ],
                check=False,
            )
        except ADBCommandError as exc:
            combined = f"{exc.stdout}\n{exc.stderr}"
        else:
            combined = f"{proc.stdout}\n{proc.stderr}"
            if proc.returncode == 0 and not self._am_start_failed(combined):
                return

        if await self._launch_resolved_activity(package):
            return

        raise UnknownAppError(
            f"No launchable activity for package {package!r}"
        )

    @staticmethod
    def _am_start_failed(output: str) -> bool:
        lowered = output.lower()
        return any(
            m in lowered
            for m in _AM_START_FAILURE_MARKERS
        )

    async def _launch_resolved_activity(self, package: str) -> bool:
        component = await self._resolve_activity(package)
        if not component:
            return False

        result = await self._runner.run(
            ["shell", "am", "start", "-W", "-n", component],
            check=False,
        )
        return result.returncode == 0 and "Error:" not in result.stdout

    async def _resolve_activity(self, package: str) -> str | None:
        proc = await self._runner.run(
            [
                "shell", "cmd", "package", "resolve-activity",
                "--brief",
                "-a", "android.intent.action.MAIN",
                "-c", "android.intent.category.LAUNCHER",
                "-p", package,
            ],
            check=False,
        )
        if proc.returncode != 0:
            return None
        return self._parse_resolved_component(proc.stdout, package)

    @staticmethod
    def _parse_resolved_component(
        output: str,
        package: str,
    ) -> str | None:
        for line in reversed(output.splitlines()):
            line = line.strip()
            if not line.startswith(f"{package}/"):
                continue
            component = line
            if component.startswith(f"{package}/."):
                activity = component[len(package) + 1:]
                component = f"{package}/{package}{activity}"
            return component
        return None

    async def install_apk(self, source: str) -> str | None:
        """Install an APK from a local path or HTTP(S) URL via ADB."""
        before = await self.list_installed_packages(third_party_only=True)
        async with fetch_apk(source) as apk_path:
            result = await self._runner.run(
                ["install", "-r", "-t", str(apk_path)],
                check=False,
            )
            output = f"{result.stdout}\n{result.stderr}".strip()
            if result.returncode != 0:
                raise ADBCommandError(
                    f"adb install {apk_path}",
                    result.stderr.strip(),
                    stdout=result.stdout.strip(),
                    returncode=result.returncode,
                )
            logger.info("Installed APK from %s: %s", source, output)
            after = await self.list_installed_packages(third_party_only=True)
            added = sorted(after - before)
            return added[0] if len(added) == 1 else None

    async def open_link(self, url: str) -> None:
        result = await self._runner.run(
            [
                "shell",
                "am",
                "start",
                "-a",
                "android.intent.action.VIEW",
                "-d",
                url,
            ],
            check=False,
        )
        output = f"{result.stdout}\n{result.stderr}".strip()
        if result.returncode != 0 or "Error:" in output:
            raise ADBCommandError(
                f"adb shell am start -a android.intent.action.VIEW -d {url}",
                result.stderr.strip(),
                stdout=result.stdout.strip(),
                returncode=result.returncode,
            )

    # -- file management --

    def list_resources(self) -> str:
        """List files available in the configured resources directory.

        Returns a newline-separated list of paths relative to the
        resources root, or an explanatory line when no resources
        directory is configured, it is missing, or it is empty.
        """
        if self._resources_path is None:
            return "No resources directory configured."
        root = self._resources_path
        if not root.is_dir():
            return f"Resources directory not found: {root}"
        files = sorted(
            p.relative_to(root).as_posix()
            for p in root.rglob("*")
            if p.is_file()
        )
        return "\n".join(files) if files else "(no files)"

    async def list_device_files(self, path: str = "") -> str:
        """List the contents of ``/sdcard/<path>`` on the device."""
        target = self._resolve_sdcard_path(path)
        result = await self._runner.run(
            ["shell", f"ls -1ap {_quote_for_shell_single(target)}"],
            check=False,
        )
        if result.returncode != 0:
            return f"Could not list {target!r}: {result.stderr.strip()}"
        return result.stdout.strip() or "(empty)"

    async def put_file(self, source: str, dest: str) -> None:
        """Push a resource file into a folder under ``/sdcard``.

        *source* is a path relative to the resources directory; *dest*
        is a destination folder under ``/sdcard``. The pushed file keeps
        its source basename. A media scan is broadcast afterwards so the
        file appears in gallery/Files apps. The remote path is tracked
        so :meth:`restore_file_baseline` can reverse the copy when the
        session ends.
        """
        local = self._resolve_resource(source)
        dest_dir = self._resolve_sdcard_path(dest)
        remote = f"{dest_dir}/{local.name}"
        await self._runner.run(
            ["shell", f"mkdir -p {_quote_for_shell_single(dest_dir)}"],
        )
        await self._runner.run(["push", str(local), remote])
        await self._media_scan(remote)

    async def delete_file(self, path: str) -> None:
        """Delete a file under ``/sdcard`` and trigger a media rescan.

        The pre-run snapshot taken by :meth:`snapshot_baseline` brings
        the file back on cleanup if it pre-existed at the baseline.
        """
        remote = self._resolve_sdcard_path(path)
        await self._runner.run(
            ["shell", f"rm -f {_quote_for_shell_single(remote)}"],
        )
        await self._media_scan(remote)

    async def snapshot_baseline(self) -> None:
        """Snapshot external storage so it can be restored after the run."""
        await self._baseline.snapshot()

    async def restore_file_baseline(self) -> None:
        """Restore external storage to its pre-run snapshot.

        Delegates to the file baseline, which deletes the live contents
        of each snapshotted root and re-extracts the archive, then
        rescans MediaStore.
        """
        await self._baseline.restore()

    async def _media_scan(self, remote_path: str) -> None:
        await _broadcast_media_scan(self._runner, remote_path)

    def _resolve_resource(self, source: str) -> Path:
        """Resolve *source* to a file inside the resources directory.

        Raises :class:`ValueError` when no resources directory is
        configured, the resolved path escapes it, or the file is
        missing.
        """
        if self._resources_path is None:
            raise ValueError(
                "No resources directory configured"
                " (--resources-path unset)."
            )
        root = self._resources_path.resolve()
        candidate = (root / source).resolve()
        if not candidate.is_relative_to(root):
            raise ValueError(
                f"Resource path {source!r} escapes the resources directory."
            )
        if not candidate.is_file():
            raise ValueError(f"Resource file not found: {source!r}")
        return candidate

    @staticmethod
    def _resolve_sdcard_path(path: str) -> str:
        """Normalize *path* to an absolute location under ``/sdcard``.

        Accepts a path relative to ``/sdcard`` or an absolute
        ``/sdcard`` path. Raises :class:`ValueError` if it escapes
        ``/sdcard`` via ``..`` segments.
        """
        relative = path.strip()
        for prefix in ("/sdcard/", "/sdcard"):
            if relative.startswith(prefix):
                relative = relative[len(prefix):]
                break
        parts: list[str] = []
        for segment in relative.split("/"):
            if segment in ("", "."):
                continue
            if segment == "..":
                if not parts:
                    raise ValueError(f"Path {path!r} escapes /sdcard.")
                parts.pop()
                continue
            parts.append(segment)
        return "/".join([_SDCARD_ROOT, *parts]) if parts else _SDCARD_ROOT

    async def uninstall(self, app_name: str) -> None:
        package = self._resolve_package(app_name)
        result = await self._runner.run(
            ["uninstall", package],
            check=False,
        )
        output = f"{result.stdout}\n{result.stderr}".strip()
        if result.returncode != 0 and "not installed" not in output.lower():
            raise ADBCommandError(
                f"adb uninstall {package}",
                result.stderr.strip(),
                stdout=result.stdout.strip(),
                returncode=result.returncode,
            )

    async def force_stop(self, app_name: str) -> None:
        """Resolve *app_name* to a package and force-stop it.

        Verifies the package is actually installed before running
        ``am force-stop``. Raises :class:`UnknownAppError` if the
        package cannot be resolved or is not installed.
        """
        package = self._resolve_package(app_name)
        installed = await self.list_installed_packages()
        if package not in installed:
            raise UnknownAppError(
                f"Cannot force-stop {app_name!r}: package {package!r}"
                " is not installed on the device"
            )
        result = await self._force_stop(package)
        if result.returncode != 0:
            raise ADBCommandError(
                f"adb shell am force-stop {package}",
                result.stderr.strip(),
                stdout=result.stdout.strip(),
                returncode=result.returncode,
            )

    async def _force_stop(self, package: str) -> ADBResult:
        """Low-level ``am force-stop`` for an already-resolved package.

        Never raises on a non-zero exit code; callers that care about
        success must inspect the returned :class:`ADBResult`.
        """
        return await self._runner.run(
            ["shell", "am", "force-stop", package],
            check=False,
        )

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

    async def clear_running_apps(self) -> None:
        """
        Force-stop, clear, and revoke runtime permissions for every running
        standard (activityType=1) app, except for packages listed in
        ``keep_app_state``.
        """
        for pkg in await self.get_running_apps():
            if pkg in self._keep_app_state:
                logger.debug("Skipping reset of preserved package %s", pkg)
                continue
            await self._force_stop(pkg)
            await self._clear_app_data(pkg)
            await self._revoke_runtime_permissions(pkg)

    async def close_running_apps(self) -> None:
        """Force-stop running standard apps without clearing their data.

        Unlike :meth:`clear_running_apps`, this only kills the processes
        and returns to the home screen. Packages in ``keep_app_state`` are
        left running.
        """
        for pkg in await self.get_running_apps():
            if pkg in self._keep_app_state:
                logger.debug("Skipping close of preserved package %s", pkg)
                continue
            await self._force_stop(pkg)
        await self._keyevent("KEYCODE_HOME")

    # -- private helpers --

    async def _clear_app_data(
        self,
        package: str,
        suppress_warnings: bool = False,
    ) -> None:
        proc = await self._runner.run(
            ["shell", "pm", "clear", package],
            check=False,
        )
        output = (proc.stderr or "") + (proc.stdout or "")
        if proc.returncode != 0 and not suppress_warnings:
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
        if self.is_valid_package_name(key):
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
