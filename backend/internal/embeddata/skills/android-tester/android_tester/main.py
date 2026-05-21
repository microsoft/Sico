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
from contextlib import AsyncExitStack, aclosing
from pathlib import Path
from typing import Any

from android_tester.android_controller import AndroidController
from android_tester.asset_uploader import (
    AssetUploader,
    DummyAssetUploader,
    build_asset_uploader,
)
from android_tester.batch import BatchRunner
from android_tester.broker import JsonlBroker
from android_tester.config import load_config
from android_tester.image_store import (
    ImageStore,
    LocalImageStore,
    UploadingImageStore,
)
from android_tester.llm_hub import LLMHubClient
from android_tester.models import TaskStatus, TestCase
from android_tester.prompts import PromptRenderer
from android_tester.recorder import RunRecorder
from android_tester.runner import TestRunner
from android_tester.telemetry import collect_report, init_telemetry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Bootstrap (config + logging + telemetry + validation + path resolution)
# ---------------------------------------------------------------------------


def _validate(cfg: argparse.Namespace) -> None:
    if not cfg.sico_endpoint:
        raise ValueError(
            "Sico endpoint is required. "
            "Pass --sico-endpoint or set SICO_ENDPOINT",
        )
    if not cfg.sico_agent_instance_id:
        raise ValueError(
            "Agent instance ID is required. "
            "Pass --sico-agent-instance-id or set SICO_AGENT_INSTANCE_ID",
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

    _validate(cfg)

    if cfg.command == "run":
        cfg.task_id = cfg.task_id or str(uuid.uuid4())
        base = (
            Path(cfg.output_dir) if cfg.output_dir
            else Path("output") / cfg.task_id
        )
    else:  # batch
        base = Path(cfg.output_dir) if cfg.output_dir else Path("output")
    cfg.base_output_dir = base if base.is_absolute() else root / base

    return cfg


# ---------------------------------------------------------------------------
# Resource construction
# ---------------------------------------------------------------------------


def _build_sico_context_header(agent_instance_id: int) -> dict[str, str]:
    ctx = {"agentInstanceId": agent_instance_id}
    return {"X-Sico-Context": json.dumps(ctx, separators=(",", ":"))}


def _setup_controller(
    cfg: argparse.Namespace, root: Path, *, device_id: str | None = None,
) -> AndroidController:
    return AndroidController.create(
        device_id=device_id if device_id is not None else cfg.device_id,
        app_map_path=root / "data" / "app_packages.json",
        command_timeout=cfg.adb_command_timeout,
    )


def _setup_llm(cfg: argparse.Namespace) -> LLMHubClient:
    headers = (
        _build_sico_context_header(int(cfg.sico_agent_instance_id))
        if cfg.sico_agent_instance_id
        else {}
    )
    kwargs = {}
    if cfg.llm_timeout is not None:
        kwargs["timeout_seconds"] = cfg.llm_timeout
    return LLMHubClient(
        endpoint=cfg.sico_endpoint.rstrip("/"),
        model=cfg.llmhub_model,
        app_name=cfg.sico_app_name,
        headers=headers,
        **kwargs,
    )


def _setup_runner(
    cfg: argparse.Namespace,
    *,
    controller: AndroidController,
    llm: LLMHubClient,
    root: Path,
    recorder: RunRecorder,
    image_store: ImageStore,
) -> TestRunner:
    return TestRunner(
        controller=controller,
        llm=llm,
        prompts=PromptRenderer(root / "data"),
        recorder=recorder,
        image_store=image_store,
        **_get_runner_tuning_kwargs(cfg),
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def run() -> int:
    root = Path(__file__).resolve().parent.parent
    cfg = _bootstrap(root)

    if cfg.command == "batch":
        return await _run_batch(cfg, root)
    else:
        return await _run_single(cfg, root)


async def _run_single(cfg: argparse.Namespace, root: Path) -> int:
    async with AsyncExitStack() as stack:
        controller = _setup_controller(cfg, root)
        uploader = build_asset_uploader(
            cfg.sico_endpoint,
            app_name=cfg.sico_app_name,
            timeout=cfg.upload_timeout,
        )
        llm = await stack.enter_async_context(aclosing(_setup_llm(cfg)))
        broker = JsonlBroker(sys.stdout)
        recorder = RunRecorder(broker, cfg.base_output_dir)
        image_store = _build_image_store(uploader, cfg.base_output_dir)
        runner = _setup_runner(
            cfg,
            controller=controller, llm=llm, root=root,
            recorder=recorder, image_store=image_store,
        )
        status = await runner.run(
            instruction=cfg.instructions,
            task_id=cfg.task_id,
            task_name=cfg.task_name,
        )
        if telemetry_report := collect_report():
            await recorder.record("telemetry", **telemetry_report)

    return 0 if status == TaskStatus.COMPLETED else 1


async def _run_batch(cfg: argparse.Namespace, root: Path) -> int:
    cases = _resolve_cases(cfg)
    if not cases:
        logger.warning("no test cases provided")
        return 0

    async with AsyncExitStack() as stack:
        controllers = [
            _setup_controller(cfg, root, device_id=d)
            for d in cfg.devices
        ]
        uploader = build_asset_uploader(
            cfg.sico_endpoint,
            app_name=cfg.sico_app_name,
            timeout=cfg.upload_timeout,
        )
        llm = await stack.enter_async_context(aclosing(_setup_llm(cfg)))
        progress_broker = JsonlBroker(sys.stdout)
        runner = BatchRunner(
            controllers=controllers,
            llm=llm,
            prompts=PromptRenderer(root / "data"),
            output_root=cfg.base_output_dir,
            progress_broker=progress_broker,
            uploader=uploader,
            runner_kwargs=_get_runner_tuning_kwargs(cfg),
        )
        results = await runner.run(cases)

    failed = sum(1 for r in results if r.status != TaskStatus.COMPLETED)
    return 0 if failed == 0 else 1


def _resolve_cases(cfg: argparse.Namespace) -> list[TestCase]:
    """Build cases from one of: --file (path or '-' for stdin) or --test-cases.

    The two sources are mutually exclusive and at least one is required.
    """
    has_file = cfg.file is not None
    has_inline = cfg.test_cases is not None
    if has_file and has_inline:
        raise ValueError(
            "provide either --file (or '-' for stdin) or --test-cases, "
            "not both",
        )
    if not has_file and not has_inline:
        raise ValueError(
            "no test cases: pass --file (or '-' for stdin) or "
            "--test-cases",
        )
    if has_inline:
        return _parse_cases(json.loads(cfg.test_cases), "<--test-cases>")
    elif str(cfg.file) == "-":
        return _parse_cases(json.loads(sys.stdin.read()), "<stdin>")
    else:
        return _parse_cases(
            json.loads(cfg.file.read_text(encoding="utf-8")), str(cfg.file),
        )


def _parse_cases(raw: object, source: str) -> list[TestCase]:
    if not isinstance(raw, dict):
        raise ValueError(
            f"{source}: expected a JSON object with a 'test-cases' key",
        )
    items = raw.get("test-cases")
    if not isinstance(items, list):
        raise ValueError(
            f"{source}: 'test-cases' is required and must be a JSON array",
        )

    cases: list[TestCase] = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(
                f"{source}.test-cases[{i}]: expected an object, got "
                f"{type(item).__name__}",
            )
        instruction = item.get("instruction")
        if not isinstance(instruction, str) or not instruction.strip():
            raise ValueError(
                f"{source}.test-cases[{i}]: 'instruction' is required "
                "and must be a non-empty string",
            )
        cases.append(TestCase(
            instruction=instruction,
            task_id=item.get("task-id"),
            task_name=item.get("task-name"),
        ))
    return cases


def _build_image_store(
    uploader: AssetUploader | None, fallback_root: Path,
) -> ImageStore:
    if uploader is not None and not isinstance(uploader, DummyAssetUploader):
        return UploadingImageStore(uploader)

    return LocalImageStore(root=fallback_root)


def _get_runner_tuning_kwargs(cfg: argparse.Namespace) -> dict[str, Any]:
    return dict(
        max_steps=cfg.max_steps,
        max_no_progress_steps=cfg.max_no_progress_steps,
        max_repetitive_actions=cfg.max_repetitive_actions,
        sleep_between_steps=cfg.sleep_between_steps,
        first_step_sleep=cfg.first_step_sleep,
        model_image_size=cfg.llmhub_model_image_size,
        model_auto_resize_width=cfg.model_auto_resize_width,
        reflector_enabled=cfg.reflector,
        execution_timeout=cfg.execution_timeout,
        n_retries=cfg.n_retries_if_failed,
        log_llm_inputs=cfg.log_llm_inputs,
        history_length=cfg.history_length,
    )


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
