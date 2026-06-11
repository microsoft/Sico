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

import asyncio

from app.biz.task_runtime.db_store import _task_run_from_json
from app.biz.task_runtime.models import SkillDispatch, TaskSpec, ToolDispatch, compute_idempotency_key
from app.biz.task_runtime.rerun_sources import compact_rerun_source_payload
from app.tools.common import ToolContext
from app.tools.plan import PlanEditor


class FakePlanEditor(PlanEditor):
    def __init__(self):
        pass


def _skill_task(task_id: str, *, title: str = "Run case", skill_name: str = "mock", **kwargs) -> TaskSpec:
    return TaskSpec(task_id=task_id, title=title, dispatch=SkillDispatch(skill_name=skill_name), **kwargs)


def test_idempotency_key_ignores_task_id() -> None:
    first = _skill_task("a", args={"case": {"id": 1}})
    second = _skill_task("b", args={"case": {"id": 1}})

    assert compute_idempotency_key(100, 1, 3, first) == compute_idempotency_key(100, 1, 3, second)


def test_idempotency_key_changes_with_conversation_id() -> None:
     task = _skill_task("t", args={"a": 1})
     assert compute_idempotency_key(1, 1, 0, task) != compute_idempotency_key(2, 1, 0, task)


def test_idempotency_key_is_stable_across_retries() -> None:
    """parent_tool_call_id may change on retry; the key must not."""
    task = _skill_task("t1", title="Same task", skill_name="s", args={"a": 1})

    # Both calls have identical inputs (conversation_id + turn_id + batch_item_index + task contents).
    key_first = compute_idempotency_key(100, 7, 0, task)
    key_retry = compute_idempotency_key(100, 7, 0, task)

    assert key_first == key_retry


def test_idempotency_key_changes_with_args() -> None:
    a = _skill_task("t", title="T", skill_name="s", args={"x": 1})
    b = _skill_task("t", title="T", skill_name="s", args={"x": 2})

    assert compute_idempotency_key(100, 1, 0, a) != compute_idempotency_key(100, 1, 0, b)


def test_explicit_idempotency_key_is_used_verbatim() -> None:
    task = _skill_task("t", title="T", skill_name="s", idempotency_key="caller-supplied-uuid-123")

    assert compute_idempotency_key(100, 99, 99, task) == "caller-supplied-uuid-123"


def test_explicit_idempotency_key_overrides_args_changes() -> None:
    """A caller-supplied key intentionally collapses different payloads."""
    a = _skill_task("t", title="T", skill_name="s", args={"x": 1}, idempotency_key="job-42")
    b = _skill_task("t", title="T", skill_name="s", args={"x": 999}, idempotency_key="job-42")

    assert compute_idempotency_key(100, 1, 0, a) == compute_idempotency_key(100, 1, 0, b)


def test_task_spec_dispatch_accessors_expose_dispatch_payload() -> None:
    tool_task = TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="echo"))
    skill_task = TaskSpec(
        task_id="s",
        title="S",
        dispatch=SkillDispatch(skill_name="android-test", action_name="run"),
    )

    assert tool_task.kind == "tool"
    assert tool_task.tool_name == "echo"
    assert tool_task.skill_name is None
    assert tool_task.action_name == ""

    assert skill_task.kind == "skill"
    assert skill_task.tool_name is None
    assert skill_task.skill_name == "android-test"
    assert skill_task.action_name == "run"


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
                "kind": "skill",
                "instructions": "Run the case",
                "skill_name": "android-test",
                "entrypoint": None,
                "tool_name": None,
                "args": {},
                "metadata": {
                    "capability": {"name": "android-test", "display": {"task_label": "Android test"}},
                    "display": {"task_label": "Android test"},
                    "user_label": "benchmark",
                },
                "required_sandbox": "emulator",
                "idempotency_key": "",
            }
        ]
    }

    compact = compact_rerun_source_payload(source)
    task = compact["tasks"][0]

    assert task == {
        "task_id": "case-1",
        "title": "Case 1",
        "kind": "skill",
        "instructions": "Run the case",
        "skill_name": "android-test",
        "metadata": {"user_label": "benchmark"},
        "required_sandbox": "emulator",
    }


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
                        "dispatch": {"type": "tool", "tool_name": "echo"}
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
