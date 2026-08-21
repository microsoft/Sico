"""Runnable workflow examples for Sico.

When examples are launched via ``python -m examples...`` from the repository,
this package auto-loads the repo-root ``.env`` file without overriding already
exported environment variables. That keeps the examples dependency-free while
still matching the local Docker Compose workflow.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_repo_dotenv() -> None:
    dotenv_path = Path(__file__).resolve().parent.parent / ".env"
    if not dotenv_path.is_file():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ[key] = value


_load_repo_dotenv()
