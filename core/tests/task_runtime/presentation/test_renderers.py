"""Tests for the per-dispatch-kind view renderers."""

from __future__ import annotations

from app.biz.task_runtime.domain.models import (
    ArtifactRef,
    BatchResult,
    BatchStatus,
    CapabilityDispatch,
    SubAgentDispatch,
    TaskDisplay,
    TaskResult,
    TaskStatus,
    TaskSpec,
)
from app.biz.task_runtime.presentation.rendering.tool_payload import result_to_tool_payload
from app.biz.task_runtime.presentation.rendering.renderers import (
    SkillRenderer,
    SubAgentRenderer,
    ToolRenderer,
    renderer_for,
)


def _tool_task(title: str = "Echo it", tool_name: str = "echo") -> TaskSpec:
    return TaskSpec(task_id="t-1", title=title, dispatch=CapabilityDispatch(capability_id=f"builtin:{tool_name}"))


def _skill_task(title: str = "Run android", skill_name: str = "android-test") -> TaskSpec:
    return TaskSpec(task_id="t-1", title=title, dispatch=CapabilityDispatch(capability_id=f"skill:{skill_name}.run"))


def _sub_agent_task(title: str = "Sub-agent reasoning", profile_id: str = "default") -> TaskSpec:
    return TaskSpec(task_id="t-1", title=title, dispatch=SubAgentDispatch(profile_id=profile_id))


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


def test_sub_agent_renderer_uses_profile_id_in_labels() -> None:
    task = _sub_agent_task(profile_id="research")
    renderer = renderer_for(task)

    assert renderer.context_line(task) == "Sub-agent: research"
    assert renderer.command_hint(task) == "sub-agent reasoning loop"
    assert renderer.invocation_label(task) == "sub-agent research"
    assert renderer.resolved_item_name(task) == "Resolved sub-agent: research"


