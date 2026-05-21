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

"""Layered configuration: config.env → environment → CLI arguments.

Priority (highest wins):  CLI arg  >  env var  >  config.env  >  default.

``load_dotenv`` only sets env vars that are not already present, so real
environment variables win over ``config.env`` values.  ``argparse``
defaults read from ``os.getenv``, so CLI args win over everything.

We use ``config.env`` instead of the conventional ``.env`` because
LLM safety filters may flag ``.env`` files as sensitive information
and block processing requests that include their content.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Hard code these values here to avoid the LLM modifying them
_EXTRA_CONFIG = dict(
    adb_command_timeout=30,
    execution_timeout=3600,
    llm_timeout=300,
    upload_timeout=60,
    sleep_between_steps=2.0,
    first_step_sleep=6.0,
    max_steps=60,
)


def _env(
    name: str,
    default: Any = None,
    convert: Callable[[str], Any] | None = None,
) -> Any:
    """Read an env var, optionally converting its string value.

    - If the variable is not set, return *default*.
    - If the variable is set but empty (or whitespace-only), return ``None``
      (an explicit "unset this option" signal).
    - Otherwise, return the (optionally converted) value.
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    if raw.strip() == "":
        return None
    return convert(raw) if convert else raw


def _parse_image_size(value: str | None) -> tuple[int, int] | None:
    """
    Parse an image size string like '512x512' into a (width, height) tuple.
    """
    if not value:
        return None

    try:
        width_str, height_str = value.lower().split("x")
        return int(width_str), int(height_str)
    except ValueError as e:
        raise argparse.ArgumentTypeError(
            f"Invalid image size {value!r}. Expected format is "
            f"[WIDTH]x[HEIGHT], e.g. 512x512."
        ) from e


def _parse_log_level(value: str) -> str:
    """Normalize and validate logging level names."""
    level = value.strip().upper()
    allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    if level not in allowed:
        raise argparse.ArgumentTypeError(
            f"Invalid log level {value!r}. Expected one of: "
            f"{', '.join(sorted(allowed))}."
        )
    return level


def _parse_string_to_bool(value: str) -> bool:
    """Convert common string representations of boolean values to bool."""
    true_values = {"true", "1", "yes", "on"}
    false_values = {"false", "0", "no", "off"}
    value_lower = value.strip().lower()
    if value_lower in true_values:
        return True
    if value_lower in false_values:
        return False
    raise argparse.ArgumentTypeError(
        f"Invalid boolean value {value!r}. Expected one of: "
        f"{', '.join(sorted(true_values | false_values))}."
    )


def _add_common_args(p: argparse.ArgumentParser) -> None:
    """Args shared between the ``run`` and ``batch`` subcommands."""
    # -- LLM --
    p.add_argument(
        "--llmhub-model",
        default=_env("LLMHUB_MODEL", "gpt5.4"),
        help="LLM model identifier (default: %(default)s)",
    )
    p.add_argument(
        "--llmhub-model-image-size",
        type=_parse_image_size,
        default=_env("LLMHUB_MODEL_IMAGE_SIZE", None, _parse_image_size),
        help="LLM model image size (default: %(default)s)",
    )
    p.add_argument(
        "--model-auto-resize-width",
        type=int,
        default=_env("MODEL_AUTO_RESIZE_WIDTH", 768, int),
        help=(
            "target width (in pixels) for downscaling screenshots before "
            "sending them to the LLM, preserving aspect ratio. Screenshots "
            "narrower than this value are sent unchanged. Required for some "
            "models (e.g. GPT-5) to effectively operate device GUIs; a "
            "typical value is 768. Set to 0 to disable auto-resize. Only "
            "takes effect when --llmhub-model-image-size is unset "
            "(default: %(default)s)"
        ),
    )

    # -- logging and telemetry --
    p.add_argument(
        "--log-level",
        type=_parse_log_level,
        default=_env("LOG_LEVEL", "WARNING", _parse_log_level),
        help="logging level (default: %(default)s)",
    )
    p.add_argument(
        "--telemetry",
        action=argparse.BooleanOptionalAction,
        default=_env("TELEMETRY_ENABLED", True, _parse_string_to_bool),
        help="enable telemetry collection (default: %(default)s)",
    )

    # -- output --
    p.add_argument(
        "-o", "--output-dir",
        default=_env("SICO_RESULT_DIR"),
        metavar="DIR",
        help=(
            "directory for output files (screenshots, logs, report). "
            "For 'run', defaults to ./output/<task-id>. "
            "For 'batch', defaults to ./output and each task gets a "
            "<task-id> subdirectory."
        ),
    )

    # -- platform --
    p.add_argument(
        "--sico-endpoint",
        default=_env("SICO_ENDPOINT", "http://host.docker.internal:8080"),
        help="Sico platform base URL",
    )
    p.add_argument(
        "--sico-app-name",
        default=_env("SICO_APP_NAME", "sico"),
        help=(
            "Sico application name used to construct API paths "
            "(/api/<sico-app-name>/...) (default: %(default)s)"
        ),
    )
    p.add_argument(
        "--sico-agent-instance-id",
        default=_env("SICO_AGENT_INSTANCE_ID", convert=int),
        type=int,
        help=(
            "agent instance ID sent to the platform "
            "via X-Sico-Context header"
        ),
    )

    # -- runner tuning --
    p.add_argument(
        "--reflector",
        action=argparse.BooleanOptionalAction,
        default=_env("REFLECTOR_ENABLED", False, _parse_string_to_bool),
        help="enable reflector step after each action (default: %(default)s)",
    )
    p.add_argument(
        "--max-no-progress-steps",
        type=int,
        default=_env("MAX_NO_PROGRESS_STEPS", 6, int),
        help=(
            "stop after this many steps without "
            "progress (default: %(default)s)"
        ),
    )
    p.add_argument(
        "--max-repetitive-actions",
        type=int,
        default=_env("MAX_REPETITIVE_ACTIONS", 5, int),
        help=(
            "stop after this many identical consecutive "
            "actions (default: %(default)s)"
        ),
    )
    p.add_argument(
        "--n-retries-if-failed",
        type=int,
        default=_env("N_RETRIES_IF_FAILED", 0, int),
        help=(
            "if the task does not complete successfully, re-run the whole "
            "pipeline up to this many additional times (default: %(default)s)"
        ),
    )
    p.add_argument(
        "--log-llm-inputs",
        action=argparse.BooleanOptionalAction,
        default=_env("LOG_LLM_INPUTS", False, _parse_string_to_bool),
        help=(
            "log LLM prompts in operator/reflector records "
            "(default: %(default)s)"
        ),
    )
    p.add_argument(
        "--history-length",
        type=int,
        default=_env("HISTORY_LENGTH", 0, int),
        help=(
            "number of previous operator turns (prompt + screenshot + "
            "response) to include as multi-turn history "
            "(default: %(default)s)"
        ),
    )


