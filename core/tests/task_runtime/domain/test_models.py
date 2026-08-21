import asyncio
import json

import pytest

from app.biz.chat.preparation.request import DelegateRequest, parse_delegate_request
from app.biz.task_runtime.storage.db_store import _task_run_from_json
from app.biz.task_runtime.domain.models import (
    BatchRecord,
    BatchStatus,
    CapabilityDispatch,
    ErrorClass,
    SandboxLeaseRef,
    SubAgentDispatch,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
    TaskStatus,
    compute_idempotency_key,
)
from app.biz.task_runtime.workspace.rerun_sources import compact_rerun_source_payload, delegate_request_from_rerun_source
from app.tools.common import ToolContext
from app.tools.plan import PlanEditor


class FakePlanEditor(PlanEditor):
    def __init__(self):
        pass


def _skill_task(task_id: str, *, title: str = "Run case", skill_name: str = "mock", **kwargs) -> TaskSpec:
    return TaskSpec(task_id=task_id, title=title, dispatch=CapabilityDispatch(capability_id=f"skill:{skill_name}.run"), **kwargs)


def test_idempotency_key_ignores_task_id() -> None:
    first = _skill_task("a", args={"case": {"id": 1}})
    second = _skill_task("b", args={"case": {"id": 1}})

    assert compute_idempotency_key("submission-1", 3, first) == compute_idempotency_key("submission-1", 3, second)


def test_task_spec_required_sandbox_normalizes_to_options() -> None:
    legacy = _skill_task("legacy", required_sandbox="android")
    multi = _skill_task("multi", required_sandbox=["windows", "macos", "windows"])

    assert legacy.sandbox_options == ("android",)
    assert legacy.selected_sandbox == "android"
    assert multi.sandbox_options == ("windows", "macos")
    assert multi.selected_sandbox is None

    multi.set_selected_sandbox("macos")
    assert multi.selected_sandbox == "macos"
    assert multi.metadata["_task_runtime"]["selected_sandbox"] == "macos"


def test_idempotency_key_changes_with_submission_id() -> None:
    task = _skill_task("t", args={"a": 1})

    assert compute_idempotency_key("submission-1", 0, task) != compute_idempotency_key("submission-2", 0, task)


def test_idempotency_key_is_stable_across_retries() -> None:
    """parent_tool_call_id may change on retry; the key must not."""
    task = _skill_task("t1", title="Same task", skill_name="s", args={"a": 1})

    key_first = compute_idempotency_key("submission-1", 0, task)
    key_retry = compute_idempotency_key("submission-1", 0, task)

    assert key_first == key_retry


def test_idempotency_key_changes_with_args() -> None:
    a = _skill_task("t", title="T", skill_name="s", args={"x": 1})
    b = _skill_task("t", title="T", skill_name="s", args={"x": 2})

    assert compute_idempotency_key("submission-1", 0, a) != compute_idempotency_key("submission-1", 0, b)


def test_explicit_idempotency_key_is_scoped_to_submission() -> None:
    task = _skill_task("t", title="T", skill_name="s", idempotency_key="caller-supplied-uuid-123")

    assert compute_idempotency_key("submission-1", 99, task) != compute_idempotency_key("submission-2", 99, task)


def test_rerun_source_translates_to_unified_delegate_request() -> None:
    source = {
        "reason": "Repeat checks",
        "join_strategy": "all_success",
        "tasks": [
            {
                "title": "Echo",
                "instructions": "Echo hello",
                "args": {"message": "hello"},
                "dispatch": {"type": "capability", "capability_id": "builtin:echo"},
                "stage": 1,
            }
        ],
    }

    request = delegate_request_from_rerun_source(source)

    assert request == {
        "batch_goal": "Repeat checks",
        "join_strategy": "all_success",
        "sources": [
            {
                "type": "instructions",
                "items": [
                    {
                        "goal": "Echo hello",
                        "title": "Echo",
                        "params": {"message": "hello"},
                        "capability_id": "builtin:echo",
                        "stage": 1,
                    }
                ],
            }
        ],
    }
    assert isinstance(parse_delegate_request(json.dumps(request)), DelegateRequest)


