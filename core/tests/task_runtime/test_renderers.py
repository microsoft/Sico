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

"""Tests for the per-dispatch-kind view renderers."""

from __future__ import annotations

from app.biz.task_runtime.models import (
    ArtifactRef,
    BatchResult,
    BatchStatus,
    SkillDispatch,
    SubAgentDispatch,
    TaskDisplay,
    TaskResult,
    TaskStatus,
    TaskSpec,
    ToolDispatch,
)
from app.biz.task_runtime.presentation.rendering.tool_payload import result_to_tool_payload
from app.biz.task_runtime.presentation.rendering.renderers import (
    SkillRenderer,
    SubAgentRenderer,
    ToolRenderer,
    renderer_for,
)


def _tool_task(title: str = "Echo it", tool_name: str = "echo") -> TaskSpec:
    return TaskSpec(task_id="t-1", title=title, dispatch=ToolDispatch(tool_name=tool_name))


def _skill_task(title: str = "Run android", skill_name: str = "android-test") -> TaskSpec:
    return TaskSpec(task_id="t-1", title=title, dispatch=SkillDispatch(skill_name=skill_name, action_name="run"))


def _sub_agent_task(title: str = "Sub-agent reasoning", persona: str = "default") -> TaskSpec:
    return TaskSpec(task_id="t-1", title=title, dispatch=SubAgentDispatch(persona=persona))


def test_renderer_for_returns_tool_renderer_for_tool_dispatch() -> None:
    assert isinstance(renderer_for(_tool_task()), ToolRenderer)


def test_renderer_for_returns_skill_renderer_for_skill_dispatch() -> None:
    assert isinstance(renderer_for(_skill_task()), SkillRenderer)


def test_renderer_for_returns_sub_agent_renderer_for_sub_agent_dispatch() -> None:
    assert isinstance(renderer_for(_sub_agent_task()), SubAgentRenderer)


def test_tool_renderer_context_and_command_hints() -> None:
    task = _tool_task(tool_name="echo")
    renderer = renderer_for(task)

    assert renderer.context_line(task) == "Tool: echo"
    assert renderer.command_hint(task) == "local tool: echo"
    assert renderer.invocation_label(task) == "tool echo"
    assert renderer.resolved_item_name(task) == "Resolved local tool: echo"


def test_skill_renderer_context_and_command_hints() -> None:
    task = _skill_task(skill_name="android-test")
    renderer = renderer_for(task)

    assert renderer.context_line(task) == "Skill: android-test"
    assert renderer.command_hint(task) == "skill entrypoint: android-test"
    assert renderer.invocation_label(task) == "skill android-test"
    assert renderer.resolved_item_name(task, command="run") == "Resolved skill: android-test -> run"


def test_sub_agent_renderer_uses_persona_in_labels() -> None:
    task = _sub_agent_task(persona="research")
    renderer = renderer_for(task)

    assert renderer.context_line(task) == "Sub-agent: research"
    assert renderer.command_hint(task) == "sub-agent reasoning loop"
    assert renderer.invocation_label(task) == "sub-agent research"
    assert renderer.resolved_item_name(task) == "Resolved sub-agent: research"


def test_display_overrides_take_precedence_over_defaults() -> None:
    task = TaskSpec(
        task_id="t-1",
        title="Echo it",
        dispatch=ToolDispatch(tool_name="echo"),
        display=TaskDisplay(
            plan_title="Custom plan title",
            batch_step_title="Custom batch title",
            single_step_title="Custom single title",
        ),
    )
    renderer = renderer_for(task)

    assert renderer.plan_title(task) == "Custom plan title"
    assert renderer.batch_step_title(task) == "Custom batch title"
    assert renderer.single_step_title(task) == "Custom single title"


def test_empty_display_falls_back_to_dispatch_defaults() -> None:
    task = _tool_task(title="My task")
    renderer = renderer_for(task)

    assert renderer.plan_title(task) == "My task"
    assert renderer.batch_step_title(task) == "Local tool batch"
    assert renderer.single_step_title(task) == "My task"


def test_default_icons_distinguish_dispatch_kinds() -> None:
    assert renderer_for(_tool_task()).default_icon == "tool"
    assert renderer_for(_skill_task()).default_icon == "skill"
    assert renderer_for(_sub_agent_task()).default_icon == "sub_agent"


def test_tool_payload_excludes_artifact_metadata_but_keeps_urls() -> None:
    artifact = ArtifactRef(
        name="report.html",
        type="file",
        role="primary",
        uri="/storage/task-runtime/run-1/report.html",
        filepath="results/batch-1/run-1/report.html",
        size_bytes=123,
        metadata={"storage": "seaweedfs", "object_path": "task-runtime/run-1/report.html"},
    )
    result = TaskResult(
        run_id="run-1",
        task_id="task-1",
        title="Render report",
        status=TaskStatus.COMPLETED,
        summary="done",
        primary_artifact=artifact,
        artifacts=[artifact],
    )
    payload = result_to_tool_payload(
        BatchResult(
            batch_id="batch-1",
            status=BatchStatus.COMPLETED,
            total_count=1,
            completed_count=1,
            failed_count=0,
            cancelled_count=0,
            timed_out_count=0,
            blocked_count=0,
            results=[result],
            artifacts_root="",
        )
    )

    assert payload["primary_artifact"]["uri"] == "/storage/task-runtime/run-1/report.html"
    assert payload["primary_artifact"]["filepath"] == "results/batch-1/run-1/report.html"
    assert "metadata" not in payload["primary_artifact"]
    assert payload["report_url"] == "http://localhost:8080/storage/task-runtime/run-1/report.html"
