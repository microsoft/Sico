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

"""
Scrcpy client for v2.7.

Protocol (tunnel_forward=true, send_dummy_byte=true, send_device_meta=true):
1. Connect to video socket
2. Read 1 byte dummy byte (0x00)
3. Read 64 bytes device name (if send_device_meta=true)
4. Connect to control socket (if control=true), read 1 byte dummy
5. Read 12 bytes video header: codec(u32) + width(u32) + height(u32) (if send_codec_meta=true)
6. Read video frames: 12 bytes header + data
"""

import asyncio
import struct
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, AsyncIterator
from enum import IntEnum


def _log(msg: str) -> None:
    """Simple print-based logging that always shows."""
    print(f"[scrcpy] {msg}", flush=True)


class VideoCodec(IntEnum):
    H264 = 0x68323634  # "h264"
    H265 = 0x68323635  # "h265"
    AV1 = 0x00617631   # "av1"


class ControlMessageType(IntEnum):
    INJECT_KEYCODE = 0
    INJECT_TEXT = 1
    INJECT_TOUCH_EVENT = 2
    INJECT_SCROLL_EVENT = 3
    BACK_OR_SCREEN_ON = 4


class TouchAction(IntEnum):
    DOWN = 0
    UP = 1
    MOVE = 2


class KeyAction(IntEnum):
    DOWN = 0
    UP = 1


@dataclass
class ScrcpyConfig:
    """Configuration for scrcpy streaming."""
    max_size: int = 1080
    bit_rate: int = 8_000_000
    max_fps: int = 30
    control: bool = True


@dataclass
class VideoPacket:
    """A video frame packet from scrcpy."""
    is_config: bool
    is_keyframe: bool
    pts: int
    data: bytes
    codec: Optional[str] = None
    width: int = 0
    height: int = 0