def test_explicit_idempotency_key_overrides_args_changes() -> None:
    """A caller-supplied key intentionally collapses different payloads."""
    a = _skill_task("t", title="T", skill_name="s", args={"x": 1}, idempotency_key="job-42")
    b = _skill_task("t", title="T", skill_name="s", args={"x": 999}, idempotency_key="job-42")

    assert compute_idempotency_key("submission-1", 0, a) == compute_idempotency_key("submission-1", 0, b)

    without_explicit_key = _skill_task("t", title="T", skill_name="s", args={"x": 1})
    assert compute_idempotency_key("submission-1", 0, a) != compute_idempotency_key(
        "submission-1",
        0,
        without_explicit_key,
    )


def test_tool_context_assigns_stable_delegate_submission_ids_by_request_order() -> None:
    context = ToolContext(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        turn_id=7,
        project_id=1,
        conversation_id=100,
        response_queue=asyncio.Queue(),
        plan_editor=FakePlanEditor(),
        submission_id="request-1",
    )

    first = context.next_task_submission_id()
    second = context.next_task_submission_id()
    third = context.next_task_submission_id()

    assert (first, second, third) == (
        "request-1:delegate:0",
        "request-1:delegate:1",
        "request-1:delegate:2",
    )

    replay = ToolContext(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        turn_id=7,
        project_id=1,
        conversation_id=100,
        response_queue=asyncio.Queue(),
        plan_editor=FakePlanEditor(),
        submission_id="request-1",
    )
    assert replay.next_task_submission_id() == first
    assert replay.next_task_submission_id() == second


def test_task_spec_dispatch_accessors_expose_dispatch_payload() -> None:
    tool_task = TaskSpec(task_id="t", title="T", dispatch=CapabilityDispatch(capability_id="builtin:echo"))
    skill_task = TaskSpec(
        task_id="s",
        title="S",
        dispatch=CapabilityDispatch(capability_id="skill:android-test.run"),
    )

    assert tool_task.kind == "capability"
    assert tool_task.capability_id == "builtin:echo"
    assert tool_task.tool_name == "echo"
    assert tool_task.skill_name is None

    assert skill_task.kind == "capability"
    assert skill_task.capability_id == "skill:android-test.run"
    assert skill_task.tool_name is None
    assert skill_task.skill_name == "android-test"


def test_sub_agent_grants_are_namespaced_and_deduplicated_on_load() -> None:
    spec = TaskSpec.model_validate(
        {
            "task_id": "t",
            "title": "T",
            "dispatch": {
                "type": "sub_agent",
                "capabilities": [
                    "echo",
                    "builtin:echo",
                    "android-test.run",
                    "echo",
                    "builtin:run_command",
                    "run_command",
                ],
            },
        }
    )

    assert spec.dispatch.capability_grants == ["builtin:echo", "skill:android-test.run", "builtin:run_command"]


def test_sub_agent_dispatch_legacy_fields_do_not_mutate_input() -> None:
    payload = {
        "persona": "research",
        "max_steps": 4,
        "capabilities": ["echo"],
    }
    original = dict(payload)

    dispatch = SubAgentDispatch.model_validate(payload)

    assert payload == original
    assert dispatch.profile_id == "default"
    assert dispatch.max_model_turns == 4
    assert dispatch.capability_grants == ["builtin:echo"]


def test_sub_agent_dispatch_canonical_fields_override_coexisting_legacy_fields() -> None:
    payload = {
        "persona": "legacy",
        "profile_id": "research",
        "max_steps": 3,
        "max_model_turns": 4,
        "capabilities": ["echo"],
        "capability_grants": ["run_command", "builtin:run_command"],
    }
    original = {
        **payload,
        "capabilities": list(payload["capabilities"]),
        "capability_grants": list(payload["capability_grants"]),
    }

    dispatch = SubAgentDispatch.model_validate(payload)

    assert payload == original
    assert dispatch.profile_id == "research"
    assert dispatch.max_model_turns == 4
    assert dispatch.capability_grants == ["builtin:run_command"]


def test_sub_agent_dispatch_rejects_blank_profile_id() -> None:
    with pytest.raises(ValueError, match="profile_id must not be empty"):
        SubAgentDispatch(profile_id="  ")


