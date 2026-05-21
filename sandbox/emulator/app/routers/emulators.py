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

import ctypes
import ipaddress
import logging
import os
import socket
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Annotated, List

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status

from app.deps import get_device_index_map, get_mumu, _make_mumu
from app.routers.devices import _serial_from_index, _ensure_adb_connected
from app.schemas import (
    AdbShellRequest,
    CloneEmulatorsRequest,
    CreateEmulatorsRequest,
    DownloadAppRequest,
    PackageRequest,
    StartEmulatorRequest,
    StartEmulatorsBatchRequest,
)
from app.settings import Settings, get_settings

_IS_MACOS = sys.platform == "darwin"
_DEFAULT_DISPLAY_WIDTH = 720
_DEFAULT_DISPLAY_HEIGHT = 1280
_DEFAULT_DISPLAY_DPI = 320
_DEFAULT_MUMU_RESOLUTION_MODE = "phone"
_DOWNLOAD_CHUNK_SIZE = 1024 * 1024
_DOWNLOAD_TIMEOUT_SECONDS = 60

router = APIRouter(prefix="/emulators", tags=["emulators"])


def _select(mumu, index: int):
    return mumu.select(index)


def _extract_indices_from_mapping(value) -> set[int]:
    """Best-effort parse of emulator indices from MuMu JSON mappings."""
    indices: set[int] = set()
    if not isinstance(value, dict):
        return indices
    for key in value.keys():
        try:
            indices.add(int(key))
        except (TypeError, ValueError):
            continue
    return indices


def _existing_indices(mumu) -> set[int]:
    """Return known emulator indices (running and stopped) when available."""
    indices: set[int] = set()

    if mumu.is_avd:
        return mumu._avd_indices()

    # Source 1: adb connect info for all instances.
    try:
        adb_info = mumu.all().adb.get_connect_info()
        indices |= _extract_indices_from_mapping(adb_info)
    except Exception:
        pass

    # Source 2: player names from settings for all instances.
    try:
        player_names = mumu.all().setting.get("player_name")
        indices |= _extract_indices_from_mapping(player_names)
    except Exception:
        pass

    # Windows fallback: if aggregate discovery fails entirely, probe a bounded
    # index range directly. This preserves the pre-macOS-support behavior where
    # valid stopped instances could still be addressed by index even if the
    # aggregate listing path was temporarily unavailable.
    if not indices and not _IS_MACOS:
        probe_limit = max(0, get_settings().emulator_windows_index_probe_limit)
        for idx in range(probe_limit):
            try:
                _select(mumu, idx).setting.get("player_name")
                indices.add(idx)
            except Exception:
                continue

    return indices


def _ensure_index(mumu, index: int) -> None:
    known = _existing_indices(mumu)
    # Aggregate discovery is best-effort. On Windows it may transiently fail
    # even though a direct per-index settings probe still works. On macOS,
    # stopped devices do not expose adb_host/adb_port, so aggregate discovery
    # may be empty even for a valid clone/start target.
    if known and index not in known:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"emulator index {index} not found",
        )

    # For AVD, _existing_indices already called _avd_indices() — done.
    if mumu.is_avd:
        return

    try:
        if _IS_MACOS:
            # mumutool doesn't support reading individual settings. When the
            # selected macOS device is running, adb connect-info is a useful
            # per-index probe. When aggregate discovery is empty, however,
            # the device may simply be stopped; allow the requested operation
            # (e.g. clone/start) to be the authoritative existence check.
            if known:
                info = _select(mumu, index).adb.get_connect_info()
                if info == (None, None):
                    raise ValueError("device not reachable")
            return
        else:
            _select(mumu, index).setting.get("player_name")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"emulator index {index} not found",
        ) from exc


def _is_emulator_running(mumu, index: int) -> bool:
    if mumu.is_avd:
        return mumu._is_emulator_running(index)

    try:
        host, port = _select(mumu, index).adb.get_connect_info()
    except Exception:
        return False
    return bool(host and port)


def _require_running_emulator(mumu, index: int, operation: str) -> None:
    if not _is_emulator_running(mumu, index):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"emulator {index} must be running before {operation}",
        )


def _require_stopped_for_mumu_clone(mumu, index: int) -> None:
    if not mumu.is_avd and not _IS_MACOS and _is_emulator_running(mumu, index):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Emulator {index} must be stopped before cloning on MuMu. "
                "Stop the source emulator and retry cloning."
            ),
        )


@router.get("/indices")
def list_emulator_indices(mumu=Depends(get_mumu)):
    return {"indices": sorted(_existing_indices(mumu))}


def _cleanup_temp_file(path: Path, retries: int = 5, delay: float = 0.5) -> None:
    for _ in range(retries):
        try:
            if path.exists():
                path.unlink()
            return
        except PermissionError:
            time.sleep(delay)


class _RejectRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="download URL redirects are not allowed",
        )


def _set_display_defaults(mumu, index: int) -> None:
    try:
        if mumu.is_avd:
            _select(mumu, index).setting.set(
                hw__lcd__width=_DEFAULT_DISPLAY_WIDTH,
                hw__lcd__height=_DEFAULT_DISPLAY_HEIGHT,
                hw__lcd__density=_DEFAULT_DISPLAY_DPI,
            )
        else:
            _select(mumu, index).setting.set(
                resolution_mode=_DEFAULT_MUMU_RESOLUTION_MODE,
                window_auto_rotate=False,
                window_size_fixed=True,
            )
    except Exception:
        pass


