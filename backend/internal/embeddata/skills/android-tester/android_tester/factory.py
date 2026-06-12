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

"""Shared resource factory for android-tester runs.

Centralizes construction of controllers, LLM clients, event loggers,
image stores, runners, and precondition managers. Built once from
CLI config; used by the single-run entry point.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import cached_property
from pathlib import Path

from android_tester.android_controller import AndroidController
from android_tester.asset_uploader import (
    AssetUploader,
    DummyAssetUploader,
    build_asset_uploader,
)
from android_tester.broker import JsonlBroker
from android_tester.event_logger import EventLogger
from android_tester.image_store import (
    ImageStore,
    LocalImageStore,
    UploadingImageStore,
)
from android_tester.llm_hub import LLMHubClient
from android_tester.precondition_manager import PreconditionManager
from android_tester.prompts import PromptRenderer
from android_tester.runner import TestRunner
from android_tester.stop_policies import (
    MaxStepsPolicy,
    NoProgressPolicy,
    RepetitiveActionPolicy,
    StopPolicy,
)


class RunFactory:
    """Lazy-constructing resource factory.

    Usage::

        factory = RunFactory(cfg, root)
        await factory.runner.run(...)
    """

    def __init__(self, cfg: argparse.Namespace, root: Path) -> None:
        self.cfg = cfg
        self.root = root

    # -- singletons (shared across all runs) --

    @cached_property
    def llm(self) -> LLMHubClient:
        cfg = self.cfg
        headers = (
            _sico_context_header(int(cfg.sico_agent_instance_id))
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

    @cached_property
    def uploader(self) -> AssetUploader:
        return build_asset_uploader(
            self.cfg.sico_endpoint,
            app_name=self.cfg.sico_app_name,
            timeout=self.cfg.upload_timeout,
        )

    @cached_property
    def prompt_renderer(self) -> PromptRenderer:
        return PromptRenderer(
            self.root / "data",
            resources_available=bool(self.cfg.resources_path),
        )

    @cached_property
    def stop_policies(self) -> list[StopPolicy]:
        cfg = self.cfg
        return [
            MaxStepsPolicy(max_steps=cfg.max_steps),
            NoProgressPolicy(max_no_progress_steps=cfg.max_no_progress_steps),
            RepetitiveActionPolicy(max_repetitions=cfg.max_repetitive_actions),
        ]

    @cached_property
    def _runner_kwargs(self) -> dict:
        cfg = self.cfg
        return dict(
            stop_policies=self.stop_policies,
            sleep_between_steps=cfg.sleep_between_steps,
            first_step_sleep=cfg.first_step_sleep,
            max_screenshot_size=cfg.max_screenshot_size,
            coordinate_space=cfg.coordinate_space,
            reflector_enabled=cfg.reflector,
            execution_timeout=cfg.execution_timeout,
            n_retries=cfg.n_retries_if_failed,
            log_llm_inputs=cfg.log_llm_inputs,
            history_length=cfg.history_length,
        )

    @cached_property
    def controller(self) -> AndroidController:
        return AndroidController.create(
            device_id=self.cfg.device_id,
            app_map_path=self.root / "data" / "app_packages.json",
            command_timeout=self.cfg.adb_command_timeout,
            keep_app_state=frozenset(self.cfg.keep_app_state or ()),
            resources_path=self.cfg.resources_path,
            backup_dir=(
                f"/data/local/tmp/.android-tester/backup/{self.cfg.task_id}"
            ),
        )

    @cached_property
    def broker(self) -> JsonlBroker:
        return JsonlBroker(sys.stdout)

    @cached_property
    def event_logger(self) -> EventLogger:
        return EventLogger(self.broker, self.cfg.base_output_dir)

    @cached_property
    def image_store(self) -> ImageStore:
        return self._image_store_for(self.cfg.base_output_dir)

    def _image_store_for(self, output_dir: Path) -> ImageStore:
        up = self.uploader
        if up is not None and not isinstance(up, DummyAssetUploader):
            return UploadingImageStore(up)
        return LocalImageStore(root=output_dir)

    @cached_property
    def precondition_manager(self) -> PreconditionManager | None:
        if not self.cfg.precondition:
            return None
        return PreconditionManager(
            controller=self.controller,
            llm=self.llm,
            data_root=self.root / "data",
            cache_dir=self.cfg.precondition_cache_dir,
            event_logger=self.event_logger,
            image_store=self.image_store,
            runner_kwargs=self._runner_kwargs,
            resources_available=bool(self.cfg.resources_path),
        )

    @cached_property
    def runner(self) -> TestRunner:
        return TestRunner(
            controller=self.controller,
            llm=self.llm,
            prompts=self.prompt_renderer,
            event_logger=self.event_logger,
            image_store=self.image_store,
            precondition_manager=self.precondition_manager,
            **self._runner_kwargs,
        )


def _sico_context_header(agent_instance_id: int) -> dict[str, str]:
    ctx = {"agentInstanceId": agent_instance_id}
    return {"X-Sico-Context": json.dumps(ctx, separators=(",", ":"))}
