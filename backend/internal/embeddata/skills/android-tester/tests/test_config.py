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

import pytest

from android_tester.config import (
    _parse_image_size,
    _parse_log_level,
    _parse_package_set,
    _parse_string_to_bool,
    load_config,
)

# All env vars consulted by config.py. Cleared before each test so values
# from the developer's shell can't leak into assertions.
_CONFIG_ENV_VARS = (
    "SICO_ENDPOINT",
    "SICO_AGENT_INSTANCE_ID",
    "SICO_APP_NAME",
    "SICO_RESULT_DIR",
    "DEVICE_ID",
    "DEVICE_NAME",
    "INSTRUCTIONS",
    "TASK_ID",
    "TASK_NAME",
    "LLMHUB_MODEL",
    "COORDINATE_SPACE",
    "MAX_SCREENSHOT_SIZE",
    "LOG_LEVEL",
    "TELEMETRY_ENABLED",
    "REFLECTOR_ENABLED",
    "LOG_LLM_INPUTS",
    "MAX_NO_PROGRESS_STEPS",
    "MAX_REPETITIVE_ACTIONS",
    "N_RETRIES_IF_FAILED",
    "HISTORY_LENGTH",
    "KEEP_APP_STATE",
)


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _CONFIG_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


_MIN_ARGV = ["--device-id", "device-1", "--instructions", "Open Edge"]


def _argv_with(*extra: str) -> list[str]:
    return [*_MIN_ARGV, *extra]


# ---------------------------------------------------------------------------
# Platform connection fields (env-only)
# ---------------------------------------------------------------------------

def test_platform_fields_are_env_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SICO_ENDPOINT", "http://backend:8080")
    monkeypatch.setenv("SICO_AGENT_INSTANCE_ID", "42")

    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.sico_endpoint == "http://backend:8080"
    assert cfg.sico_agent_instance_id == 42


def test_platform_fields_are_not_cli_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SICO_ENDPOINT", "http://backend:8080")
    monkeypatch.setenv("SICO_AGENT_INSTANCE_ID", "42")

    with pytest.raises(SystemExit):
        load_config(
            argv=_argv_with("--sico-endpoint", "http://override:8080"),
        )


def test_platform_fields_default_to_none_when_env_missing() -> None:
    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.sico_endpoint == "http://host.docker.internal:8080"
    assert cfg.sico_agent_instance_id is None


# ---------------------------------------------------------------------------
# Precedence: CLI > env > built-in default
# ---------------------------------------------------------------------------

def test_cli_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLMHUB_MODEL", "from-env")
    monkeypatch.setenv("MAX_NO_PROGRESS_STEPS", "99")

    cfg = load_config(
        argv=_argv_with(
            "--llmhub-model", "from-cli",
            "--max-no-progress-steps", "3",
        ),
    )

    assert cfg.llmhub_model == "from-cli"
    assert cfg.max_no_progress_steps == 3


def test_env_overrides_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLMHUB_MODEL", "from-env")
    monkeypatch.setenv("MAX_NO_PROGRESS_STEPS", "7")

    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.llmhub_model == "from-env"
    assert cfg.max_no_progress_steps == 7


def test_built_in_defaults() -> None:
    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.llmhub_model == "gpt5.4"
    assert cfg.max_no_progress_steps == 6
    assert cfg.max_repetitive_actions == 5
    assert cfg.n_retries_if_failed == 0
    assert cfg.log_level == "WARNING"
    assert cfg.sico_app_name == "sico"
    assert cfg.max_screenshot_size == (768, 1365)
    assert cfg.telemetry is True
    assert cfg.reflector is False
    assert cfg.log_llm_inputs is False
    assert cfg.coordinate_space is None
    assert cfg.history_length == 0
    assert cfg.keep_app_state == frozenset()


# ---------------------------------------------------------------------------
# _env() semantics: empty value explicitly unsets the option
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("blank", ["", "   ", "\t"])
def test_empty_env_string_unsets_option(
    monkeypatch: pytest.MonkeyPatch, blank: str,
) -> None:
    monkeypatch.setenv("LLMHUB_MODEL", blank)

    cfg = load_config(argv=_MIN_ARGV)

    # Empty env → None (per _env contract), not the built-in default
    assert cfg.llmhub_model is None


# ---------------------------------------------------------------------------
# Required arguments
# ---------------------------------------------------------------------------

def test_missing_device_id_and_instructions_raises() -> None:
    with pytest.raises(SystemExit):
        load_config(argv=[])


