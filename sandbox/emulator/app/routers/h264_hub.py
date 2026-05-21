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

"""H264 fan-out hub for emulator devices.

Maintains at most ONE scrcpy process per device and broadcasts H264 frames to
all connected WebSocket viewers.  This prevents "too many encoders" errors when
multiple upstream connections (e.g. from different backend replicas) stream the
same device simultaneously.

Architecture::

    WebSocket client 1 ──┐
    WebSocket client 2 ──┼── H264DeviceHub (per device) ── ScrcpyClient (1)
    WebSocket client N ──┘

The hub:
  1. Starts a single scrcpy process when the first viewer connects.
  2. Reads H264 frames from scrcpy and broadcasts to all viewers via
     per-viewer async queues (non-blocking; slow clients drop frames).
  3. Caches the latest config (SPS/PPS) and keyframe so late-joining
     viewers can begin playback immediately.
  4. Forwards control messages (touch, key, text, scroll) from any
     viewer to the single scrcpy process.
  5. Stops scrcpy when the last viewer disconnects.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

from app.scrcpy import ScrcpyClient, ScrcpyConfig, TouchAction, KeyAction

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TOUCH_ACTION_MAP = {
    "down": TouchAction.DOWN,
    "up": TouchAction.UP,
    "move": TouchAction.MOVE,
}

_KEY_ACTION_MAP = {
    "down": KeyAction.DOWN,
    "up": KeyAction.UP,
}

_KEYFRAME_FLAG = b'\x01'
_DELTA_FLAG = b'\x00'


# ---------------------------------------------------------------------------
# Internal data types
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class _H264Frame:
    """A frame to broadcast to viewers (JSON config OR binary video data)."""
    is_json: bool
    json_data: Optional[dict] = None
    binary_data: Optional[bytes] = None


@dataclass(slots=True)
class _H264Viewer:
    """A connected WebSocket viewer with its own bounded send queue."""
    websocket: WebSocket
    queue: asyncio.Queue  # Queue[Optional[_H264Frame]], None = sentinel


# ---------------------------------------------------------------------------
# H264DeviceHub
# ---------------------------------------------------------------------------

class H264DeviceHub:
    """Per-device fan-out hub: one scrcpy process, N WebSocket viewers.

    Class-level registry maps ``device_index → hub``.  All state mutations
    are protected by :pyclass:`asyncio.Lock` so the hub is safe for
    concurrent WebSocket handlers on the same event loop.
    """

    # ---- class-level registry ----
    _hubs: dict[int, "H264DeviceHub"] = {}
    _lock = asyncio.Lock()
    _device_locks: dict[int, asyncio.Lock] = {}

    # ---- public API ----

    @classmethod
    async def subscribe(
        cls,
        device_index: int,
        websocket: WebSocket,
        adb_path: str,
        serial: str,
        config: ScrcpyConfig,
        scrcpy_server_path: str,
        restore_input_focus_on_start: bool = True,
    ) -> None:
        """Add a WebSocket viewer to the hub for *device_index*.

        Creates a new scrcpy session if this is the first viewer (or the
        previous session has ended).  Blocks until the viewer disconnects
        or the scrcpy stream ends.
        """
        try:
            hub = await cls._get_or_create(
                device_index,
                adb_path,
                serial,
                config,
                scrcpy_server_path,
                restore_input_focus_on_start,
            )
        except Exception as e:
            error_msg = str(e) or repr(e) or "Failed to start scrcpy"
            logger.error(
                "[H264 Hub] Device %d: start failed: %s",
                device_index, error_msg, exc_info=True,
            )
            try:
                await websocket.send_json({"type": "error", "message": error_msg})
                await websocket.close(code=1011)
            except Exception:
                pass
            return

        await hub._handle_viewer(websocket)

    # ---- class-level helpers ----

    @classmethod
    async def _get_device_lock(cls, device_index: int) -> asyncio.Lock:
        """Get/create a per-device lock so unrelated devices can proceed concurrently."""
        async with cls._lock:
            lock = cls._device_locks.get(device_index)
            if lock is None:
                lock = asyncio.Lock()
                cls._device_locks[device_index] = lock
            return lock

    @classmethod
    async def _get_or_create(
        cls,
        device_index: int,
        adb_path: str,
        serial: str,
        config: ScrcpyConfig,
        scrcpy_server_path: str,
        restore_input_focus_on_start: bool,
    ) -> "H264DeviceHub":
        device_lock = await cls._get_device_lock(device_index)
        async with device_lock:
            async with cls._lock:
                hub = cls._hubs.get(device_index)

            if hub is not None and hub._running:
                # If the device serial changed (e.g. reconnected), tear down
                # the old hub so we start a fresh scrcpy session.
                if hub._serial != serial:
                    logger.info(
                        "[H264 Hub] Device %d: serial changed %s -> %s, recreating",
                        device_index, hub._serial, serial,
                    )
                    await hub._stop()
                else:
                    return hub

            hub = H264DeviceHub(
                device_index,
                adb_path,
                serial,
                config,
                scrcpy_server_path,
                restore_input_focus_on_start,
            )
            await hub._start()

            async with cls._lock:
                cls._hubs[device_index] = hub

            return hub

    @classmethod
    async def _remove_if_empty(cls, device_index: int, hub: "H264DeviceHub") -> None:
        """Shut down *hub* and remove it from the registry if no viewers remain."""
        device_lock = await cls._get_device_lock(device_index)
        async with device_lock:
            async with hub._viewers_lock:
                is_empty = len(hub._viewers) == 0

            if not is_empty:
                return

            async with cls._lock:
                current_hub = cls._hubs.get(device_index)

            # Only remove if this is still the same hub AND it has no viewers.
            if current_hub is hub:
                await hub._stop()
                async with cls._lock:
                    if cls._hubs.get(device_index) is hub:
                        del cls._hubs[device_index]
                    cls._device_locks.pop(device_index, None)

    # ---- instance ----

    def __init__(
        self,
        device_index: int,
        adb_path: str,
        serial: str,
        config: ScrcpyConfig,
        scrcpy_server_path: str,
        restore_input_focus_on_start: bool,
    ):
        self._device_index = device_index
        self._adb_path = adb_path
        self._serial = serial
        self._config = config
        self._scrcpy_server_path = scrcpy_server_path
        self._restore_input_focus_on_start = restore_input_focus_on_start

        self._client: Optional[ScrcpyClient] = None
        self._viewers: dict[WebSocket, _H264Viewer] = {}
        self._viewers_lock = asyncio.Lock()
        self._pump_task: Optional[asyncio.Task] = None
        self._input_focus_task: Optional[asyncio.Task] = None
        self._running = False
        self._start_time: float = 0.0

        # Cached init data so late joiners can start decoding immediately.
        self._cached_config: Optional[_H264Frame] = None
        self._cached_keyframe: Optional[_H264Frame] = None

    # ---- lifecycle ----

    async def _start(self) -> None:
        self._client = ScrcpyClient(
            self._adb_path,
            self._serial,
            self._config,
            scrcpy_server_path=self._scrcpy_server_path,
        )
        await self._client.start()
        self._start_time = time.monotonic()
        self._running = True
        self._pump_task = asyncio.create_task(self._pump())
        logger.info(
            "[H264 Hub] Device %d: scrcpy started (serial=%s)",
            self._device_index, self._serial,
        )

        if self._restore_input_focus_on_start:
            self._input_focus_task = asyncio.create_task(
                self._restore_input_focus_after_start()
            )

    async def _restore_input_focus_after_start(self) -> None:
        if self._client is None:
            return

        # Refresh Android input focus after scrcpy-server startup.
        # scrcpy-server's app_process can disrupt the foreground window's
        # input focus, causing keyboard/text input to be silently dropped
        # until the user manually presses Home and re-enters the app.
        #
        # Fix: read the current foreground Activity, press HOME to cycle
        # it through onPause→onStop, then re-launch it via `am start -W`
        # to bring it back through onResume — which rebuilds the
        # InputDispatcher focus.
        #
        # NOTE: `am start -n` may create a new Activity instance depending
        # on the target's launchMode / taskAffinity; this is acceptable
        # because the goal is to restore *input focus*, not to guarantee
        # exact instance reuse.
        #
        # Uses ADB shell (not scrcpy inject_key) because the scrcpy control
        # socket may not be fully stable during server initialization.
        try:
            await asyncio.sleep(0.3)  # let scrcpy-server finish internal init
            run = self._client._run_adb

            _, activity_out, _ = await run(
                ["shell", "dumpsys", "activity", "activities"],
                timeout=5,
            )
            component = None
            if activity_out:
                for line in activity_out.splitlines():
                    if "mResumedActivity" in line or \
                       "topResumedActivity" in line:
                        for token in line.split():
                            if "/" in token and "." in token:
                                component = token.rstrip("}")
                                break
                        if component:
                            break

            if not component:
                logger.warning(
                    "[H264 Hub] Device %d: could not determine foreground "
                    "activity from dumpsys, skipping input focus fix",
                    self._device_index,
                )
            else:
                await run(["shell", "input", "keyevent", "3"], timeout=3)
                await asyncio.sleep(0.3)

                code, am_out, _ = await run(
                    ["shell", "am", "start", "-W", "-n", component],
                    timeout=8,
                )
                if code == 0:
                    logger.info(
                        "[H264 Hub] Device %d: cycled %s to restore input focus",
                        self._device_index, component,
                    )
                else:
                    logger.warning(
                        "[H264 Hub] Device %d: am start -W %s returned %d: %s",
                        self._device_index, component, code,
                        (am_out or "").strip()[:200],
                    )
        except Exception as exc:
            logger.warning(
                "[H264 Hub] Device %d: input focus fix failed: %s",
                self._device_index, exc,
            )

    async def _stop(self) -> None:
        self._running = False
        if self._input_focus_task:
            self._input_focus_task.cancel()
            try:
                await self._input_focus_task
            except asyncio.CancelledError:
                pass
            finally:
                self._input_focus_task = None
        if self._pump_task:
            self._pump_task.cancel()
            try:
                await self._pump_task
            except asyncio.CancelledError:
                pass
            self._pump_task = None
        if self._client:
            await self._client.stop()
            self._client = None
        self._cached_config = None
        self._cached_keyframe = None
        logger.info("[H264 Hub] Device %d: scrcpy stopped", self._device_index)

    # ---- pump (scrcpy → viewers) ----

    async def _pump(self) -> None:
        """Read H264 frames from scrcpy and broadcast to all viewers."""
        assert self._client is not None
        try:
            async for packet in self._client.video_stream():
                if not self._running:
                    break

                if packet.is_config:
                    config_msg = {
                        "type": "config",
                        "codec": packet.codec or self._client.codec_name,
                        "description": base64.b64encode(packet.data).decode("ascii"),
                        "width": packet.width or self._client.width,
                        "height": packet.height or self._client.height,
                    }
                    frame = _H264Frame(is_json=True, json_data=config_msg)
                    self._cached_config = frame
                else:
                    ts_us = int((time.monotonic() - self._start_time) * 1_000_000)
                    flag = _KEYFRAME_FLAG if packet.is_keyframe else _DELTA_FLAG
                    header = flag + ts_us.to_bytes(8, "big", signed=False)
                    frame = _H264Frame(is_json=False, binary_data=header + packet.data)
                    if packet.is_keyframe:
                        self._cached_keyframe = frame

                # Broadcast (non-blocking; slow viewers drop frames).
                async with self._viewers_lock:
                    for viewer in self._viewers.values():
                        if packet.is_keyframe and self._cached_config is not None:
                            self._enqueue_keyframe(viewer, self._cached_config, frame)
                        else:
                            self._enqueue_latest_frame(viewer, frame)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(
                "[H264 Hub] Device %d: pump error: %s",
                self._device_index, e,
            )
        finally:
            self._running = False
            # Send sentinel to all viewer queues so send loops exit promptly.
            async with self._viewers_lock:
                for viewer in list(self._viewers.values()):
                    # Clear queue to guarantee room for the sentinel.
                    while not viewer.queue.empty():
                        try:
                            viewer.queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    try:
                        viewer.queue.put_nowait(None)  # type: ignore[arg-type]
                    except asyncio.QueueFull:
                        pass

    # ---- viewer lifecycle ----

    async def _handle_viewer(self, websocket: WebSocket) -> None:
        """Manage a single viewer: send loop + control loop, with cleanup."""
        viewer = _H264Viewer(
            websocket=websocket,
            queue=asyncio.Queue(maxsize=4),
        )

        # Register viewer and snapshot cached init data.
        async with self._viewers_lock:
            if not self._running:
                try:
                    await websocket.send_json(
                        {"type": "error", "message": "scrcpy session ended"},
                    )
                    await websocket.close(code=1011)
                except Exception:
                    pass
                return
            self._viewers[websocket] = viewer
            cached_config = self._cached_config
            cached_keyframe = self._cached_keyframe
            viewer_count = len(self._viewers)

        logger.info(
            "[H264 Hub] Device %d: viewer joined (total=%d)",
            self._device_index, viewer_count,
        )

        # Send cached config + keyframe so playback starts immediately.
        try:
            if cached_config and cached_config.json_data is not None:
                await websocket.send_json(cached_config.json_data)
            if cached_keyframe and cached_keyframe.binary_data is not None:
                await websocket.send_bytes(cached_keyframe.binary_data)
        except Exception:
            pass

        # Run send and control loops; when either exits, cancel the other.
        send_task = asyncio.create_task(self._viewer_send_loop(viewer))
        control_task = asyncio.create_task(self._viewer_control_loop(viewer))

        try:
            _done, pending = await asyncio.wait(
                [send_task, control_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
        finally:
            async with self._viewers_lock:
                self._viewers.pop(websocket, None)
                remaining = len(self._viewers)

            logger.info(
                "[H264 Hub] Device %d: viewer left (remaining=%d)",
                self._device_index, remaining,
            )

            try:
                await websocket.close(code=1000)
            except Exception:
                pass

            if remaining == 0:
                await H264DeviceHub._remove_if_empty(self._device_index, self)

    @staticmethod
    def _enqueue_latest_frame(viewer: _H264Viewer, frame: _H264Frame) -> None:
        """Enqueue a frame, dropping stale data if the viewer falls behind.

        Config (SPS/PPS): enqueue without draining — config is small and must
        not be lost; it will be followed immediately by a keyframe.

        Keyframe: drain the entire queue so the viewer jumps to the latest GOP
        boundary — old delta frames that reference a prior keyframe are useless.

        Delta frame: drop only the oldest frame to stay close to live without
        discarding the reference keyframe the remaining deltas depend on.
        """
        is_keyframe = (
            not frame.is_json
            and frame.binary_data is not None
            and len(frame.binary_data) >= 1
            and frame.binary_data[:1] == _KEYFRAME_FLAG
        )

        if is_keyframe:
            # Drain stale frames — jump to live edge.
            while not viewer.queue.empty():
                try:
                    viewer.queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
        elif not frame.is_json:
            # Delta: drop one oldest frame if full.
            try:
                viewer.queue.put_nowait(frame)
                return
            except asyncio.QueueFull:
                try:
                    viewer.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass

        # Config / keyframe / delta-after-drop: enqueue.
        try:
            viewer.queue.put_nowait(frame)
        except asyncio.QueueFull:
            pass

    @staticmethod
    def _enqueue_keyframe(
        viewer: _H264Viewer,
        config_frame: _H264Frame,
        keyframe: _H264Frame,
    ) -> None:
        """Enqueue a keyframe together with its latest decoder config.

        Drains stale data first, then enqueues ``config_frame`` followed by
        ``keyframe`` so viewers always decode the GOP boundary with a matching
        SPS/PPS payload.
        """
        while not viewer.queue.empty():
            try:
                viewer.queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        for frame in (config_frame, keyframe):
            try:
                viewer.queue.put_nowait(frame)
            except asyncio.QueueFull:
                return

    async def _viewer_send_loop(self, viewer: _H264Viewer) -> None:
        """Drain the per-viewer queue and send frames over the WebSocket."""
        while True:
            try:
                frame = await asyncio.wait_for(viewer.queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                if not self._running:
                    return
                continue

            if frame is None:
                return  # sentinel — stream ended

            try:
                if frame.is_json and frame.json_data is not None:
                    await viewer.websocket.send_json(frame.json_data)
                elif frame.binary_data is not None:
                    await viewer.websocket.send_bytes(frame.binary_data)
            except Exception:
                return

    async def _viewer_control_loop(self, viewer: _H264Viewer) -> None:
        """Read control messages from the viewer and forward to scrcpy."""
        try:
            while self._running and self._client and self._client.is_connected:
                try:
                    msg = await asyncio.wait_for(
                        viewer.websocket.receive_json(), timeout=1.0,
                    )
                except asyncio.TimeoutError:
                    continue
                except WebSocketDisconnect:
                    return

                msg_type = msg.get("type")

                if msg_type == "touch":
                    action = _TOUCH_ACTION_MAP.get(msg.get("action", "").lower())
                    if action is not None:
                        await self._client.inject_touch(
                            action=action,
                            x=int(msg.get("x", 0)),
                            y=int(msg.get("y", 0)),
                            pointer_id=int(msg.get("pointerId", 0)),
                            pressure=float(msg.get("pressure", 1.0)),
                        )

                elif msg_type == "key":
                    action = _KEY_ACTION_MAP.get(msg.get("action", "").lower())
                    if action is not None:
                        await self._client.inject_key(
                            action=action,
                            keycode=int(msg.get("keycode", 0)),
                            metastate=int(msg.get("metastate", 0)),
                        )

                elif msg_type == "text":
                    text = msg.get("text", "")
                    if text:
                        injected = await self._client.inject_text_via_adb(text)
                        if not injected:
                            await self._client.inject_text(text)

                elif msg_type == "scroll":
                    await self._client.inject_scroll(
                        x=int(msg.get("x", 0)),
                        y=int(msg.get("y", 0)),
                        h_scroll=int(msg.get("hScroll", 0)),
                        v_scroll=int(msg.get("vScroll", 0)),
                    )

                elif msg_type == "back":
                    await self._client.press_back()

                elif msg_type == "ping":
                    try:
                        await viewer.websocket.send_json({"type": "pong"})
                    except Exception:
                        return

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(
                "[H264 Hub] Device %d: control loop error: %s",
                self._device_index, e,
            )
