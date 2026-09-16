"""Device discovery used by the Backend Emulator provider."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/vnc", tags=["VNC"])


@router.get("/devices")
def list_devices():
    """List connected devices and their direct ADB addresses."""
    from app.deps import get_device_index_map, get_mumu
    from app.settings import get_settings

    settings = get_settings()
    mumu = get_mumu(settings)
    device_map = get_device_index_map()

    device_map.refresh(mumu)
    devices = []

    for index in device_map.list_connected_indices():
        serial = device_map.get_serial(index)
        adb_host = "127.0.0.1"
        adb_port = 16384 + index

        if serial and ":" in serial:
            host, port = serial.rsplit(":", 1)
            adb_host = host
            try:
                adb_port = int(port)
            except ValueError:
                pass

        devices.append({
            "device_index": index,
            "adb_host": adb_host,
            "adb_port": adb_port,
        })

    return {"devices": devices}