def test_display_overrides_take_precedence_over_defaults() -> None:
    task = TaskSpec(
        task_id="t-1",
        title="Echo it",
        dispatch=CapabilityDispatch(capability_id="builtin:echo"),
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


def test_compact_batch_payload_aggregates_urls_from_omitted_results() -> None:
    results = [
        TaskResult(
            run_id=f"run-{index}",
            task_id=f"task-{index}",
            title=f"Report {index}",
            status=TaskStatus.COMPLETED,
            summary="done",
            primary_artifact=ArtifactRef(
                name=f"report-{index}.html",
                type="report",
                role="primary",
                uri=f"/storage/task-runtime/run-{index}/report.html",
            ),
        )
        for index in range(5)
    ]

    payload = result_to_tool_payload(
        BatchResult(
            batch_id="batch-1",
            status=BatchStatus.COMPLETED,
            total_count=5,
            completed_count=5,
            failed_count=0,
            cancelled_count=0,
            timed_out_count=0,
            blocked_count=0,
            results=results,
            artifacts_root="",
        )
    )

    assert len(payload["results"]) == 3
    assert payload["omitted_result_count"] == 2
    assert payload["report_urls"] == [
        f"http://localhost:8080/storage/task-runtime/run-{index}/report.html" for index in range(5)
    ]
    assert payload["omitted_success_run_ids"] == ["run-3", "run-4"]


def test_compact_batch_payload_keeps_omitted_success_ids_without_artifacts() -> None:
    results = [
        TaskResult(
            run_id=f"run-{index}",
            task_id=f"task-{index}",
            title=f"Task {index}",
            status=TaskStatus.COMPLETED,
            summary="done",
        )
        for index in range(4)
    ]

    payload = result_to_tool_payload(
        BatchResult(
            batch_id="batch-1",
            status=BatchStatus.COMPLETED,
            total_count=4,
            completed_count=4,
            failed_count=0,
            cancelled_count=0,
            timed_out_count=0,
            blocked_count=0,
            results=results,
            artifacts_root="",
        )
    )

    assert [item["run_id"] for item in payload["results"]] == ["run-0", "run-1", "run-2"]
    assert payload["omitted_success_run_ids"] == ["run-3"]


def test_compact_batch_payload_bounds_omitted_run_ids() -> None:
    results = [
        TaskResult(
            run_id=f"run-{index}",
            task_id=f"task-{index}",
            title=f"Task {index}",
            status=TaskStatus.COMPLETED,
            summary="done",
        )
        for index in range(510)
    ]

    payload = result_to_tool_payload(
        BatchResult(
            batch_id="batch-1",
            status=BatchStatus.COMPLETED,
            total_count=510,
            completed_count=510,
            failed_count=0,
            cancelled_count=0,
            timed_out_count=0,
            blocked_count=0,
            results=results,
            artifacts_root="",
        )
    )

    assert len(payload["omitted_success_run_ids"]) == 500
    assert payload["omitted_success_run_id_count"] == 507
    assert payload["unlisted_omitted_success_run_id_count"] == 7


def test_compact_batch_payload_bounds_failure_details() -> None:
    results = [
        TaskResult(
            run_id=f"run-{index}",
            task_id=f"task-{index}",
            title=f"Failure {index}",
            status=TaskStatus.FAILED,
            summary="failed",
            error_message="failure details",
        )
        for index in range(15)
    ]

    payload = result_to_tool_payload(
        BatchResult(
            batch_id="batch-1",
            status=BatchStatus.FAILED,
            total_count=15,
            completed_count=0,
            failed_count=15,
            cancelled_count=0,
            timed_out_count=0,
            blocked_count=0,
            results=results,
            artifacts_root="",
        )
    )

    assert len(payload["results"]) == 10
    assert payload["counts"]["failed"] == 15
    assert payload["omitted_result_count"] == 5
    assert payload["omitted_non_success_run_ids"] == [f"run-{index}" for index in range(10, 15)]


def test_compact_batch_payload_prioritizes_non_success_details() -> None:
    results = [
        TaskResult(
            run_id=f"success-{index}",
            task_id=f"success-task-{index}",
            title=f"Success {index}",
            status=TaskStatus.COMPLETED,
            summary="done",
        )
        for index in range(3)
    ] + [
        TaskResult(
            run_id=f"failure-{index}",
            task_id=f"failure-task-{index}",
            title=f"Failure {index}",
            status=TaskStatus.FAILED,
            summary="failed",
            error_message="failure details",
        )
        for index in range(9)
    ]

    payload = result_to_tool_payload(
        BatchResult(
            batch_id="batch-1",
            status=BatchStatus.PARTIAL,
            total_count=12,
            completed_count=3,
            failed_count=9,
            cancelled_count=0,
            timed_out_count=0,
            blocked_count=0,
            results=results,
            artifacts_root="",
        )
    )

    shown_run_ids = [item["run_id"] for item in payload["results"]]
    assert shown_run_ids == ["success-0", *(f"failure-{index}" for index in range(9))]
    assert payload["omitted_success_run_ids"] == ["success-1", "success-2"]
    assert "omitted_non_success_run_ids" not in payload


def test_compact_batch_payload_bounds_inline_report_urls() -> None:
    results = [
        TaskResult(
            run_id=f"run-{index}",
            task_id=f"task-{index}",
            title=f"Report {index}",
            status=TaskStatus.COMPLETED,
            summary="done",
            primary_artifact=ArtifactRef(
                name=f"report-{index}.html",
                type="report",
                role="primary",
                uri=f"/storage/task-runtime/run-{index}/report.html",
            ),
        )
        for index in range(60)
    ]

    payload = result_to_tool_payload(
        BatchResult(
            batch_id="batch-1",
            status=BatchStatus.COMPLETED,
            total_count=60,
            completed_count=60,
            failed_count=0,
            cancelled_count=0,
            timed_out_count=0,
            blocked_count=0,
            results=results,
            artifacts_root="results/batch-1/artifacts",
        )
    )

    assert len(payload["report_urls"]) == 50
    assert payload["report_url_count"] == 60
    assert payload["omitted_report_url_count"] == 10
    assert payload["artifacts_root"] == "results/batch-1/artifacts"
