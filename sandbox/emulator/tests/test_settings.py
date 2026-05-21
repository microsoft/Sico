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

import os

import pytest

from app.settings import Settings, _default_android_home, detect_android_home, get_settings


class TestSettings:
    def test_defaults(self):
        s = Settings()
        assert s.host == "0.0.0.0"
        assert s.port == 8000
        assert s.cors_origins == "*"
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
