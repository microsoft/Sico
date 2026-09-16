from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest


TOKEN = "a" * 64
EMULATOR_ROOT = Path(__file__).resolve().parents[1]
TOKEN_ENV_SCRIPT = EMULATOR_ROOT / "setup" / "token-env.sh"


@pytest.mark.parametrize(
    ("value", "accepted"),
    [
        (TOKEN, True),
        (f'"{TOKEN}"', True),
        (f"'{TOKEN}'", True),
        (f'"{TOKEN}', False),
        (f"'{TOKEN}", False),
        ('"' + TOKEN + "'", False),
    ],
)
def test_token_env_quote_validation(tmp_path: Path, value: str, accepted: bool):
    env_file = tmp_path / ".env"
    env_file.write_text(f"SICO_SANDBOX_SERVICE_TOKEN={value}\n")

    result = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; token="$(read_sandbox_service_token "$2")"; '
            'validate_sandbox_service_token "$token" test',
            "bash",
            str(TOKEN_ENV_SCRIPT),
            str(env_file),
        ],
        capture_output=True,
        check=False,
        text=True,
    )

    assert (result.returncode == 0) is accepted


def test_standalone_setup_ignores_unrelated_ancestor_env(tmp_path: Path):
    standalone_root = tmp_path / "standalone"
    emulator_root = standalone_root / "sandbox" / "emulator"
    setup_dir = emulator_root / "setup"
    setup_dir.mkdir(parents=True)
    shutil.copy2(EMULATOR_ROOT / ".env.example", emulator_root / ".env.example")
    shutil.copy2(EMULATOR_ROOT / "setup" / "setup.sh", setup_dir / "setup.sh")
    shutil.copy2(TOKEN_ENV_SCRIPT, setup_dir / "token-env.sh")

    ancestor_env = standalone_root / ".env"
    original_ancestor = "UNRELATED=keep\nSICO_SANDBOX_SERVICE_TOKEN=\n"
    ancestor_env.write_text(original_ancestor)
    environment = os.environ.copy()
    environment.pop("SICO_SANDBOX_SERVICE_TOKEN", None)
    environment.pop("ANDROID_SDK_ROOT", None)
    environment["HOME"] = str(tmp_path / "home")
    environment["ANDROID_HOME"] = str(tmp_path / "missing-sdk")

    result = subprocess.run(
        ["bash", str(setup_dir / "setup.sh"), "start"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert ancestor_env.read_text() == original_ancestor
    local_env = (emulator_root / ".env").read_text()
    token_match = re.search(
        r"^SICO_SANDBOX_SERVICE_TOKEN=([0-9a-f]{64})$",
        local_env,
        re.MULTILINE,
    )
    assert token_match is not None
    assert "environment file not found" not in result.stdout + result.stderr