def test_sub_agent_dispatch_normalizes_legacy_zero_turn_budget_to_default() -> None:
    assert SubAgentDispatch(max_model_turns=0).max_model_turns is None
    spec = TaskSpec.model_validate(
        {
            "task_id": "t",
            "title": "T",
            "dispatch": {"type": "sub_agent", "max_steps": 0},
        }
    )
    assert spec.dispatch.max_model_turns is None


def test_sub_agent_dispatch_rejects_negative_turn_budget() -> None:
    with pytest.raises(ValueError):
        SubAgentDispatch(max_model_turns=-1)


def test_batch_record_persisted_json_contract() -> None:
    batch = BatchRecord(
        batch_id="batch-1",
        parent_conversation_id=101,
        parent_turn_id=202,
        parent_tool_call_id=303,
        status=BatchStatus.RUNNING,
        reason="Execute cases",
        join_strategy="all_success",
        max_concurrency=4,
        sandbox_type="android",
        sandbox_task_count=2,
        sandbox_concurrency=1,
        available_sandbox_count=3,
        planned_batch_sizes=[2, 1],
        total_count=3,
        counts={"completed": 1},
        created_at=1_000,
        updated_at=2_000,
        ended_at=3_000,
        cancellation_reason="none",
        metadata={"source": "golden"},
    )

    assert batch.model_dump(mode="json") == {
        "batch_id": "batch-1",
        "parent_conversation_id": 101,
        "parent_turn_id": 202,
        "parent_tool_call_id": 303,
        "status": "running",
        "reason": "Execute cases",
        "join_strategy": "all_success",
        "max_concurrency": 4,
        "sandbox_type": "android",
        "sandbox_task_count": 2,
        "sandbox_concurrency": 1,
        "available_sandbox_count": 3,
        "planned_batch_sizes": [2, 1],
        "total_count": 3,
        "counts": {"completed": 1},
        "created_at": 1_000,
        "updated_at": 2_000,
        "ended_at": 3_000,
        "cancellation_reason": "none",
        "metadata": {"source": "golden"},
    }