def _is_reserved_mumu_pad_index(mumu, index: int) -> bool:
    return not mumu.is_avd and not _IS_MACOS and index == 0


def _create_requested_emulators(mumu, count: int) -> list[int]:
    """Create *count* emulator devices, skipping the reserved MuMu pad index (0).

    On Windows MuMu, the first ``create`` call on a clean host always
    materializes device-0 (the built-in tablet/pad instance).  Rather than
    deleting it — which would destroy a user-managed device — we simply
    skip it and ask for one more device so the caller still gets exactly
    *count* usable indices back.
    """
    if mumu.is_avd or _IS_MACOS:
        return mumu.core.create(count)

    created: list[int] = []
    seen: set[int] = set()

    for attempt in range(max(3, count + 2)):
        remaining = count - len(created)
        if remaining <= 0:
            break

        batch = mumu.core.create(remaining)

        for index in batch:
            if _is_reserved_mumu_pad_index(mumu, index):
                _LOGGER.info(
                    "skipping reserved MuMu device-0 returned by create "
                    "(attempt %d); will request one more device",
                    attempt + 1,
                )
                continue
            if index in seen:
                continue
            seen.add(index)
            created.append(index)

        if len(created) >= count:
            return created[:count]

    if created:
        return created

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create the requested non-zero MuMu device(s)",
    )


def _validate_install_url(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only http/https URLs are allowed. Got: {parsed.scheme or 'empty'}",
        )
    if not parsed.hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Download URL must include a hostname",
        )
    if parsed.username or parsed.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Download URL must not include embedded credentials",
        )

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addr_info = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to resolve download host: {parsed.hostname}",
        ) from exc

    resolved_any = False
    for family, _, _, _, sockaddr in addr_info:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue
        resolved_any = True
        raw_ip = sockaddr[0].split("%", 1)[0]
        ip = ipaddress.ip_address(raw_ip)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
            or getattr(ip, "is_site_local", False)
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Download host resolves to a non-public address: {parsed.hostname}",
            )

    if not resolved_any:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to resolve a public IP for host: {parsed.hostname}",
        )

    return parsed


def _download_install_url(url: str, tmp_file) -> None:
    opener = urllib.request.build_opener(_RejectRedirectHandler)
    request = urllib.request.Request(url, headers={"User-Agent": "EmulatorRemoteAPI/0.2.0"})

    try:
        with opener.open(request, timeout=_DOWNLOAD_TIMEOUT_SECONDS) as response:
            while True:
                chunk = response.read(_DOWNLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                tmp_file.write(chunk)
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        status_code = status.HTTP_502_BAD_GATEWAY
        if 300 <= exc.code < 400:
            status_code = status.HTTP_400_BAD_REQUEST
        raise HTTPException(
            status_code=status_code,
            detail=f"Failed to download URL: HTTP {exc.code}",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to download URL: {exc.reason}",
        ) from exc


_LOGGER = logging.getLogger(__name__)
_START_SLOTS_LOCK = threading.Lock()
_START_SLOTS: threading.BoundedSemaphore | None = None
_START_SLOTS_SIZE = 0


class _FileTime(ctypes.Structure):
    _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]


class _MemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_uint32),
        ("dwMemoryLoad", ctypes.c_uint32),
        ("ullTotalPhys", ctypes.c_uint64),
        ("ullAvailPhys", ctypes.c_uint64),
        ("ullTotalPageFile", ctypes.c_uint64),
        ("ullAvailPageFile", ctypes.c_uint64),
        ("ullTotalVirtual", ctypes.c_uint64),
        ("ullAvailVirtual", ctypes.c_uint64),
        ("sullAvailExtendedVirtual", ctypes.c_uint64),
    ]


def _get_start_slots(settings: Settings) -> threading.BoundedSemaphore:
    global _START_SLOTS, _START_SLOTS_SIZE

    desired_size = max(1, int(settings.emulator_start_max_parallel))
    with _START_SLOTS_LOCK:
        if _START_SLOTS is None or _START_SLOTS_SIZE != desired_size:
            _START_SLOTS = threading.BoundedSemaphore(desired_size)
            _START_SLOTS_SIZE = desired_size
        return _START_SLOTS


def _sample_cpu_usage_percent(sample_seconds: float = 0.2) -> float | None:
    if os.name == "nt":
        kernel32 = ctypes.windll.kernel32

        def _read_times() -> tuple[int, int, int] | None:
            idle = _FileTime()
            kernel = _FileTime()
            user = _FileTime()
            if not kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                return None
            idle_value = (idle.dwHighDateTime << 32) | idle.dwLowDateTime
            kernel_value = (kernel.dwHighDateTime << 32) | kernel.dwLowDateTime
            user_value = (user.dwHighDateTime << 32) | user.dwLowDateTime
            return idle_value, kernel_value, user_value

        first = _read_times()
        if first is None:
            return None
        time.sleep(max(0.05, sample_seconds))
        second = _read_times()
        if second is None:
            return None

        idle_delta = second[0] - first[0]
        kernel_delta = second[1] - first[1]
        user_delta = second[2] - first[2]
        total_delta = kernel_delta + user_delta
        if total_delta <= 0:
            return None
        return max(0.0, min(100.0, 100.0 * (1.0 - (idle_delta / total_delta))))

    if hasattr(os, "getloadavg"):
        try:
            load1, _, _ = os.getloadavg()
        except OSError:
            return None
        cpu_count = os.cpu_count() or 1
        return max(0.0, min(100.0, (load1 / cpu_count) * 100.0))

    return None