def _add_run_args(p: argparse.ArgumentParser) -> None:
    """Args specific to the ``run`` subcommand (single instruction)."""
    p.add_argument(
        "--task-id",
        default=_env("TASK_ID"),
        help="unique task identifier (auto-generated UUID if omitted)",
    )
    p.add_argument(
        "--task-name",
        default=_env("TASK_NAME"),
        help="human-readable label for the test run",
    )
    p.add_argument(
        "--device-id",
        default=_env("DEVICE_ID"),
        required="DEVICE_ID" not in os.environ,
        help="ADB device serial or host:port (e.g. 10.0.0.5:5555)",
    )
    p.add_argument(
        "--device-name",
        default=_env("DEVICE_NAME"),
        help="friendly device name used in logs (defaults to device-id)",
    )
    p.add_argument(
        "--instructions",
        default=_env("INSTRUCTIONS"),
        required="INSTRUCTIONS" not in os.environ,
        help="natural-language test instruction to execute",
    )


def _add_batch_args(p: argparse.ArgumentParser) -> None:
    """Args specific to the ``batch`` subcommand (cases × devices)."""
    p.add_argument(
        "--file",
        type=Path,
        default=None,
        metavar="FILE",
        help=(
            "JSON file with shape {\"test-cases\": [...]}. Each case "
            "requires 'instruction' and may include 'task-id' and "
            "'task-name'. Use '-' to read JSON from stdin. Mutually "
            "exclusive with --test-cases."
        ),
    )
    p.add_argument(
        "--test-cases",
        default=None,
        metavar="JSON",
        help=(
            "inline JSON object, same shape as --file. Mutually "
            "exclusive with --file."
        ),
    )
    p.add_argument(
        "--devices",
        nargs="+",
        required=True,
        metavar="DEVICE",
        help=(
            "ADB device serials or host:port entries to run cases on. "
            "One worker is spawned per device."
        ),
    )


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Run Android UI test instructions via async "
            "operator/reflector loop."
        ),
    )
    sub = p.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser(
        "run", help="run a single test instruction on one device",
    )
    _add_common_args(run_p)
    _add_run_args(run_p)

    batch_p = sub.add_parser(
        "batch",
        help="run test cases from a JSON file across multiple devices",
    )
    _add_common_args(batch_p)
    _add_batch_args(batch_p)

    return p


def _add_extra_args(args: argparse.Namespace) -> None:
    for arg_name, arg_value in _EXTRA_CONFIG.items():
        if getattr(args, arg_name, None) is None:
            setattr(args, arg_name, arg_value)


def load_config(
    *,
    config_env: Path | None = None,
    argv: list[str] | None = None,
) -> argparse.Namespace:
    """Load configuration with layering:
    config.env → env vars → CLI args."""
    if config_env and config_env.exists():
        load_dotenv(config_env)
    parser = _build_parser()
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])
    _add_extra_args(args)
    return args
