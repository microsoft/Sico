from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_MUMU_DEFAULT_WIN = r"C:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe"
_EMULATOR_ROOT = Path(__file__).resolve().parents[1]


def _default_android_home() -> str:
    """Detect ANDROID_HOME from env or common platform-specific location."""
    for var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        val = os.environ.get(var, "")
        if val and Path(val).is_dir():
            return val
    if sys.platform == "darwin":
        default = Path.home() / "Library" / "Android" / "sdk"
        if default.is_dir():
            return str(default)
    return ""


def detect_android_home() -> Path | None:
    """Return the detected ANDROID_HOME as a Path, or None."""
    result = _default_android_home()
    return Path(result) if result else None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_EMULATOR_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mumu_manager_path: str = _MUMU_DEFAULT_WIN
    android_home: str = _default_android_home()
    avd_name_prefix: str = "device"
    avd_base_port: int = 5554
    avd_headless: bool = False
    host: str = "0.0.0.0"  # Use 127.0.0.1 to restrict to local access
    port: int = 8000
    api_prefix: str = "/api/v1"
    cors_origins: str = "*"  # Comma-separated origins, or "*" for all
    emulator_windows_index_probe_limit: int = 256
    emulator_h264_restore_input_focus_on_start: bool = True
    emulator_start_max_parallel: int = 2
    emulator_start_cpu_limit_percent: float = 85.0
    emulator_start_min_free_memory_mb: int = 2048
    emulator_start_capacity_wait_seconds: float = 180.0
    emulator_start_capacity_poll_interval_seconds: float = 3.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
