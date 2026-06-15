#!/usr/bin/env python3
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

"""Run Android UI test instruction via async operator/reflector loop."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import uuid
from contextlib import aclosing
from pathlib import Path

from android_tester.config import load_config
from android_tester.factory import RunFactory
from android_tester.models import TaskStatus
from android_tester.telemetry import collect_report, init_telemetry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Bootstrap (config + logging + telemetry + validation + path resolution)
# ---------------------------------------------------------------------------


def _validate_config(cfg: argparse.Namespace) -> None:
    if not cfg.sico_endpoint:
        raise ValueError(
            "Sico endpoint is required. "
            "Set SICO_ENDPOINT in the environment or config.env",
        )
    if not cfg.sico_agent_instance_id:
        raise ValueError(
            "Agent instance ID is required. "
            "Set SICO_AGENT_INSTANCE_ID in the environment or config.env",
        )


def _bootstrap(root: Path) -> argparse.Namespace:
    """Load config, init logging/telemetry, validate, resolve paths."""
    cfg = load_config(config_env=root / "config.env")

    logging.basicConfig(
        level=getattr(logging, cfg.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    init_telemetry(enabled=cfg.telemetry)
    logger.info("config %s", json.dumps(vars(cfg), default=str))

    _validate_config(cfg)

    cfg.task_id = cfg.task_id or str(uuid.uuid4())
    output_root = Path(cfg.output_dir) if cfg.output_dir else Path("output")
    if not output_root.is_absolute():
        output_root = root / output_root
    cfg.output_dir = output_root
    cfg.base_output_dir = output_root / cfg.task_id
    cfg.precondition_cache_dir = output_root / "preconditions"

    if cfg.resources_path:
        cfg.resources_path = Path(cfg.resources_path).expanduser().resolve()

    return cfg


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def run() -> int:
    root = Path(__file__).resolve().parent.parent
    cfg = _bootstrap(root)
    factory = RunFactory(cfg, root)
    async with aclosing(factory.llm):
        status = await factory.runner.run(
            instruction=cfg.instructions,
            task_id=cfg.task_id,
            task_name=cfg.task_name,
            preconditions=cfg.precondition,
        )
        if telemetry_report := collect_report():
            await factory.event_logger.record(
                "telemetry", **telemetry_report,
            )
    return (0
            if status == TaskStatus.COMPLETED
            else 1
            if status == TaskStatus.FAILED
            else 2)


def _configure_stdout():
    """
    Force UTF-8 on stdout/stderr so non-ASCII characters don't crash the
    process under Windows consoles, which default to cp1252.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    _configure_stdout()
    return asyncio.run(run())