def _available_memory_mb() -> int | None:
    if os.name == "nt":
        kernel32 = ctypes.windll.kernel32
        status = _MemoryStatusEx()
        status.dwLength = ctypes.sizeof(_MemoryStatusEx)
        if not kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        return int(status.ullAvailPhys // (1024 * 1024))

    if hasattr(os, "sysconf"):
        try:
            page_size = os.sysconf("SC_PAGE_SIZE")
            available_pages = os.sysconf("SC_AVPHYS_PAGES")
        except (OSError, ValueError):
            return None
        return int((page_size * available_pages) // (1024 * 1024))

    return None


def _wait_for_start_capacity(settings: Settings, index: int) -> None:
    deadline = time.monotonic() + max(1.0, settings.emulator_start_capacity_wait_seconds)
    poll_interval = max(0.5, settings.emulator_start_capacity_poll_interval_seconds)

    while True:
        cpu_usage = _sample_cpu_usage_percent()
        available_memory_mb = _available_memory_mb()

        cpu_ok = cpu_usage is None or cpu_usage <= settings.emulator_start_cpu_limit_percent
        memory_ok = (
            available_memory_mb is None
            or available_memory_mb >= settings.emulator_start_min_free_memory_mb
        )
        if cpu_ok and memory_ok:
            return

        if time.monotonic() >= deadline:
            reasons: list[str] = []
            if cpu_usage is not None and not cpu_ok:
                reasons.append(
                    f"cpu usage {cpu_usage:.1f}% exceeds {settings.emulator_start_cpu_limit_percent:.1f}%"
                )
            if available_memory_mb is not None and not memory_ok:
                reasons.append(
                    f"available memory {available_memory_mb}MB below {settings.emulator_start_min_free_memory_mb}MB"
                )
            reason_text = ", ".join(reasons) or "host capacity unavailable"
            raise RuntimeError(f"Timed out waiting for start capacity: {reason_text}")

        _LOGGER.info(
            "delaying emulator start index=%s cpu=%.1f mem_mb=%s",
            index,
            cpu_usage if cpu_usage is not None else -1.0,
            available_memory_mb,
        )
        time.sleep(poll_interval)


def _start_emulator_with_capacity_guard(index: int, package: str | None, settings: Settings) -> dict[str, object]:
    worker_mumu = _make_mumu(settings)
    _ensure_index(worker_mumu, index)
    if _is_emulator_running(worker_mumu, index):
        if package:
            _select(worker_mumu, index).power.start(package)
        return {
            "index": index,
            "status": "already_running",
            "package": package,
        }

    slots = _get_start_slots(settings)
    acquired = slots.acquire(timeout=max(1.0, settings.emulator_start_capacity_wait_seconds))
    if not acquired:
        return {
            "index": index,
            "status": "failed",
            "error_message": "Timed out waiting for an emulator start slot.",
        }

    try:
        _wait_for_start_capacity(settings, index)
        _select(worker_mumu, index).power.start(package)
        return {
            "index": index,
            "status": "started",
            "package": package,
        }
    except Exception as exc:
        _LOGGER.exception("batch start failed index=%s", index)
        return {
            "index": index,
            "status": "failed",
            "package": package,
            "error_message": str(exc),
        }
    finally:
        slots.release()


def _dedupe_indices(indices: list[int]) -> list[int]:
    deduped: list[int] = []
    seen: set[int] = set()
    for index in indices:
        if index in seen:
            continue
        seen.add(index)
        deduped.append(index)
    return deduped


def _wait_for_device_online(
    mumu, device_map, index: int, timeout: int = 90,
) -> str | None:
    """Poll until the device at *index* is fully responsive.

    Steps per poll:
      1. refresh device_map to discover the (possibly new) serial/port
      2. ``adb connect`` to establish the transport
      3. ``adb get-state`` must return ``device``
      4. ``adb shell echo ok`` must succeed — this ensures the shell is
         responsive, not just that the ADB daemon is up.  Without this,
         scrcpy's ``adb shell stat`` / ``adb push`` would time out.

    Only polls the *specific* device — other devices are not affected.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(3)
        try:
            device_map.refresh(mumu)
            serial = device_map.get_serial(index)
            if not serial or ":" not in serial:
                continue

            # Establish ADB transport first — adb server doesn't know about
            # the new port until we explicitly connect.
            mumu._run_adb(["connect", serial])

            # Check state
            code, out, _err = mumu._run_adb(["-s", serial, "get-state"])
            state = out.strip() if out else ""
            if code != 0 or state != "device":
                _LOGGER.debug("Device %d waiting (serial=%s, state=%s)", index, serial, state)
                continue

            # Verify shell is actually responsive (boot may still be in
            # progress even though get-state says 'device').
            code, out, _err = mumu._run_adb(["-s", serial, "shell", "echo", "ok"])
            if code == 0 and "ok" in (out or ""):
                _LOGGER.info("Device %d online and responsive: %s", index, serial)
                return serial
            _LOGGER.debug("Device %d shell not ready yet (serial=%s)", index, serial)
        except Exception as e:
            _LOGGER.debug("Device %d poll error: %s", index, e)
    _LOGGER.warning("Device %d did not come online within %ds", index, timeout)
    return None


def _update_port_forward_after_restart(
    mumu, old_port: int | None, new_port: int | None,
) -> None:
    """Incrementally update port-forward rules after a single device restart.

    Only touches the ports relevant to this device — other devices' rules
    and connections are untouched.
    """
    if _IS_MACOS:
        return

    if old_port == new_port and old_port is not None:
        # Port didn't change — rule already exists, nothing to do.
        return

    # Check BEFORE deleting — if we delete the last rule first, the set
    # becomes empty and we'd incorrectly skip adding the new rule.
    pf_was_active = bool(_get_forwarded_ports())

    if old_port is not None:
        _delete_port_proxy_rule(old_port)
        mumu._run_adb(["disconnect", f"127.0.0.1:{old_port}"])
        _PF_LOGGER.info("Removed stale port-forward for port %d", old_port)

    if new_port is not None and pf_was_active:
        _add_port_proxy_rule(new_port)
        mumu._run_adb(["connect", f"127.0.0.1:{new_port}"])
        _ensure_iphelper_running()
        _PF_LOGGER.info("Added port-forward for new port %d", new_port)


@router.post("/emulator")
def create_emulators(
    payload: CreateEmulatorsRequest,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    created = _create_requested_emulators(mumu, payload.count)
    for index in created:
        if payload.start:
            _select(mumu, index).power.start()
            for _ in range(10):
                try:
                    if _select(mumu, index).adb.set_display():
                        break
                except RuntimeError:
                    pass
                time.sleep(1)
        else:
            _set_display_defaults(mumu, index)

    device_map.refresh(mumu)
    return {"created": created}


@router.delete("/{index}")
def delete_emulator(index: int, mumu=Depends(get_mumu), device_map=Depends(get_device_index_map)):
    _ensure_index(mumu, index)
    _select(mumu, index).core.delete()
    device_map.refresh(mumu)
    return {"deleted": index}


@router.post("/{index}/clone")
def clone_emulator(
    index: int,
    payload: CloneEmulatorsRequest,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    _ensure_index(mumu, index)
    _require_stopped_for_mumu_clone(mumu, index)
    try:
        created = _select(mumu, index).core.clone(payload.count)
    except RuntimeError as exc:
        message = str(exc).strip()
        lowered = message.lower()
        if "not handle cmd" in lowered:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"MuMu returned 'not handle cmd' for clone on emulator {index}. "
                    "On this machine, this happens when the source emulator is currently running. "
                    "Stop the source emulator and retry cloning. No clone was created."
                ),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=message or "Failed to clone emulator",
        ) from exc
    device_map.refresh(mumu)
    return {"created": created}


@router.post("/{index}/start")
def start_emulator(
    index: int,
    payload: StartEmulatorRequest,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    _ensure_index(mumu, index)
    was_running = _is_emulator_running(mumu, index)
    if not was_running or payload.package:
        _select(mumu, index).power.start(payload.package)
    if not was_running:
        # Apply display settings (resolution, rotation, DPI) after a fresh
        # start. Without this the emulator boots with hardware defaults which
        # may produce a rotated/different-resolution framebuffer.
        for _ in range(10):
            try:
                if _select(mumu, index).adb.set_display():
                    break
            except RuntimeError:
                pass
            time.sleep(1)
    device_map.refresh(mumu)
    return {
        "started": index,
        "package": payload.package,
        "status": "already_running" if was_running else "started",
    }


@router.post("/start-batch")
def start_emulators_batch(
    payload: StartEmulatorsBatchRequest,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
    settings: Settings = Depends(get_settings),
):
    indices = _dedupe_indices(payload.indices)
    if not indices:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="indices is required",
        )

    for index in indices:
        _ensure_index(mumu, index)

    configured_parallel = max(1, settings.emulator_start_max_parallel)
    requested_parallel = payload.max_parallel or configured_parallel
    effective_parallel = max(1, min(len(indices), configured_parallel, requested_parallel))

    results_by_index: dict[int, dict[str, object]] = {}
    with ThreadPoolExecutor(max_workers=effective_parallel) as executor:
        futures = {
            executor.submit(_start_emulator_with_capacity_guard, index, payload.package, settings): index
            for index in indices
        }
        for future in as_completed(futures):
            index = futures[future]
            try:
                results_by_index[index] = future.result()
            except Exception as exc:
                _LOGGER.exception("batch start future crashed index=%s", index)
                results_by_index[index] = {
                    "index": index,
                    "status": "failed",
                    "package": payload.package,
                    "error_message": str(exc),
                }

    ordered_results = [results_by_index[index] for index in indices]
    started = [result for result in ordered_results if result.get("status") == "started"]
    already_running = [
        result for result in ordered_results if result.get("status") == "already_running"
    ]
    failed = [result for result in ordered_results if result.get("status") == "failed"]

    device_map.refresh(mumu)

    status_text = "success"
    if failed and (started or already_running):
        status_text = "partial"
    elif failed:
        status_text = "error"

    return {
        "status": status_text,
        "requested_count": len(indices),
        "started_count": len(started),
        "already_running_count": len(already_running),
        "failed_count": len(failed),
        "max_parallel": effective_parallel,
        "results": ordered_results,
    }


@router.post("/{index}/stop")
def stop_emulator(index: int, mumu=Depends(get_mumu), device_map=Depends(get_device_index_map)):
    _ensure_index(mumu, index)
    was_running = _is_emulator_running(mumu, index)
    if was_running:
        _select(mumu, index).power.stop()
    device_map.refresh(mumu)
    return {
        "stopped": index,
        "status": "stopped" if was_running else "already_stopped",
    }


def _restart_and_reconcile(mumu, device_map, index: int) -> dict:
    """Restart an emulator and reconcile port-forward rules.

    Used by the /restart endpoint only.
    """
    device_map.refresh(mumu)
    old_serial = device_map.get_serial(index)
    old_port = _get_port_from_serial(old_serial)

    # Disconnect old ADB transport (prevents stale "offline" entries)
    if old_serial:
        mumu._run_adb(["disconnect", old_serial])

    _select(mumu, index).power.restart()

    new_serial = _wait_for_device_online(mumu, device_map, index, timeout=90)
    new_port = _get_port_from_serial(new_serial)
    _update_port_forward_after_restart(mumu, old_port, new_port)

    return {"old_port": old_port, "new_port": new_port, "serial": new_serial}


def _soft_reset_and_collect(mumu, device_map, index: int) -> dict:
    """Close third-party apps and return the emulator to Home without restarting."""
    serial = _serial_from_index(mumu, device_map, index)
    _ensure_adb_connected(mumu, serial)

    closed_packages: list[str] = []
    errors: list[str] = []

    code, out, _err = mumu._run_adb(
        ["-s", serial, "shell", "pm", "list", "packages", "-3"]
    )
    if code == 0 and out:
        packages = [
            line.replace("package:", "", 1).strip()
            for line in out.splitlines()
            if line.startswith("package:")
        ]
        for pkg in packages:
            rc, _, err_msg = mumu._run_adb(
                ["-s", serial, "shell", "am", "force-stop", pkg]
            )
            if rc == 0:
                closed_packages.append(pkg)
            else:
                errors.append(f"{pkg}: {err_msg}")

    mumu._run_adb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_HOME"])

    return {
        "closed_packages": closed_packages,
        "errors": errors if errors else None,
    }


@router.post("/{index}/restart")
def restart_emulator(index: int, mumu=Depends(get_mumu), device_map=Depends(get_device_index_map)):
    _ensure_index(mumu, index)
    _require_running_emulator(mumu, index, "restarting")
    result = _restart_and_reconcile(mumu, device_map, index)
    return {"restarted": index, **result}


@router.post("/{index}/reset")
def reset_emulator(index: int, mumu=Depends(get_mumu), device_map=Depends(get_device_index_map)):
    """Soft-reset an emulator while preserving the running device and ADB port."""
    _ensure_index(mumu, index)
    _require_running_emulator(mumu, index, "resetting")
    result = _soft_reset_and_collect(mumu, device_map, index)
    return {"reset": index, **result}


@router.post("/{index}/soft-reset")
def soft_reset_emulator(
    index: int,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    """
    Lightweight reset: close all third-party apps and return to the home screen,
    **without** restarting the emulator.  This preserves the ADB port so existing
    port-forward rules and ADB connections remain valid.
    """
    _ensure_index(mumu, index)
    _require_running_emulator(mumu, index, "soft-resetting")
    result = _soft_reset_and_collect(mumu, device_map, index)
    return {"soft_reset": index, **result}


@router.get("/{index}/settings")
def get_emulator_settings(
    index: int,
    all_writable: bool = False,
    mumu=Depends(get_mumu),
):
    _ensure_index(mumu, index)
    settings = _select(mumu, index).setting.all(all_writable)
    return {"index": index, "settings": settings}


@router.get("/{index}/apps")
def list_apps(index: int, include_system: bool = False, mumu=Depends(get_mumu)):
    _ensure_index(mumu, index)
    try:
        apps = _select(mumu, index).app.get_installed(third_party_only=not include_system)
    except RuntimeError as exc:
        msg = str(exc)
        if "device" in msg.lower() and "not found" in msg.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "ADB device not connected. Ensure the emulator is started, then retry. "
                    "You can also call /emulators/devices to verify the device index. "
                    f"Underlying error: {msg}"
                ),
            ) from exc
        raise
    return {"index": index, "apps": apps}


@router.post("/{index}/apps/install")
def install_app(
    index: int,
    file: Annotated[UploadFile, File(...)],
    mumu=Depends(get_mumu),
):
    _ensure_index(mumu, index)
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="missing apk file")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".apk", ".xapk", ".apks"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unsupported file type")

    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix)
    tmp_path = Path(tmp_file.name)
    try:
        tmp_file.write(file.file.read())
        tmp_file.flush()
        tmp_file.close()
        file.file.close()

        _select(mumu, index).app.install(str(tmp_path))
    finally:
        if not tmp_file.closed:
            tmp_file.close()
        _cleanup_temp_file(tmp_path)

    return {"installed": index, "filename": file.filename}


@router.post("/{index}/apps/install-url")
def install_app_from_url(
    index: int,
    payload: DownloadAppRequest,
    mumu=Depends(get_mumu),
):
    _ensure_index(mumu, index)
    _validate_install_url(payload.url)

    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".apk")
    tmp_path = Path(tmp_file.name)
    try:
        _download_install_url(payload.url, tmp_file)
        tmp_file.flush()
        tmp_file.close()

        _select(mumu, index).app.install(str(tmp_path))
    finally:
        if not tmp_file.closed:
            tmp_file.close()
        _cleanup_temp_file(tmp_path)

    return {"installed": index, "url": payload.url}


@router.post("/{index}/apps/uninstall")
def uninstall_app(index: int, payload: PackageRequest, mumu=Depends(get_mumu)):
    _ensure_index(mumu, index)
    _select(mumu, index).app.uninstall(payload.package)
    return {"uninstalled": index, "package": payload.package}


@router.post("/{index}/apps/launch")
def launch_app(index: int, payload: PackageRequest, mumu=Depends(get_mumu)):
    _ensure_index(mumu, index)
    _select(mumu, index).app.launch(payload.package)
    return {"launched": index, "package": payload.package}


@router.post("/{index}/apps/close")
def close_app(index: int, payload: PackageRequest, mumu=Depends(get_mumu)):
    _ensure_index(mumu, index)
    _select(mumu, index).app.close(payload.package)
    return {"closed": index, "package": payload.package}


@router.post("/{index}/adb/shell")
def adb_shell(
    index: int,
    payload: AdbShellRequest,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    """
    Execute a generic ADB shell command.

    Examples:
        - {"command": "input tap 500 500"}
        - {"command": "input swipe 100 100 500 500 300"}
        - {"command": "input text hello"}
        - {"command": "input keyevent 66"}
        - {"command": "pm list packages"}
    """
    # Use shared helper functions from devices.py for consistency
    serial = _serial_from_index(mumu, device_map, index)
    _ensure_adb_connected(mumu, serial)

    # Execute the shell command via adb
    # Split command carefully to handle arguments properly
    cmd_parts = payload.command.split()
    code, out, err = mumu._run_adb(["-s", serial, "shell"] + cmd_parts)

    if code != 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=err or out or "ADB shell command failed"
        )
    return {"index": index, "command": payload.command, "output": out.strip() if out else ""}


# ==================== Port Forwarding (Windows netsh) ====================

_PF_LOGGER = logging.getLogger(__name__ + ".port_forward")

# Fixed port range for ADB
ADB_PORT_RANGE = "16384-18000"
ADB_FIREWALL_RULE_NAME = "Allow ADB Ports"
_ADB_PORT_MIN, _ADB_PORT_MAX = (int(x) for x in ADB_PORT_RANGE.split("-"))


def _ensure_iphelper_running() -> bool:
    """Ensure IP Helper (iphlpsvc) is running with Automatic startup type.

    portproxy rules are persisted in the registry by ``netsh``, but iphlpsvc
    must be running for them to actually listen on 0.0.0.0.

    When the service is already running, netsh hot-updates rules via IPC and
    no restart is needed.  We only start the service if it is stopped, to
    avoid disrupting existing remote ADB connections on other ports.
    """
    # Always set startup type to Automatic so it survives reboots.
    subprocess.run(
        ["powershell", "-Command",
         "Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue"],
        capture_output=True, text=True,
    )

    # Check current status
    check = subprocess.run(
        ["powershell", "-Command", "(Get-Service iphlpsvc).Status"],
        capture_output=True, text=True,
    )
    current_status = check.stdout.strip()

    if current_status == "Running":
        _PF_LOGGER.debug("IP Helper already running, no action needed")
        return True

    # Service is stopped (or in another non-running state) — start it.
    _PF_LOGGER.info("IP Helper is %s, starting...", current_status or "unknown")
    result = subprocess.run(
        ["powershell", "-Command", "Start-Service iphlpsvc"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        time.sleep(3)
        return True

    _PF_LOGGER.warning(
        "IP Helper start failed (rc=%d): %s",
        result.returncode, (result.stderr or result.stdout).strip(),
    )
    return False


def sync_port_forwards_on_startup(mumu, device_map) -> None:
    """
    Called during app startup.  If existing port-forward rules are detected
    (from a previous session), reconcile them with current device ADB ports.
    Also ensures IP Helper is running so portproxy rules are active.
    Port forwarding is Windows-only (netsh); skipped entirely on macOS.
    """
    if _IS_MACOS:
        return

    _ensure_firewall_rule()
    changes = _reconcile_port_forward_rules(mumu, device_map)
    if changes:
        _PF_LOGGER.info("startup: reconciled port-forward rules: %s", changes)
    else:
        _PF_LOGGER.info("startup: port-forward rules already in sync (or inactive)")

    # Always ensure IP Helper is running on startup so that any existing
    # portproxy rules are actively listening on 0.0.0.0.  This must be
    # unconditional — if iphlpsvc was stopped before startup,
    # _get_forwarded_ports() still returns rules (they're in the registry)
    # but they won't actually work without the service running.
    restarted = _ensure_iphelper_running()
    _PF_LOGGER.info(
        "startup: IP Helper ensure %s",
        "succeeded" if restarted else "FAILED",
    )


def _run_netsh(args: List[str]) -> tuple[int, str, str]:
    """Run netsh command and return (returncode, stdout, stderr)"""
    cmd = ["netsh"] + args
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.returncode, result.stdout, result.stderr


def _check_firewall_rule_exists() -> bool:
    """Check if the ADB firewall rule already exists."""
    result = subprocess.run(
        ["powershell", "-Command", f'Get-NetFirewallRule -DisplayName "{ADB_FIREWALL_RULE_NAME}" -ErrorAction SilentlyContinue'],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and ADB_FIREWALL_RULE_NAME in result.stdout


def _ensure_firewall_rule() -> dict:
    """Ensure firewall rule exists. Only creates if not present."""
    if _check_firewall_rule_exists():
        return {"firewall_rule": "exists", "action": "none"}

    result = subprocess.run(
        [
            "powershell", "-Command",
            f'New-NetFirewallRule -DisplayName "{ADB_FIREWALL_RULE_NAME}" -Direction Inbound -Protocol TCP '
            f'-LocalPort {ADB_PORT_RANGE} -Action Allow',
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return {"firewall_rule": "created", "port_range": ADB_PORT_RANGE}
    else:
        return {"firewall_rule": "failed", "error": result.stderr or result.stdout}


def _parse_serial(serial: str) -> tuple[str, int]:
    """
    Parse serial (host:port format like '74.179.80.110:16416') into (host, port).
    This matches the endpoint format used by backend/dashboard.
    """
    if ":" not in serial:
        raise ValueError(f"Invalid serial format: {serial}. Expected host:port")
    host, port_str = serial.rsplit(":", 1)
    try:
        port = int(port_str)
    except ValueError:
        raise ValueError(f"Invalid port in serial: {serial}")
    return host, port


@router.post("/port-forward")
def add_port_forward(serial: str):
    """
    Add port forwarding for a specific device using Windows netsh.

    Args:
        serial: Device endpoint in host:port format (e.g., '74.179.80.110:16416')
                This matches the endpoint format from backend/dashboard.

    Forwards 0.0.0.0:<port> → 127.0.0.1:<port> to allow remote ADB access.
    Also ensures Windows Firewall rule exists (creates if missing).
    Port forwarding is Windows-only; on macOS this is a no-op.
    """
    if _IS_MACOS:
        return {"serial": serial, "skipped": True, "reason": "port forwarding not required on macOS"}

    try:
        _, port = _parse_serial(serial)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Ensure firewall rule exists
    firewall_status = _ensure_firewall_rule()

    code, out, err = _add_port_proxy_rule(port)

    if code != 0 and "already" not in (out + err).lower():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add port forward: {err or out}"
        )

    return {
        "serial": serial,
        "port": port,
        "forwarding": f"0.0.0.0:{port} → 127.0.0.1:{port}",
        "firewall": firewall_status,
        "iphelper_running": _ensure_iphelper_running(),
    }


@router.delete("/port-forward")
def delete_port_forward(serial: str):
    """
    Remove port forwarding for a specific device.

    Args:
        serial: Device endpoint in host:port format (e.g., '74.179.80.110:16416')
    """
    if _IS_MACOS:
        return {"serial": serial, "deleted": True, "skipped": True}

    try:
        _, port = _parse_serial(serial)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    code, out, err = _delete_port_proxy_rule(port)

    if code != 0 and "not found" not in (out + err).lower():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete port forward: {err or out}"
        )

    return {"serial": serial, "port": port, "deleted": True}


def _clear_all_port_forwards() -> bool:
    """Clear all port forwarding rules."""
    code, _, _ = _run_netsh(["interface", "portproxy", "reset"])
    return code == 0


def _get_forwarded_ports() -> set[int]:
    """Return the set of listen ports currently in the portproxy table."""
    _, out, _ = _run_netsh(["interface", "portproxy", "show", "all"])
    if not out:
        return set()
    ports: set[int] = set()
    for token in out.split():
        try:
            p = int(token)
            if _ADB_PORT_MIN <= p <= _ADB_PORT_MAX:
                ports.add(p)
        except ValueError:
            pass
    # Each port appears twice (listen + connect), deduplicate via set
    return ports


def _reconcile_port_forward_rules(mumu, device_map) -> list[dict] | None:
    """
    Compare current device ADB ports with existing portproxy rules.
    If any device's port is missing a rule (or an old port has a stale rule),
    fix it.  Returns a list of changes made, or None if nothing changed.

    Runs on every status check to catch any drift regardless of how a
    restart happened.
    """
    forwarded_ports = _get_forwarded_ports()
    if not forwarded_ports:
        return None  # port-forwarding not active

    device_map.refresh(mumu)
    current_device_ports: set[int] = set()
    for index in device_map.list_connected_indices():
        port = _get_port_from_serial(device_map.get_serial(index))
        if port is not None:
            current_device_ports.add(port)

    if not current_device_ports:
        return None

    stale_ports = forwarded_ports - current_device_ports
    missing_ports = current_device_ports - forwarded_ports

    if not stale_ports and not missing_ports:
        return None  # everything in sync

    changes: list[dict] = []

    for port in stale_ports:
        _delete_port_proxy_rule(port)
        # Disconnect the stale ADB transport so it doesn't linger in
        # the ADB server's device list and confuse later connections.
        mumu._run_adb(["disconnect", f"127.0.0.1:{port}"])
        changes.append({"port": port, "action": "removed_stale"})

    for port in missing_ports:
        code, _, _ = _add_port_proxy_rule(port)
        # Pre-register the new transport in the ADB server so that
        # ScrcpyClient (which uses `adb -s <serial>`) finds it immediately.
        mumu._run_adb(["connect", f"127.0.0.1:{port}"])
        changes.append({"port": port, "action": "added", "success": code == 0})

    # netsh add/delete hot-updates iphlpsvc via IPC — no service restart needed.
    _PF_LOGGER.info("reconciled port-forward rules: %s", changes)
    return changes


def _add_port_proxy_rule(port: int) -> tuple[int, str, str]:
    """Add a v4tov4 portproxy rule: 0.0.0.0:<port> → 127.0.0.1:<port>."""
    return _run_netsh([
        "interface", "portproxy", "add", "v4tov4",
        "listenaddress=0.0.0.0",
        f"listenport={port}",
        "connectaddress=127.0.0.1",
        f"connectport={port}",
    ])


def _delete_port_proxy_rule(port: int) -> tuple[int, str, str]:
    """Delete a v4tov4 portproxy rule for the given port."""
    return _run_netsh([
        "interface", "portproxy", "delete", "v4tov4",
        "listenaddress=0.0.0.0",
        f"listenport={port}",
    ])


def _get_port_from_serial(serial: str | None) -> int | None:
    """Extract port number from a host:port serial string."""
    if not serial:
        return None
    try:
        return _parse_serial(serial)[1]
    except ValueError:
        return None


@router.post("/port-forward/all")
def add_port_forward_all(
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    """
    Ensure port forwarding rules exist for all connected emulators.
    Port forwarding is Windows-only; on macOS this is a no-op.
    """
    if _IS_MACOS:
        return {"count": 0, "skipped": True, "reason": "port forwarding not required on macOS"}

    firewall_status = _ensure_firewall_rule()

    device_map.refresh(mumu)
    current_device_ports: set[int] = set()
    for index in device_map.list_connected_indices():
        port = _get_port_from_serial(device_map.get_serial(index))
        if port is not None:
            current_device_ports.add(port)

    forwarded_ports = _get_forwarded_ports()

    # Remove stale rules (ports no longer used by any device).
    stale_ports = forwarded_ports - current_device_ports
    for port in stale_ports:
        _delete_port_proxy_rule(port)
        mumu._run_adb(["disconnect", f"127.0.0.1:{port}"])

    # Add missing rules (ports that exist but have no portproxy entry).
    missing_ports = current_device_ports - forwarded_ports
    results = []
    for port in sorted(current_device_ports):
        if port in missing_ports:
            code, out, err = _add_port_proxy_rule(port)
            success = code == 0 or "already" in (out + err).lower()
            mumu._run_adb(["connect", f"127.0.0.1:{port}"])
            results.append({"port": port, "action": "added", "success": success})
        else:
            results.append({"port": port, "action": "already_exists"})

    iphelper_ok = _ensure_iphelper_running()

    _, status_out, _ = _run_netsh(["interface", "portproxy", "show", "all"])

    return {
        "count": len(results),
        "ports": sorted(current_device_ports),
        "firewall": firewall_status,
        "iphelper_running": iphelper_ok,
        "removed_stale": sorted(stale_ports),
        "results": results,
        "rules": status_out.strip() if status_out else "No rules configured",
    }


@router.delete("/port-forward/all")
def delete_port_forward_all():
    """
    Remove ALL port forwarding rules (clears everything).
    """
    if _IS_MACOS:
        return {"cleared": True, "skipped": True}

    success = _clear_all_port_forwards()
    return {"cleared": success}


@router.get("/port-forward/status")
def get_port_forward_status(
    response: Response,
    mumu=Depends(get_mumu),
    device_map=Depends(get_device_index_map),
):
    """
    Show current port forwarding rules.
    """
    response.headers["Cache-Control"] = "no-store"

    if _IS_MACOS:
        return {"rules": "Port forwarding not applicable on macOS", "skipped": True}

    # Auto-reconcile: compare current device ports against existing rules.
    reconciled = _reconcile_port_forward_rules(mumu, device_map)

    # Read rules AFTER reconcile.  netsh add/delete hot-updates the running
    # iphlpsvc via IPC — no service restart needed.  This avoids disrupting
    # existing remote ADB connections on other ports.
    code, out, err = _run_netsh(["interface", "portproxy", "show", "all"])
    result: dict = {"rules": out.strip() if out else "No rules configured"}
    if reconciled:
        result["reconciled"] = reconciled
    return result