def test_task_run_persisted_json_contract() -> None:
    run = TaskRun(
        run_id="run-1",
        batch_id="batch-1",
        parent_conversation_id=101,
        parent_turn_id=202,
        parent_tool_call_id=303,
        plan_batch_call_id=404,
        batch_item_index=2,
        username="alice@example.com",
        agent_id="agent-1",
        agent_instance_id=505,
        project_id=606,
        spec=TaskSpec(
            task_id="task-1",
            title="Run case",
            instructions="Execute the selected case.",
            dispatch=SubAgentDispatch(
                profile_id="default",
                max_model_turns=6,
                capability_grants=["builtin:echo"],
            ),
            args={"case_id": "TC-1"},
            metadata={"source": "golden"},
            required_sandbox=["android"],
            stage=1,
            idempotency_key="task-key",
        ),
        execution_policy=TaskExecutionPolicy(
            timeout_seconds=90,
            executor="command_backend",
            trust_level="tenant_uploaded",
            requires_strong_isolation=True,
            network_policy="deny-all",
            max_log_bytes=1_024,
        ),
        status=TaskStatus.RUNNING,
        attempt=2,
        idempotency_key="run-key",
        executor="command_backend",
        worker_id="worker-1",
        fencing_token="fence-1",
        sandbox=SandboxLeaseRef(
            sandbox_id="sandbox-1",
            type="emulator",
            os="android",
            endpoint="127.0.0.1:5555",
            provider_base_url="https://sandbox.example",
            device_id="device-1",
            vnc_url="https://vnc.example",
            acquired_at=900,
            expires_at=9_000,
        ),
        sandbox_released=True,
        lease_outcome="released",
        runtime_stage="execute",
        queued_at=1_000,
        started_at=1_100,
        heartbeat_at=1_200,
        ended_at=1_300,
        latest_progress_message="running",
        latest_progress_at=1_250,
        last_error_class=ErrorClass.TRANSIENT,
        last_error="retrying",
    )

    assert run.model_dump(mode="json") == {
        "run_id": "run-1",
        "batch_id": "batch-1",
        "parent_conversation_id": 101,
        "parent_turn_id": 202,
        "parent_tool_call_id": 303,
        "plan_batch_call_id": 404,
        "batch_item_index": 2,
        "username": "alice@example.com",
        "agent_id": "agent-1",
        "agent_instance_id": 505,
        "project_id": 606,
        "spec": {
            "task_id": "task-1",
            "title": "Run case",
            "instructions": "Execute the selected case.",
            "dispatch": {
                "type": "sub_agent",
                "profile_id": "default",
                "max_model_turns": 6,
                "capability_grants": ["builtin:echo"],
            },
            "display": {"plan_title": "", "batch_step_title": "", "single_step_title": ""},
            "args": {"case_id": "TC-1"},
            "metadata": {"source": "golden"},
            "required_sandbox": ["android"],
            "stage": 1,
            "idempotency_key": "task-key",
        },
        "execution_policy": {
            "timeout_seconds": 90,
            "retry": {
                "max_attempts": 1,
                "retry_on": ["transient", "sandbox_unhealthy"],
                "backoff_seconds": 5,
            },
            "executor": "command_backend",
            "trust_level": "tenant_uploaded",
            "requires_strong_isolation": True,
            "network_policy": "deny-all",
            "max_log_bytes": 1_024,
        },
        "status": "running",
        "attempt": 2,
        "idempotency_key": "run-key",
        "executor": "command_backend",
        "worker_id": "worker-1",
        "fencing_token": "fence-1",
        "sandbox": {
            "sandbox_id": "sandbox-1",
            "type": "emulator",
            "os": "android",
            "endpoint": "127.0.0.1:5555",
            "provider_base_url": "https://sandbox.example",
            "device_id": "device-1",
            "vnc_url": "https://vnc.example",
            "acquired_at": 900,
            "expires_at": 9_000,
        },
        "sandbox_released": True,
        "lease_outcome": "released",
        "runtime_stage": "execute",
        "queued_at": 1_000,
        "started_at": 1_100,
        "heartbeat_at": 1_200,
        "ended_at": 1_300,
        "latest_progress_message": "running",
        "latest_progress_at": 1_250,
        "last_error_class": "transient",
        "last_error": "retrying",
    }


def test_secret_arguments_never_reach_the_serialized_spec() -> None:
    spec = TaskSpec(
        task_id="t",
        title="T",
        dispatch=CapabilityDispatch(capability_id="builtin:echo"),
        args={"password": "<redacted>"},
    )
    run = TaskRun(
        run_id="r",
        batch_id="b",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="u",
        agent_id="a",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key="t",
        executor="in_process",
        queued_at=0,
    )
    run.bind_secret_arguments({"password": "hunter2"})

    assert run.secret_arguments == {"password": "hunter2"}
    assert "hunter2" not in run.model_dump_json()
    # The child inherits the channel, since capability calls derive their run by copy.
    assert run.model_copy(update={"run_id": "r2"}).secret_arguments == {"password": "hunter2"}


def test_task_spec_json_schema_excludes_legacy_flat_fields() -> None:
    """``TaskSpec`` no longer exposes the legacy flat ``kind`` / ``skill_name`` /
    ``tool_name`` fields; only the discriminated ``dispatch`` shape is part of
    the schema, plus the runtime-policy fields stay hidden."""
    task_properties = TaskSpec.model_json_schema()["properties"]

    assert "dispatch" in task_properties
    assert "kind" not in task_properties
    assert "skill_name" not in task_properties
    assert "tool_name" not in task_properties
    assert "entrypoint" not in task_properties
    assert "agent_profile" not in task_properties
    assert "timeout" not in task_properties
    assert "retry" not in task_properties
    assert "executor" not in task_properties


def test_rerun_source_payload_removes_redundant_platform_metadata() -> None:
    source = {
        "tasks": [
            {
                "task_id": "case-1",
                "title": "Case 1",
                "dispatch": {"type": "capability", "capability_id": "skill:android-test.run"},
                "instructions": "Run the case",
                "args": {},
                "metadata": {
                    "capability": {"name": "android-test", "display": {"task_label": "Android test"}},
                    "display": {"task_label": "Android test"},
                    "user_label": "benchmark",
                },
                "required_sandbox": "emulator",
                "idempotency_key": "legacy-key",
            }
        ]
    }

    compact = compact_rerun_source_payload(source)
    task = compact["tasks"][0]

    assert task == {
        "task_id": "case-1",
        "title": "Case 1",
        "dispatch": {"type": "capability", "capability_id": "skill:android-test.run"},
        "instructions": "Run the case",
        "metadata": {"user_label": "benchmark"},
    }


