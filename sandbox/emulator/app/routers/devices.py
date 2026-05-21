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

import logging
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, WebSocket, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.deps import get_device_index_map, get_mumu
from app.routers.h264_hub import H264DeviceHub
from app.scrcpy import ScrcpyConfig
from app.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/devices", tags=["devices"])


def _is_tcp_serial(serial: str) -> bool:
    return ":" in serial and not serial.startswith("emulator-")


def _ensure_adb_connected(mumu, serial: str) -> None:
    if not _is_tcp_serial(serial):
        return

    code, out, err = mumu._run_adb(["connect", serial])
    text = ((out or "") + "\n" + (err or "")).lower()
    if code == 0:
        return
    if "already connected" in text or "already connected to" in text:
        return
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"failed to adb connect {serial}")


def _screencap_png(mumu, serial: str) -> bytes:
    _ensure_adb_connected(mumu, serial)
    code, out, err = mumu._run_adb_bytes(["-s", serial, "exec-out", "screencap", "-p"])
    if code != 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=(err or "adb screencap failed"))
    if not out:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="empty screencap output")
    return out


def _run_adb_timeout(mumu, args: list[str], timeout_s: float) -> tuple[int, str, str]:
    adb = str(mumu.adb_path)
    result = subprocess.run(
        [adb] + args,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        timeout=timeout_s,
    )
    return result.returncode, result.stdout, result.stderr


def _serial_from_index(mumu, device_map, index: int) -> str:
    device_map.ensure_loaded(mumu)
    serial = device_map.get_serial(index)
    if serial:
        return serial
    if device_map.has_index(index):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"device index {index} not connected",
        )
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"device index {index} not found",
    )


@router.get("/{index}/snapshot")
def device_snapshot(index: int, mumu=Depends(get_mumu), device_map=Depends(get_device_index_map)):
    serial = _serial_from_index(mumu, device_map, index)
    png = _screencap_png(mumu, serial)
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/{index}/record")
def device_record(
    index: int,
    seconds: int = Query(10, ge=1, le=180),
    bit_rate: int = Query(8_000_000, ge=250_000, le=50_000_000),
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    serial = _serial_from_index(mumu, device_map, index)
    _ensure_adb_connected(mumu, serial)

    remote = f"/sdcard/Download/record_{uuid.uuid4().hex}.mp4"
    timeout = float(seconds) + 15.0

    code, out, err = _run_adb_timeout(
        mumu,
        [
            "-s",
            serial,
            "shell",
            "screenrecord",
            "--time-limit",
            str(seconds),
            "--bit-rate",
            str(bit_rate),
            remote,
        ],
        timeout_s=timeout,
    )
    if code != 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=(err or out or "screenrecord failed"))

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    tmp_path = Path(tmp.name)
    tmp.close()

    try:
        code, out, err = _run_adb_timeout(mumu, ["-s", serial, "pull", remote, str(tmp_path)], timeout_s=30.0)
        if code != 0:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=(err or out or "adb pull failed"))
    finally:
        try:
            _run_adb_timeout(mumu, ["-s", serial, "shell", "rm", "-f", remote], timeout_s=10.0)
        except Exception:
            pass

    def _cleanup_local() -> None:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    return FileResponse(
        path=str(tmp_path),
        media_type="video/mp4",
        filename=f"device_{index}_{int(time.time())}.mp4",
        background=BackgroundTask(_cleanup_local),
    )


# =============================================================================
# H264 WebSocket Streaming (scrcpy)
# =============================================================================

@router.websocket("/{index}/ws/h264")
async def device_h264_ws_scrcpy(
    websocket: WebSocket,
    index: int,
    max_size: int = 1080,
    bit_rate: int = 8_000_000,
    max_fps: int = 30,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
    settings=Depends(get_settings),
):
    """
    Stream H264 video via WebSocket using scrcpy.

    Features:
    - No time limit
    - Hardware encoding (low CPU)
    - Low latency (~35ms)
    - Touch/keyboard control support
    """
    await websocket.accept()

    if max_size < 128 or max_size > 4096:
        await websocket.close(code=1008, reason="max_size must be 128-4096")
        return
    if bit_rate < 250_000 or bit_rate > 50_000_000:
        await websocket.close(code=1008, reason="bit_rate must be 250000-50000000")
        return

    # Handle device lookup errors gracefully for WebSocket
    try:
        device_map.refresh(mumu)
        serial = _serial_from_index(mumu, device_map, index)
        _ensure_adb_connected(mumu, serial)
    except HTTPException as e:
        await websocket.send_json({"type": "error", "message": e.detail})
        await websocket.close(code=1008, reason=str(e.detail)[:120])
        return

    adb_path = str(mumu.adb_path)

    # Find scrcpy-server (support PyInstaller bundled app)
    scrcpy_server_path = _find_scrcpy_server()

    if not scrcpy_server_path:
        logger.error("scrcpy-server not found")
        await websocket.send_json({"type": "error", "message": "scrcpy-server not found. Please ensure it is bundled with the application."})
        await websocket.close(code=1011)
        return

    config = ScrcpyConfig(max_size=max_size, bit_rate=bit_rate, max_fps=max_fps, control=True)
    await H264DeviceHub.subscribe(
        device_index=index,
        websocket=websocket,
        adb_path=adb_path,
        serial=serial,
        config=config,
        scrcpy_server_path=scrcpy_server_path,
        restore_input_focus_on_start=settings.emulator_h264_restore_input_focus_on_start,
    )


def _find_scrcpy_server() -> Optional[str]:
    """Find scrcpy-server, supporting both normal and PyInstaller bundled execution."""
    import sys

    # Possible locations
    candidates = []

    # Normal execution: relative to this file
    candidates.append(Path(__file__).parent.parent / "scrcpy" / "scrcpy-server")

    # PyInstaller bundled (--add-data puts files in _MEIPASS)
    if hasattr(sys, '_MEIPASS'):
        meipass = Path(sys._MEIPASS)
        candidates.append(meipass / "app" / "scrcpy" / "scrcpy-server")
        candidates.append(meipass / "scrcpy-server")

    # PyInstaller onedir: _internal folder next to executable
    exe_dir = Path(sys.executable).parent
    candidates.append(exe_dir / "app" / "scrcpy" / "scrcpy-server")
    candidates.append(exe_dir / "_internal" / "app" / "scrcpy" / "scrcpy-server")

    # Current working directory
    candidates.append(Path.cwd() / "app" / "scrcpy" / "scrcpy-server")
    candidates.append(Path.cwd() / "_internal" / "app" / "scrcpy" / "scrcpy-server")

    for path in candidates:
        if path and path.exists():
            logger.info(f"Found scrcpy-server at: {path}")
            return str(path)

    logger.error(f"scrcpy-server not found in any of: {[str(p) for p in candidates if p]}")
    return None