def test_env_can_satisfy_required_args(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DEVICE_ID", "device-from-env")
    monkeypatch.setenv("INSTRUCTIONS", "Open Edge from env")

    cfg = load_config(argv=[])

    assert cfg.device_id == "device-from-env"
    assert cfg.instructions == "Open Edge from env"


# ---------------------------------------------------------------------------
# BooleanOptionalAction (--no-X)
# ---------------------------------------------------------------------------

def test_no_telemetry_flag_overrides_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TELEMETRY_ENABLED", "true")

    cfg = load_config(argv=_argv_with("--no-telemetry"))

    assert cfg.telemetry is False


def test_reflector_flag_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REFLECTOR_ENABLED", "false")

    cfg = load_config(argv=_argv_with("--reflector"))

    assert cfg.reflector is True


@pytest.mark.parametrize("raw", ["true", "1", "yes", "on", "TRUE", " on "])
def test_truthy_env_strings(
    monkeypatch: pytest.MonkeyPatch, raw: str,
) -> None:
    monkeypatch.setenv("REFLECTOR_ENABLED", raw)
    cfg = load_config(argv=_MIN_ARGV)
    assert cfg.reflector is True


@pytest.mark.parametrize("raw", ["false", "0", "no", "off", "FALSE"])
def test_falsy_env_strings(
    monkeypatch: pytest.MonkeyPatch, raw: str,
) -> None:
    monkeypatch.setenv("TELEMETRY_ENABLED", raw)
    cfg = load_config(argv=_MIN_ARGV)
    assert cfg.telemetry is False


def test_invalid_bool_env_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEMETRY_ENABLED", "maybe")
    # NOTE: env-var converters run while building the parser's defaults,
    # not during arg parsing, so this surfaces as ArgumentTypeError rather
    # than a clean SystemExit. See _add_common_args / _env().
    import argparse
    with pytest.raises(argparse.ArgumentTypeError):
        load_config(argv=_MIN_ARGV)


# ---------------------------------------------------------------------------
# Integer / image-size / package-set env conversion
# ---------------------------------------------------------------------------

def test_int_env_is_converted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HISTORY_LENGTH", "4")
    monkeypatch.setenv("MAX_REPETITIVE_ACTIONS", "12")

    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.history_length == 4
    assert cfg.max_repetitive_actions == 12


def test_image_size_env_is_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COORDINATE_SPACE", "1024x768")

    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.coordinate_space == (1024, 768)


def test_keep_app_state_env_splits_and_validates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "KEEP_APP_STATE",
        "com.android.chrome,, com.microsoft.emmx ",
    )

    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.keep_app_state == frozenset(
        {"com.android.chrome", "com.microsoft.emmx"},
    )


# ---------------------------------------------------------------------------
# Hardcoded extras land on the namespace
# ---------------------------------------------------------------------------

def test_extra_config_values_present() -> None:
    cfg = load_config(argv=_MIN_ARGV)

    assert cfg.adb_command_timeout == 30
    assert cfg.execution_timeout == 3600
    assert cfg.llm_timeout == 300
    assert cfg.upload_timeout == 60
    assert cfg.sleep_between_steps == 2.0
    assert cfg.first_step_sleep == 6.0
    assert cfg.max_steps == 60


# ---------------------------------------------------------------------------
# Parser helpers (unit-level)
# ---------------------------------------------------------------------------

class TestParseImageSize:
    def test_happy(self) -> None:
        assert _parse_image_size("512x384") == (512, 384)
        assert _parse_image_size("1024X768") == (1024, 768)

    def test_empty_returns_none(self) -> None:
        assert _parse_image_size("") is None
        assert _parse_image_size(None) is None

    @pytest.mark.parametrize("bad", ["512", "512x", "axb", "512x768x100"])
    def test_invalid_raises(self, bad: str) -> None:
        with pytest.raises(Exception):
            _parse_image_size(bad)


class TestParseLogLevel:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("debug", "DEBUG"),
            ("INFO", "INFO"),
            (" warning ", "WARNING"),
        ],
    )
    def test_happy(self, raw: str, expected: str) -> None:
        assert _parse_log_level(raw) == expected

    def test_invalid_raises(self) -> None:
        with pytest.raises(Exception):
            _parse_log_level("verbose")


class TestParseStringToBool:
    @pytest.mark.parametrize("raw", ["true", "1", "yes", "on", "TRUE"])
    def test_truthy(self, raw: str) -> None:
        assert _parse_string_to_bool(raw) is True

    @pytest.mark.parametrize("raw", ["false", "0", "no", "off", "FALSE"])
    def test_falsy(self, raw: str) -> None:
        assert _parse_string_to_bool(raw) is False

    def test_invalid_raises(self) -> None:
        with pytest.raises(Exception):
            _parse_string_to_bool("maybe")


class TestParsePackageSet:
    def test_empty(self) -> None:
        assert _parse_package_set("") == frozenset()
        assert _parse_package_set(None) == frozenset()

    def test_dedups_and_strips(self) -> None:
        assert _parse_package_set(
            "com.a.b, com.a.b , com.c.d",
        ) == frozenset({"com.a.b", "com.c.d"})

    def test_invalid_package_raises(self) -> None:
        with pytest.raises(Exception):
            _parse_package_set("not a package")
