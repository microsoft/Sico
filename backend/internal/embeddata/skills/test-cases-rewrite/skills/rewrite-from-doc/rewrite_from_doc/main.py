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

"""CLI entry point for rewrite-from-doc skill."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from rewrite_from_doc.rewriter import TestCaseRewriter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
#  config.env support (same pattern as android-tester)
# ---------------------------------------------------------------------------

_SKILL_ROOT = Path(__file__).resolve().parent.parent


def _find_config_env() -> Path | None:
    """Search for config.env starting from skill root, then parents."""
    for d in [_SKILL_ROOT, _SKILL_ROOT.parent, Path.cwd()]:
        p = d / "config.env"
        if p.exists():
            return p
    return None


def _env(
    name: str,
    default: Any = None,
    convert: Any = None,
) -> Any:
    """Read env var with optional conversion. Empty string → None."""
    raw = os.getenv(name)
    if raw is None:
        return default
    if raw.strip() == "":
        return None
    return convert(raw) if convert else raw


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    # Load config.env before parsing so env vars are available as defaults
    cfg_env = _find_config_env()
    if cfg_env:
        load_dotenv(cfg_env)
        logger.debug("Loaded config from %s", cfg_env)

    p = argparse.ArgumentParser(
        prog="rewrite-from-doc",
        description=(
            "Rewrite human-authored test cases into GUI Agent "
            "executable format using Sico LLM Hub."
        ),
    )
    p.add_argument(
        "--config", type=Path, default=None,
        help="Path to config.yaml (alternative to individual args)",
    )
    p.add_argument(
        "--input-csv", type=Path,
        help="Path to input test case CSV file",
    )
    p.add_argument(
        "--prompt-template", type=Path,
        default=_SKILL_ROOT / "data" / "rewrite_prompt.md",
        help="Path to the prompt template (default: auto-detected)",
    )
    p.add_argument(
        "--feature-doc", type=Path,
        help="Path to Feature Doc (.jsonl or .md)",
    )
    p.add_argument(
        "--action-space", type=Path,
        default=_SKILL_ROOT / "data" / "Action_Space.md",
        help="Path to Action_Space.md (default: auto-detected)",
    )
    _default_start_image = (
        _SKILL_ROOT / "data" / "Images" / "start.jpg"
    )
    p.add_argument(
        "--start-image", type=Path,
        default=(
            _default_start_image
            if _default_start_image.exists() else None
        ),
        help="Path to starting screenshot (default: auto-detected if exists)",
    )
    p.add_argument(
        "-o", "--output-dir", type=Path,
        default=_env("SICO_RESULT_DIR"),
        help=(
            "Directory for output files. Defaults to SICO_RESULT_DIR "
            "env var, or data/output/ if unset."
        ),
    )
    p.add_argument(
        "--sico-endpoint",
        default=_env("SICO_ENDPOINT", "http://localhost:8080"),
        help="Sico platform base URL (default: %(default)s)",
    )
    p.add_argument(
        "--sico-app-name",
        default=_env("SICO_APP_NAME", "sico"),
        help="Sico app name for API path (default: %(default)s)",
    )
    p.add_argument(
        "--sico-agent-instance-id",
        type=int,
        default=_env("SICO_AGENT_INSTANCE_ID", convert=int),
        help="Agent instance ID for X-Sico-Context header",
    )
    p.add_argument(
        "--llmhub-model",
        default=_env("LLMHUB_MODEL", "gpt5.4"),
        help="LLM model identifier (default: %(default)s)",
    )
    p.add_argument(
        "--encoding", default="utf-8",
        help="Input CSV encoding (default: utf-8)",
    )
    p.add_argument(
        "--max-rows", type=int, default=0,
        help="Max rows to process; 0 = all (default: 0)",
    )
    p.add_argument(
        "--max-workers",
        type=int,
        default=_env("MAX_WORKERS", 3, int),
        help="Concurrent LLM requests per batch (default: %(default)s)",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=_env("BATCH_SIZE", 20, int),
        help="Batch size for LLM calls (default: %(default)s)",
    )
    p.add_argument(
        "--output-format", choices=["csv", "jsonl"],
        default="csv",
        help="Output format (default: csv)",
    )
    p.add_argument(
        "--timeout",
        type=int,
        default=_env("TIMEOUT_SECONDS", 300, int),
        help="Per-request timeout in seconds (default: %(default)s)",
    )
    p.add_argument(
        "--max-retries",
        type=int,
        default=_env("MAX_RETRY_ROUNDS", 3, int),
        help=(
            "Max retry rounds for failed cases (default: %(default)s). "
            "Set 0 to disable."
        ),
    )
    p.add_argument(
        "--log-level", default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level (default: INFO)",
    )
    return p.parse_args(argv)


def _resolve(base: Path, rel: str | Path) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else base / p


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into *base*. Override wins."""
    result = dict(base)
    for key, val in override.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(val, dict)
        ):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def _load_yaml_config(path: Path) -> dict:
    """Load a YAML config, merging base_config if present."""
    import yaml  # deferred import — only needed for config mode

    with open(path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}

    base_ref = cfg.pop("base_config", None)
    if base_ref:
        base_file = _resolve(path.parent, base_ref)
        if base_file.exists():
            base_cfg = _load_yaml_config(base_file)
            cfg = _deep_merge(base_cfg, cfg)

    return cfg


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # Build Sico context header
    headers: dict[str, str] = {}
    if args.sico_agent_instance_id:
        ctx = {"agentInstanceId": args.sico_agent_instance_id}
        headers["X-Sico-Context"] = json.dumps(
            ctx, separators=(",", ":"),
        )

    # If --config is provided, load from YAML
    if args.config:
        cfg = _load_yaml_config(args.config)
        base = args.config.parent
        inp = cfg.get("input", {})
        mdl = cfg.get("model", {})
        batch = cfg.get("batch", {})
        out = cfg.get("output", {})

        rewriter = TestCaseRewriter(
            sico_endpoint=(
                os.environ.get("SICO_ENDPOINT")
                or mdl.get("sico_endpoint")
                or args.sico_endpoint
            ),
            model=mdl.get("llmhub_model", args.llmhub_model),
            input_csv=_resolve(base, inp["path"]),
            prompt_template_path=_resolve(
                base, cfg.get("prompt", {}).get(
                    "template_path",
                    "config/prompts/rewrite_prompt.md",
                ),
            ),
            feature_doc_path=_resolve(
                base, inp["feature_doc_path"],
            ),
            action_space_path=_resolve(
                base, inp["action_space_path"],
            ),
            output_dir=_resolve(base, out.get("path", "output")),
            start_image_path=(
                _resolve(base, inp["start_image_path"])
                if inp.get("start_image_path") else None
            ),
            encoding=inp.get("encoding", "utf-8"),
            max_rows=inp.get("max_rows", 0),
            max_workers=batch.get("max_workers", 3),
            batch_size=batch.get("batch_size", 20),
            sleep_between_batches=batch.get(
                "sleep_between_batches", 3.0,
            ),
            output_format=out.get("format", "csv"),
            sico_headers=headers,
            timeout_seconds=mdl.get("timeout_seconds", 300),
            max_retry_rounds=batch.get(
                "max_retry_rounds", args.max_retries,
            ),
            app_name=args.sico_app_name,
        )
    else:
        # CLI arg mode — all paths required
        # Only input-csv and feature-doc are truly required in CLI mode
        for name in ("input_csv", "feature_doc"):
            if getattr(args, name) is None:
                logger.error(
                    "--%s is required (or use --config)",
                    name.replace("_", "-"),
                )
                return 1

        # Default output dir if not set
        output_dir = args.output_dir or (
            _SKILL_ROOT / "data" / "output"
        )

        rewriter = TestCaseRewriter(
            sico_endpoint=args.sico_endpoint,
            model=args.llmhub_model,
            input_csv=args.input_csv,
            prompt_template_path=args.prompt_template,
            feature_doc_path=args.feature_doc,
            action_space_path=args.action_space,
            output_dir=output_dir,
            start_image_path=args.start_image,
            encoding=args.encoding,
            max_rows=args.max_rows,
            max_workers=args.max_workers,
            batch_size=args.batch_size,
            output_format=args.output_format,
            sico_headers=headers,
            timeout_seconds=args.timeout,
            max_retry_rounds=args.max_retries,
            app_name=args.sico_app_name,
        )

    try:
        out_path = rewriter.run()
        logger.info("Done. Output: %s", out_path)
        return 0
    except Exception:
        logger.exception("Rewrite pipeline failed")
        return 1
