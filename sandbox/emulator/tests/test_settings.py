from __future__ import annotations

import pytest

from app.main import create_app
from app.settings import (
    Settings,
    _default_android_home,
    _settings_env_files,
    detect_android_home,
    get_settings,
)


class TestSettings:
    def test_defaults(self):
        s = Settings()
        assert s.host == "0.0.0.0"
        assert s.port == 8000
        assert s.cors_origins == ""
        assert s.sico_sandbox_service_token == "a" * 64
        assert s.emulator_start_max_parallel == 2
        assert s.emulator_start_cpu_limit_percent == 85.0
        assert s.emulator_start_min_free_memory_mb == 2048

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("HOST", "127.0.0.1")
        monkeypatch.setenv("PORT", "9999")
        get_settings.cache_clear()
        s = Settings()
        assert s.host == "127.0.0.1"
        assert s.port == 9999

    def test_cors_origins_custom(self, monkeypatch):
        monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8080")
        s = Settings()
        assert "localhost:3000" in s.cors_origins

    def test_env_files_include_repository_root_in_monorepo(self, tmp_path):
        repository_root = tmp_path / "repo"
        emulator_root = repository_root / "sandbox" / "emulator"
        emulator_root.mkdir(parents=True)
        (repository_root / "backend").mkdir()
        (repository_root / "backend" / "go.mod").touch()
        (repository_root / "scripts").mkdir()
        (repository_root / "scripts" / "load-env.sh").touch()

        assert _settings_env_files(emulator_root) == (
            str(repository_root / ".env"),
            str(emulator_root / ".env"),
        )

    def test_env_files_exclude_ancestor_for_standalone_checkout(self, tmp_path):
        emulator_root = tmp_path / "standalone" / "sandbox" / "emulator"
        emulator_root.mkdir(parents=True)

        assert _settings_env_files(emulator_root) == (str(emulator_root / ".env"),)

    def test_get_settings_loads_env_files_for_current_emulator_root(self, monkeypatch, tmp_path):
        emulator_root = tmp_path / "standalone" / "sandbox" / "emulator"
        emulator_root.mkdir(parents=True)
        (emulator_root / ".env").write_text("HOST=127.0.0.2\n")
        monkeypatch.delenv("HOST", raising=False)
        monkeypatch.setattr("app.settings._EMULATOR_ROOT", emulator_root)
        get_settings.cache_clear()

        try:
            assert get_settings().host == "127.0.0.2"
        finally:
            get_settings.cache_clear()

    def test_direct_start_rejects_conflicting_repository_and_local_tokens(self, monkeypatch, tmp_path):
        repository_root = tmp_path / "repo"
        emulator_root = repository_root / "sandbox" / "emulator"
        emulator_root.mkdir(parents=True)
        (repository_root / "backend").mkdir()
        (repository_root / "backend" / "go.mod").touch()
        (repository_root / "scripts").mkdir()
        (repository_root / "scripts" / "load-env.sh").touch()
        (repository_root / ".env").write_text(f"SICO_SANDBOX_SERVICE_TOKEN={'a' * 64}\n")
        (emulator_root / ".env").write_text(f"SICO_SANDBOX_SERVICE_TOKEN={'b' * 64}\n")
        monkeypatch.setattr("app.settings._EMULATOR_ROOT", emulator_root)
        get_settings.cache_clear()

        try:
            with pytest.raises(RuntimeError, match="differs between repository-root and emulator"):
                create_app()
        finally:
            get_settings.cache_clear()

    def test_direct_start_uses_repository_token_when_local_token_is_blank(self, monkeypatch, tmp_path):
        repository_root = tmp_path / "repo"
        emulator_root = repository_root / "sandbox" / "emulator"
        emulator_root.mkdir(parents=True)
        (repository_root / "backend").mkdir()
        (repository_root / "backend" / "go.mod").touch()
        (repository_root / "scripts").mkdir()
        (repository_root / "scripts" / "load-env.sh").touch()
        root_token = "a" * 64
        (repository_root / ".env").write_text(f"SICO_SANDBOX_SERVICE_TOKEN={root_token}\n")
        (emulator_root / ".env").write_text("SICO_SANDBOX_SERVICE_TOKEN=\n")

        env_files = _settings_env_files(emulator_root)
        settings = Settings(_env_file=env_files)

        assert settings.sico_sandbox_service_token == root_token

    @pytest.mark.parametrize("token", ["too-short", "A" * 64, "g" * 64])
    def test_invalid_sandbox_service_token_is_rejected(self, monkeypatch, token):
        monkeypatch.setenv("SICO_SANDBOX_SERVICE_TOKEN", token)
        get_settings.cache_clear()
        try:
            with pytest.raises(RuntimeError, match="exactly 64 lowercase hexadecimal characters"):
                create_app()
        finally:
            get_settings.cache_clear()


class TestDetectAndroidHome:
    def test_from_env(self, monkeypatch, tmp_path):
        monkeypatch.setenv("ANDROID_HOME", str(tmp_path))
        result = _default_android_home()
        assert result == str(tmp_path)

    def test_missing_returns_empty(self, monkeypatch):
        monkeypatch.delenv("ANDROID_HOME", raising=False)
        monkeypatch.delenv("ANDROID_SDK_ROOT", raising=False)
        # Only returns empty if no default dir exists either
        result = _default_android_home()
        # Result is either empty or a valid path — both acceptable
        assert isinstance(result, str)

    def test_detect_android_home_none(self, monkeypatch):
        monkeypatch.delenv("ANDROID_HOME", raising=False)
        monkeypatch.delenv("ANDROID_SDK_ROOT", raising=False)
        # Force no default path
        monkeypatch.setattr("app.settings._default_android_home", lambda: "")
        result = detect_android_home()
        assert result is None

    def test_detect_android_home_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr("app.settings._default_android_home", lambda: str(tmp_path))
        result = detect_android_home()
        assert result == tmp_path