def test_rerun_source_payload_replaces_private_object_ref_with_logical_source() -> None:
    content_hash = "d" * 64
    object_ref = f"sico-source://objects/{content_hash}/source.xlsx"
    source = {
        "tasks": [
            {
                "task_id": "case-1",
                "title": "Case 1",
                "dispatch": {"type": "capability", "capability_id": "skill:android-test.run"},
                "instructions": "Run the case",
                "args": {"input_file": object_ref, "case": {"document_path": object_ref}},
                "metadata": {
                    "tabular": {
                        "source_ref": "attachments/cases.xlsx",
                        "source_object_ref": object_ref,
                        "sheet_name": "Cases",
                    }
                },
            }
        ]
    }

    compact = compact_rerun_source_payload(source)

    task = compact["tasks"][0]
    assert task["args"] == {
        "input_file": "attachments/cases.xlsx",
        "case": {"document_path": "attachments/cases.xlsx"},
    }
    assert task["metadata"]["tabular"] == {
        "source_ref": "attachments/cases.xlsx",
        "sheet_name": "Cases",
        "materialize_object": True,
        "content_hash": content_hash,
    }


def test_rerun_source_rejects_untranslatable_private_object_ref() -> None:
    source = {
        "tasks": [
            {
                "task_id": "case-1",
                "title": "Case 1",
                "kind": "tool",
                "tool_name": "echo",
                "args": {"message": "sico-source://objects/" + "f" * 64 + "/source.txt"},
            }
        ]
    }

    assert delegate_request_from_rerun_source(source) is None


def test_rerun_source_does_not_reinterpret_untrusted_private_like_value() -> None:
    trusted_ref = "sico-source://objects/" + "a" * 64 + "/source.csv"
    untrusted_value = "sico-source://objects/" + "b" * 64 + "/source.csv"
    source = {
        "tasks": [
            {
                "task_id": "case-1",
                "title": "Case 1",
                "dispatch": {"type": "capability", "capability_id": "skill:cases.run"},
                "args": {"case_value": untrusted_value},
                "metadata": {
                    "tabular": {
                        "source_ref": "attachments/cases.csv",
                        "source_object_ref": trusted_ref,
                    }
                },
            }
        ]
    }

    compact = compact_rerun_source_payload(source)

    assert compact["tasks"][0]["args"] == {"case_value": untrusted_value}
    assert "materialize_object" not in compact["tasks"][0]["metadata"]["tabular"]
    assert delegate_request_from_rerun_source(compact) is None


def test_db_run_loader_normalizes_blank_last_error_class() -> None:
    run = _task_run_from_json(
        """
                {
                    "run_id": "run-1",
                    "batch_id": "batch-1",
                    "parent_conversation_id": 1,
                    "parent_turn_id": 1,
                    "batch_item_index": 0,
                    "username": "alice@example.com",
                    "agent_id": "agent",
                    "agent_instance_id": 1,
                    "project_id": 1,
                    "spec": {
                        "task_id": "task-1",
                        "title": "Task",
                        "dispatch": {"type": "capability", "capability_id": "builtin:echo"}
                    },
                    "execution_policy": {},
                    "idempotency_key": "key",
                    "executor": "local_subprocess",
                    "queued_at": 1,
                    "last_error_class": ""
                }
                """
    )

    assert run.spec.tool_name == "echo"
    assert run.last_error_class is None


def test_tool_context_all_tools_uses_default_factory() -> None:
    first = _tool_context()
    second = _tool_context()

    first.all_tools.append({"name": "one"})

    assert second.all_tools == []


def _tool_context() -> ToolContext:
    return ToolContext(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        turn_id=1,
        project_id=1,
        conversation_id=1,
        response_queue=asyncio.Queue(),
        plan_editor=FakePlanEditor(),
    )
