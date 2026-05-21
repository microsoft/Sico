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

from threading import RLock
from typing import Annotated, Dict, Optional

from fastapi import Depends, HTTPException, status

from app.settings import Settings, get_settings
from app.adapter import MuMuClient


class DeviceIndexMap:
    def __init__(self) -> None:
        self._lock = RLock()
        self._loaded = False
        self._index_to_serial: Dict[int, Optional[str]] = {}

    def refresh(self, mumu: MuMuClient) -> None:
        info = mumu.all().adb.get_connect_info()
        new_map: Dict[int, Optional[str]] = {}

        if isinstance(info, dict):
            for key, value in info.items():
                try:
                    index = int(key)
                except (TypeError, ValueError):
                    continue
                host, port = value
                if host is not None and port is not None:
                    new_map[index] = f"{host}:{port}"
                else:
                    new_map[index] = None
        elif isinstance(info, tuple):
            host, port = info
            if host is not None and port is not None:
                # Single-device mode (MuMu): assume index 1 if only a bare tuple is returned.
                # AVD always returns a dict for multi-device; (None, None) means no devices.
                new_map[1] = f"{host}:{port}"

        with self._lock:
            self._index_to_serial = new_map
            self._loaded = True

    def ensure_loaded(self, mumu: MuMuClient) -> None:
        with self._lock:
            loaded = self._loaded
        if not loaded:
            self.refresh(mumu)

    def has_index(self, index: int) -> bool:
        with self._lock:
            return index in self._index_to_serial

    def get_serial(self, index: int) -> Optional[str]:
        with self._lock:
            return self._index_to_serial.get(index)

    def list_connected_indices(self) -> list[int]:
        with self._lock:
            return sorted([i for i, serial in self._index_to_serial.items() if serial])


_DEVICE_INDEX_MAP = DeviceIndexMap()


def _make_mumu(settings: Settings) -> MuMuClient:
    return MuMuClient(
        settings.mumu_manager_path,
        android_home=settings.android_home,
        avd_headless=settings.avd_headless,
        avd_name_prefix=settings.avd_name_prefix,
        avd_base_port=settings.avd_base_port,
    )


def init_device_index_map(settings: Settings, mumu: MuMuClient | None = None) -> None:
    mumu = mumu or _make_mumu(settings)
    _DEVICE_INDEX_MAP.refresh(mumu)


def get_device_index_map() -> DeviceIndexMap:
    return _DEVICE_INDEX_MAP


def get_mumu(settings: Annotated[Settings, Depends(get_settings)]) -> MuMuClient:
    try:
        return _make_mumu(settings)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