class ScrcpyClient:
    """Async scrcpy client for H264 video streaming with control."""

    SCRCPY_VERSION = "2.7"

    def __init__(
        self,
        adb_path: str,
        serial: str,
        config: Optional[ScrcpyConfig] = None,
        scrcpy_server_path: Optional[str] = None,
    ):
        self.adb_path = adb_path
        self.serial = serial
        self.config = config or ScrcpyConfig()
        self.scrcpy_server_path = scrcpy_server_path or str(
            Path(__file__).parent / "scrcpy-server"
        )

        self._proc: Optional[asyncio.subprocess.Process] = None
        self._server_log_task: Optional[asyncio.Task] = None
        self._video_reader: Optional[asyncio.StreamReader] = None
        self._video_writer: Optional[asyncio.StreamWriter] = None
        self._control_reader: Optional[asyncio.StreamReader] = None
        self._control_writer: Optional[asyncio.StreamWriter] = None
        self._local_port: int = 0
        self._connected = False
        self._stopping = False

        self.device_name: str = ""
        self.width: int = 0
        self.height: int = 0
        self.codec_name: str = "avc1.640028"

    @property
    def is_connected(self) -> bool:
        return self._connected and not self._stopping

    async def _run_adb(self, args: list[str], timeout: float = 30) -> tuple[int, str, str]:
        """Run an adb command targeting this device (``-s serial``)."""
        return await self._exec_adb(["-s", self.serial] + args, timeout=timeout)

    async def _run_adb_raw(self, args: list[str], timeout: float = 30) -> tuple[int, str, str]:
        """Run an adb command without ``-s serial``.

        Needed for ``connect``/``disconnect`` — the transport may not exist yet.
        """
        return await self._exec_adb(args, timeout=timeout)

    async def _exec_adb(self, args: list[str], timeout: float = 30) -> tuple[int, str, str]:
        """Execute an adb subprocess and return (returncode, stdout, stderr)."""
        cmd = [self.adb_path] + args
        proc: asyncio.subprocess.Process | None = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            return proc.returncode or 0, stdout.decode("utf-8", errors="replace"), stderr.decode("utf-8", errors="replace")
        except asyncio.TimeoutError:
            # Kill the subprocess to prevent zombie adb processes.
            if proc is not None:
                try:
                    proc.kill()
                    await proc.wait()
                except Exception:
                    pass
            raise RuntimeError(f"ADB command timeout: {' '.join(args[:3])}")

    async def _ensure_adb_connected(self) -> None:
        """Ensure ADB is connected to the device and online.

        For TCP devices, calls ``adb connect`` directly — if the ADB server
        already has a working transport, the command returns "already
        connected" immediately with no round-trip to the emulator.

        **Does NOT disconnect first.**  Disconnecting then reconnecting
        wedges the ADB server when another device already has a long-running
        ``adb shell`` session (e.g. scrcpy-server), causing ``adb connect``
        for all subsequent devices to hang indefinitely.
        """
        last_state = ""
        last_connect_error = ""
        for attempt in range(1, 5):
            if ":" in self.serial:
                code, out, err = await self._run_adb_raw(
                    ["connect", self.serial], timeout=12,
                )
                combined = (out + err).strip()
                # adb connect ALWAYS returns exit code 0 — even on failure.
                # Must check stdout for actual result:
                #   success: "connected to X" / "already connected to X"
                #   failure: "failed to connect to X" / "cannot connect to X"
                if "connected to" not in combined.lower():
                    last_connect_error = combined or f"adb connect failed for {self.serial}"
                    if attempt >= 2:
                        try:
                            await self._run_adb_raw(["disconnect", self.serial], timeout=5)
                        except Exception:
                            pass
                    await asyncio.sleep(0.8)
                    continue

            code, out, _ = await self._run_adb(["get-state"], timeout=8)
            state = (out or "").strip()
            last_state = state
            if code == 0 and state == "device":
                # Extra readiness check: ADB may report "device" while shell
                # is still warming up right after boot/reconnect.
                sh_code, sh_out, _ = await self._run_adb(["shell", "echo", "ok"], timeout=5)
                if sh_code == 0 and "ok" in (sh_out or ""):
                    return

            # Recovery path for stale transport: only disconnect/reconnect
            # after failed attempts, never on the happy path.
            if ":" in self.serial and attempt >= 2:
                try:
                    await self._run_adb_raw(["disconnect", self.serial], timeout=5)
                except Exception:
                    pass

            await asyncio.sleep(0.8)

        if last_connect_error:
            raise ConnectionError(
                f"Failed to connect ADB to {self.serial}: {last_connect_error}"
            )

        raise ConnectionError(
            f"Device {self.serial} is not online (state: {last_state})"
        )

    async def _push_server(self) -> str:
        """Push scrcpy-server to device."""
        remote_path = "/data/local/tmp/scrcpy-server.jar"
        local_path = Path(self.scrcpy_server_path)

        if not local_path.exists():
            raise FileNotFoundError(f"scrcpy-server not found: {self.scrcpy_server_path}")

        local_size = local_path.stat().st_size

        # Check if already on device with same size
        code, out, _ = await self._run_adb(["shell", "stat", "-c", "%s", remote_path])
        if code == 0:
            try:
                remote_size = int(out.strip())
                if remote_size == local_size:
                    return remote_path
            except ValueError:
                pass

        code, out, err = await self._run_adb(["push", str(local_path), remote_path])
        if code != 0:
            raise RuntimeError(f"Failed to push scrcpy-server: {err}")

        return remote_path

    def _find_free_port(self) -> int:
        """Find a free local port."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', 0))
            return s.getsockname()[1]

    async def _start_server(self, remote_path: str) -> int:
        """Start scrcpy-server and return local port."""
        local_port = self._find_free_port()

        # Kill any stale scrcpy-server from a previous emulator-service
        # session.  The old process may still hold the localabstract:scrcpy
        # socket, preventing the new server from binding.  Best-effort —
        # failure (e.g. timeout, no matching process) must NOT abort the
        # VNC session.
        try:
            await self._run_adb(
                ["shell", "pkill", "-9", "-f", "com.genymobile.scrcpy.Server"],
                timeout=5,
            )
            # Brief pause to let the killed process release the abstract socket.
            await asyncio.sleep(0.3)
        except Exception as exc:
            _log(f"pkill old scrcpy-server (non-fatal): {exc}")

        # NOTE: Do NOT use "forward --remove-all" here!  In some ADB versions
        # it removes forwards for ALL serials, not just the current one.
        # When multiple devices start scrcpy concurrently, the 2nd device's
        # forward gets deleted by the 3rd device's --remove-all, causing 10
        # failed connection attempts.  Since _find_free_port() always returns
        # a fresh port, there is no stale forward to clean up.  Specific
        # cleanup happens in _cleanup() via "forward --remove tcp:PORT".

        # Setup port forward
        code, out, err = await self._run_adb(["forward", f"tcp:{local_port}", "localabstract:scrcpy"])
        if code != 0:
            raise RuntimeError(f"Failed to setup port forward: {err}")

        # Store port immediately so _cleanup() can remove the forward
        # rule even if the server process fails to start below.
        self._local_port = local_port

        # Build server command - use minimal working parameters
        # Based on successful manual test:
        # tunnel_forward=true audio=false send_device_meta=true send_frame_meta=true send_dummy_byte=true
        args = [
            "tunnel_forward=true",
            "audio=false",
            "send_device_meta=true",
            "send_frame_meta=true",
            "send_dummy_byte=true",
            f"max_size={self.config.max_size}",
            f"video_bit_rate={self.config.bit_rate}",
            f"max_fps={self.config.max_fps}",
        ]
        if self.config.control:
            args.append("control=true")

        server_cmd = [
            f"CLASSPATH={remote_path}",
            "app_process", "/", "com.genymobile.scrcpy.Server",
            self.SCRCPY_VERSION,
        ] + args

        cmd = [self.adb_path, "-s", self.serial, "shell"] + server_cmd

        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        self._server_log_task = None  # Disabled - was causing performance issues

        # Wait for server to start and print device info
        await asyncio.sleep(1.0)

        # Check if process died
        if self._proc.returncode is not None:
            stdout, stderr = await self._proc.communicate()
            out = stderr.decode('utf-8', errors='replace') + stdout.decode('utf-8', errors='replace')
            raise RuntimeError(f"scrcpy-server failed to start: {out[:500]}")

        return local_port

    async def _connect_and_read_initial(self, local_port: int) -> None:
        """Connect to sockets and read initial handshake data.

        IMPORTANT: scrcpy server waits for ALL sockets to connect before sending any data.
        Order: 1) connect video, 2) connect control, 3) read from video, 4) read from control
        """
        # Step 1: Connect video socket
        last_error = None
        for attempt in range(10):
            try:
                self._video_reader, self._video_writer = await asyncio.wait_for(
                    asyncio.open_connection('127.0.0.1', local_port),
                    timeout=2.0
                )
                break
            except (ConnectionRefusedError, asyncio.TimeoutError, OSError) as e:
                last_error = e
                if self._proc and self._proc.returncode is not None:
                    stdout, stderr = await self._proc.communicate()
                    out = stderr.decode('utf-8', errors='replace') + stdout.decode('utf-8', errors='replace')
                    raise RuntimeError(f"scrcpy-server crashed: {out[:500]}")
                await asyncio.sleep(0.2)
        else:
            raise ConnectionError(f"Failed to connect video socket after 10 attempts: {last_error}")

        # Step 2: Connect control socket BEFORE reading any data
        # Server waits for all sockets to connect before sending!
        if self.config.control:
            try:
                self._control_reader, self._control_writer = await asyncio.wait_for(
                    asyncio.open_connection('127.0.0.1', local_port),
                    timeout=5.0
                )
            except Exception:
                self._control_reader = None
                self._control_writer = None

        # Step 3: Now read from video socket - server will start sending after all sockets connected
        try:
            await asyncio.wait_for(self._video_reader.readexactly(1), timeout=10)  # dummy byte
        except asyncio.TimeoutError:
            raise ConnectionError("Timeout reading dummy byte")
        except asyncio.IncompleteReadError as e:
            raise ConnectionError(f"Connection closed while reading dummy byte: {e}")

        # Step 4: Read device name (64 bytes)
        try:
            name_bytes = await asyncio.wait_for(self._video_reader.readexactly(64), timeout=10)
            self.device_name = name_bytes.rstrip(b'\x00').decode('utf-8', errors='replace')
        except asyncio.TimeoutError:
            raise ConnectionError("Timeout reading device name")
        except asyncio.IncompleteReadError as e:
            raise ConnectionError(f"Connection closed while reading device name: {e}")

        # Step 5: Control socket is ready (skip dummy byte read for v2.7)

        # Small delay to ensure server is ready to send video frames
        await asyncio.sleep(0.2)

        # Step 6: Read video codec metadata (12 bytes)
        try:
            header = await asyncio.wait_for(self._video_reader.readexactly(12), timeout=10)
            codec_id, self.width, self.height = struct.unpack(">III", header)

            if codec_id == VideoCodec.H264:
                self.codec_name = "avc1.640028"
            elif codec_id == VideoCodec.H265:
                self.codec_name = "hev1.1.6.L120.B0"
            elif codec_id == VideoCodec.AV1:
                self.codec_name = "av01.0.04M.08"

            _log(f"Video: {self.width}x{self.height}, codec={self.codec_name}")
        except asyncio.TimeoutError:
            raise ConnectionError("Timeout reading video header")
        except asyncio.IncompleteReadError as e:
            raise ConnectionError(f"Connection closed while reading video header: {e}")

    async def start(self) -> None:
        """Start the scrcpy client."""
        if self._connected:
            return

        self._stopping = False

        try:
            await self._ensure_adb_connected()
            remote_path = await self._push_server()
            self._local_port = await self._start_server(remote_path)
            await self._connect_and_read_initial(self._local_port)

            self._connected = True

        except Exception as e:
            _log(f"Start failed: {e}")
            await self._cleanup()
            raise RuntimeError(f"Failed to start scrcpy: {e}") from e

    async def stop(self) -> None:
        """Stop the scrcpy client."""
        self._stopping = True
        self._connected = False
        await self._cleanup()

    async def _cleanup(self) -> None:
        """Clean up resources."""
        # Cancel server log task
        if self._server_log_task:
            self._server_log_task.cancel()
            try:
                await self._server_log_task
            except asyncio.CancelledError:
                pass
            self._server_log_task = None

        for writer in [self._video_writer, self._control_writer]:
            if writer:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass

        if self._proc:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=2)
            except Exception:
                try:
                    self._proc.kill()
                    await asyncio.wait_for(self._proc.wait(), timeout=2)
                except Exception:
                    pass

        # Best-effort: ensure remote scrcpy-server is not left behind if the
        # local adb shell process died unexpectedly.
        try:
            await self._run_adb(
                ["shell", "pkill", "-9", "-f", "com.genymobile.scrcpy.Server"],
                timeout=5,
            )
        except Exception:
            pass

        # Remove port forward
        if self._local_port:
            try:
                await self._run_adb(["forward", "--remove", f"tcp:{self._local_port}"], timeout=5)
            except Exception:
                pass

        self._video_reader = None
        self._video_writer = None
        self._control_reader = None
        self._control_writer = None
        self._proc = None
        self._local_port = 0

    async def video_stream(self) -> AsyncIterator[VideoPacket]:
        """Yield video packets from the stream."""
        if not self._connected or not self._video_reader:
            return

        first_config = True
        frame_count = 0

        while self._connected and not self._stopping:
            # Check if server process died
            if self._proc and self._proc.returncode is not None:
                break

            try:
                # Check if reader is at EOF
                if self._video_reader.at_eof():
                    break

                # Read frame header (12 bytes)
                # [0-7]: flags(2 bits) + PTS(62 bits)
                # [8-11]: packet size (u32)
                header = await asyncio.wait_for(self._video_reader.readexactly(12), timeout=30)

                pts_with_flags = struct.unpack(">Q", header[:8])[0]
                packet_size = struct.unpack(">I", header[8:12])[0]

                # Extract flags from top 2 bits
                is_config = bool(pts_with_flags & (1 << 63))
                is_keyframe = bool(pts_with_flags & (1 << 62))
                pts = pts_with_flags & 0x3FFFFFFFFFFFFFFF

                # Sanity check
                if packet_size > 10 * 1024 * 1024:  # 10MB
                    raise ValueError(f"Invalid packet size: {packet_size}")

                # Read frame data
                data = await asyncio.wait_for(self._video_reader.readexactly(packet_size), timeout=30)

                packet = VideoPacket(
                    is_config=is_config,
                    is_keyframe=is_keyframe,
                    pts=pts,
                    data=data,
                )

                # Add codec info on first config packet
                if is_config and first_config:
                    packet.codec = self.codec_name
                    packet.width = self.width
                    packet.height = self.height
                    first_config = False

                frame_count += 1
                yield packet

            except asyncio.TimeoutError:
                if self._stopping:
                    break
            except asyncio.IncompleteReadError:
                break
            except Exception as e:
                if not self._stopping:
                    _log(f"Video stream error: {type(e).__name__}: {e}")
                break

    # Control methods
    async def inject_touch(self, action: TouchAction, x: int, y: int,
                          pointer_id: int = 0, pressure: float = 1.0) -> None:
        """Inject touch event."""
        if not self._control_writer:
            return

        msg = struct.pack(
            ">BBqiiHHHII",
            ControlMessageType.INJECT_TOUCH_EVENT,
            action,
            pointer_id,
            x, y,
            self.width, self.height,
            int(pressure * 0xFFFF),
            0, 0
        )

        try:
            self._control_writer.write(msg)
            await self._control_writer.drain()
        except Exception:
            pass

    async def inject_key(self, action: KeyAction, keycode: int, metastate: int = 0) -> None:
        """Inject key event."""
        if not self._control_writer:
            return

        msg = struct.pack(
            ">BBiiI",
            ControlMessageType.INJECT_KEYCODE,
            action,
            keycode,
            0,
            metastate,
        )

        try:
            self._control_writer.write(msg)
            await self._control_writer.drain()
        except Exception:
            pass

    async def inject_text(self, text: str) -> None:
        """Inject text."""
        if not self._control_writer:
            return

        text_bytes = text.encode('utf-8')[:300]
        msg = struct.pack(">BI", ControlMessageType.INJECT_TEXT, len(text_bytes)) + text_bytes

        try:
            self._control_writer.write(msg)
            await self._control_writer.drain()
        except Exception:
            pass

    @staticmethod
    def _escape_for_adb_input(text: str) -> str:
        """Escape *text* for ``adb shell input text``.

        The ``input text`` command on Android interprets ``%s`` as a
        space literal.  All other characters that are special to the
        device's ``sh`` (``\\``, ``"``, ``$``, `` ` ``, ``!``, ``(``,
        ``)``, ``&``, ``|``, ``;``, ``'``, ``<``, ``>``, ``{``, ``}``,
        ``~``, ``^``, ``*``, ``?``, ``#``, and whitespace) must be
        individually backslash-escaped so the shell passes them through
        verbatim to the ``input`` binary.
        """
        _SHELL_META = set(' \t\n"\'\\$`!&|;()<>{}~^*?#%')
        parts: list[str] = []
        for ch in text:
            if ch == ' ':
                # Android input text uses %s for literal space
                parts.append('%s')
            elif ch in _SHELL_META:
                parts.append(f'\\{ch}')
            else:
                parts.append(ch)
        return ''.join(parts)

    async def inject_text_via_adb(self, text: str) -> bool:
        """Inject text through ``adb shell input text``.

        This bypasses scrcpy's control-channel injection which can fail
        in WebView-based apps (e.g. Edge login) due to InputDispatcher
        focus issues after scrcpy-server startup.  ``adb shell input``
        uses a separate process context with INJECT_INPUT_EVENT_MODE_WAIT_FOR_RESULT,
        so it is more reliable for delivering characters to focused input fields.

        This path is intended for common direct text entry without requiring
        ADBKeyboard. Full Unicode / IME-composition coverage still depends on
        device and Android ``input text`` behavior.
        """
        if not text:
            return False

        try:
            escaped = self._escape_for_adb_input(text)
            code, _out, _err = await self._run_adb(
                ["shell", "input", "text", escaped],
                timeout=5,
            )
            return code == 0
        except Exception:
            return False

    async def inject_scroll(self, x: int, y: int, h_scroll: int, v_scroll: int) -> None:
        """Inject scroll event."""
        if not self._control_writer:
            return

        msg = struct.pack(
            ">BiiHHiiI",
            ControlMessageType.INJECT_SCROLL_EVENT,
            x, y,
            self.width, self.height,
            h_scroll, v_scroll,
            0,
        )

        try:
            self._control_writer.write(msg)
            await self._control_writer.drain()
        except Exception:
            pass

    async def press_back(self) -> None:
        """Press back button."""
        if not self._control_writer:
            return

        msg = struct.pack(">BB", ControlMessageType.BACK_OR_SCREEN_ON, 0)

        try:
            self._control_writer.write(msg)
            await self._control_writer.drain()
        except Exception:
            pass
