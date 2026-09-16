from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_MUMU_DEFAULT_WIN = r"C:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe"
_EMULATOR_ROOT = Path(__file__).resolve().parents[1]
_SANDBOX_SERVICE_TOKEN_ENV = "SICO_SANDBOX_SERVICE_TOKEN"


def _settings_env_files(emulator_root: Path) -> tuple[str, ...]:
    repository_root = emulator_root.parent.parent
    env_files: list[str] = []
    if (
        (repository_root / "backend" / "go.mod").is_file()
        and (repository_root / "scripts" / "load-env.sh").is_file()
        and (repository_root / "sandbox" / "emulator").resolve() == emulator_root.resolve()
    ):
        env_files.append(str(repository_root / ".env"))
    env_files.append(str(emulator_root / ".env"))
    return tuple(env_files)


def _sandbox_service_token_from_env_file(env_file: str) -> str:
    path = Path(env_file)
    if not path.is_file():
        return ""

    token = ""
    prefix = f"{_SANDBOX_SERVICE_TOKEN_ENV}="
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(prefix):
            token = line[len(prefix) :]
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
        token = token[1:-1]
    return token


def _validate_sandbox_service_token_env_files(env_files: tuple[str, ...]) -> None:
    tokens = {
        token
        for env_file in env_files
        if (token := _sandbox_service_token_from_env_file(env_file))
    }
    if len(tokens) > 1:
        raise RuntimeError(
            "SICO_SANDBOX_SERVICE_TOKEN differs between repository-root and emulator .env files"
        )


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
        env_file=_settings_env_files(_EMULATOR_ROOT),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
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
    cors_origins: str = ""
    sico_sandbox_service_token: str = Field(
        default="",
        validation_alias="SICO_SANDBOX_SERVICE_TOKEN",
    )
    emulator_windows_index_probe_limit: int = 256
    emulator_h264_restore_input_focus_on_start: bool = True
    emulator_start_max_parallel: int = 2
    emulator_start_cpu_limit_percent: float = 85.0
    emulator_start_min_free_memory_mb: int = 2048
    emulator_start_capacity_wait_seconds: float = 180.0
    emulator_start_capacity_poll_interval_seconds: float = 3.0


@lru_cache
def get_settings() -> Settings:
    env_files = _settings_env_files(_EMULATOR_ROOT)
    _validate_sandbox_service_token_env_files(env_files)
    return Settings(_env_file=env_files)
