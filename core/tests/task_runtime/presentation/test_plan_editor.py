import asyncio
from types import SimpleNamespace

import pytest

from app.biz.chat.runtime_agent import ChatAgent
from app.schemas.conversation.plan import Plan, PlanStep, PlanStepStatus, ToolCall, ToolCallStatus
from app.tools.plan import (
    PlanEditor,
    _remove_tool_call,
    begin_tool_call_status_tracking,
    finish_tool_call_status_tracking,
    record_tool_call_for_status_tracking,
)


def test_plan_editor_allocates_after_existing_parent_and_batch_ids() -> None:
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    plan = Plan(
        steps=[
            PlanStep(
                title="Step",
                tool_calls=[
                    ToolCall(
                        tool_name="run_tasks",
                        tool_call_id=4,
                        sub_calls=[ToolCall(tool_name="TaskRun", tool_call_id=9)],
                    )
                ],
            )
        ]
    )

    assert editor._alloc_tool_call_id(plan) == 10


def test_plan_editor_resyncs_allocation_from_updated_plan() -> None:
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    first_plan = Plan(steps=[PlanStep(title="Step", tool_calls=[ToolCall(tool_name="one", tool_call_id=4)])])
    second_plan = Plan(steps=[PlanStep(title="Step", tool_calls=[ToolCall(tool_name="two", tool_call_id=10)])])

    assert editor._alloc_tool_call_id(first_plan) == 5
    assert editor._alloc_tool_call_id(second_plan) == 11


def test_remove_tool_call_removes_only_targeted_subtree() -> None:
    tool_calls = [
        ToolCall(
            tool_name="run_tasks",
            tool_call_id=4,
            sub_calls=[
                ToolCall(tool_name="first", tool_call_id=5),
                ToolCall(
                    tool_name="second",
                    tool_call_id=6,
                    sub_calls=[ToolCall(tool_name="nested", tool_call_id=7)],
                ),
            ],
        ),
        ToolCall(tool_name="other", tool_call_id=8),
    ]

    assert _remove_tool_call(tool_calls, 6, updated_at=123) == (6, 7)
    assert [tool_call.tool_call_id for tool_call in tool_calls] == [4, 8]
    assert [tool_call.tool_call_id for tool_call in tool_calls[0].sub_calls] == [5]
    assert tool_calls[0].updated_at == 123
    assert not _remove_tool_call(tool_calls, 99, updated_at=123)


@pytest.mark.asyncio
async def test_plan_editor_repair_tool_call_tree_notifies_after_fixed_id_write() -> None:
    class _Editor(PlanEditor):
        def __init__(self) -> None:
            super().__init__(agent_instance_id=1, username="alice@example.com", turn_id=1)
            self.notified = False

        async def _repair_tool_call_tree_locked(self, root: ToolCall, updater):
            assert root.tool_call_id == 4
            assert root.sub_calls[0].tool_call_id == 5
            return Plan(), True

        async def notify_plan_updated(self, plan: Plan) -> None:
            self.notified = True

    root = ToolCall(
        tool_name="run_tasks",
        tool_call_id=4,
        sub_calls=[ToolCall(tool_name="task", tool_call_id=5, tool_call_status=ToolCallStatus.PENDING)],
    )
    editor = _Editor()
    repaired = await editor.repair_tool_call_tree(root, lambda _plan, _current, _canonical, _now: None)

    assert repaired
    assert editor.notified


@pytest.mark.asyncio
async def test_plan_editor_repair_tool_call_tree_preserves_concurrent_fixed_id_trees(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_plan = Plan(steps=[PlanStep(title="Step", status=PlanStepStatus.IN_PROGRESS)])
    plan_lock = asyncio.Lock()
    write_count = 0

    def read_plan(*args, **kwargs):
        return stored_plan.model_copy(deep=True)

    def write_plan(plan: Plan) -> None:
        nonlocal stored_plan, write_count
        stored_plan = plan.model_copy(deep=True)
        write_count += 1

    monkeypatch.setattr("app.tools.plan._plan_lock", lambda *args, **kwargs: plan_lock)
    monkeypatch.setattr("app.tools.plan._read_plan_unlocked", read_plan)
    monkeypatch.setattr("app.tools.plan._write_plan_unlocked", write_plan)
    first = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    second = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)

    def tree(name: str, parent_id: int) -> ToolCall:
        return ToolCall(
            tool_name=name,
            tool_call_id=parent_id,
            sub_calls=[ToolCall(tool_name=f"{name}-child", tool_call_id=parent_id + 1)],
        )

    repaired = await asyncio.gather(
        first.repair_tool_call_tree(tree("first", 4), lambda _plan, _current, _canonical, _now: None),
        second.repair_tool_call_tree(tree("second", 6), lambda _plan, _current, _canonical, _now: None),
    )

    ids = [tool_call.tool_call_id for root in stored_plan.steps[0].tool_calls for tool_call in (root, *root.sub_calls)]
    assert all(repaired)
    assert write_count == 2
    assert len(ids) == len(set(ids)) == 4


@pytest.mark.asyncio
async def test_plan_editor_repair_tool_call_tree_rejects_id_conflict_without_writing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_plan = Plan(
        steps=[
            PlanStep(
                title="Step",
                status=PlanStepStatus.IN_PROGRESS,
                tool_calls=[ToolCall(tool_name="unrelated", tool_call_id=5)],
            )
        ]
    )
    plan_lock = asyncio.Lock()
    write_count = 0

    def read_plan(*args, **kwargs):
        return stored_plan.model_copy(deep=True)

    def write_plan(plan: Plan) -> None:
        nonlocal write_count
        write_count += 1

    monkeypatch.setattr("app.tools.plan._plan_lock", lambda *args, **kwargs: plan_lock)
    monkeypatch.setattr("app.tools.plan._read_plan_unlocked", read_plan)
    monkeypatch.setattr("app.tools.plan._write_plan_unlocked", write_plan)
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    root = ToolCall(
        tool_name="run_tasks",
        tool_call_id=4,
        sub_calls=[ToolCall(tool_name="task", tool_call_id=5)],
    )

    with pytest.raises(RuntimeError, match="tool-call id conflict"):
        await editor.repair_tool_call_tree(root, lambda _plan, _current, _canonical, _now: None)

    assert write_count == 0
    assert stored_plan.steps[0].tool_calls[0].tool_name == "unrelated"


@pytest.mark.asyncio
async def test_plan_editor_repair_tool_call_tree_does_not_write_after_callback_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_plan = Plan(
        steps=[
            PlanStep(
                title="Step",
                status=PlanStepStatus.IN_PROGRESS,
                tool_calls=[ToolCall(tool_name="original", tool_call_id=4)],
            )
        ]
    )
    plan_lock = asyncio.Lock()
    write_count = 0

    def read_plan(*args, **kwargs):
        return stored_plan.model_copy(deep=True)

    def write_plan(plan: Plan) -> None:
        nonlocal write_count
        write_count += 1

    monkeypatch.setattr("app.tools.plan._plan_lock", lambda *args, **kwargs: plan_lock)
    monkeypatch.setattr("app.tools.plan._read_plan_unlocked", read_plan)
    monkeypatch.setattr("app.tools.plan._write_plan_unlocked", write_plan)
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    canonical = ToolCall(tool_name="canonical", tool_call_id=4)

    def fail_repair(_plan: Plan, existing: ToolCall, desired: ToolCall, _now_ms: int) -> None:
        existing.tool_name = desired.tool_name
        raise RuntimeError("repair callback failed")

    with pytest.raises(RuntimeError, match="repair callback failed"):
        await editor.repair_tool_call_tree(canonical, fail_repair)

    assert write_count == 0
    assert stored_plan.steps[0].tool_calls[0].tool_name == "original"


@pytest.mark.asyncio
async def test_plan_editor_repair_tool_call_tree_updates_existing_root_atomically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_plan = Plan(
        steps=[
            PlanStep(
                title="Step",
                status=PlanStepStatus.IN_PROGRESS,
                tool_calls=[
                    ToolCall(
                        tool_name="run_tasks",
                        tool_call_id=4,
                        sub_calls=[ToolCall(tool_name="wrong", tool_call_id=5)],
                    )
                ],
            )
        ]
    )
    plan_lock = asyncio.Lock()
    write_count = 0

    def read_plan(*args, **kwargs):
        return stored_plan.model_copy(deep=True)

    def write_plan(plan: Plan) -> None:
        nonlocal stored_plan, write_count
        stored_plan = plan.model_copy(deep=True)
        write_count += 1

    monkeypatch.setattr("app.tools.plan._plan_lock", lambda *args, **kwargs: plan_lock)
    monkeypatch.setattr("app.tools.plan._read_plan_unlocked", read_plan)
    monkeypatch.setattr("app.tools.plan._write_plan_unlocked", write_plan)
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)
    canonical = ToolCall(
        tool_name="run_tasks",
        tool_call_id=4,
        sub_calls=[ToolCall(tool_name="correct", tool_call_id=5)],
    )

    def repair(_plan: Plan, existing: ToolCall, desired: ToolCall, _now_ms: int) -> None:
        existing.sub_calls[0].tool_name = desired.sub_calls[0].tool_name

    assert await editor.repair_tool_call_tree(canonical, repair)

    assert write_count == 1
    assert len(stored_plan.steps[0].tool_calls) == 1
    assert stored_plan.steps[0].tool_calls[0].sub_calls[0].tool_name == "correct"


@pytest.mark.asyncio
async def test_plan_editor_update_tool_call_tree_uses_one_atomic_mutation() -> None:
    class _Editor(PlanEditor):
        def __init__(self) -> None:
            super().__init__(agent_instance_id=1, username="alice@example.com", turn_id=1)
            self.received_id = 0

        async def _update_tool_call_tree_locked(self, tool_call_id: int, updater):
            self.received_id = tool_call_id
            plan = Plan(steps=[PlanStep(tool_calls=[ToolCall(tool_call_id=tool_call_id)])])
            updater(plan, plan.steps[0].tool_calls[0], 123)
            return plan, True

        async def notify_plan_updated(self, plan: Plan) -> None:
            return None

    editor = _Editor()

    assert await editor.update_tool_call_tree(4, lambda _plan, root, _now: setattr(root, "message", "done"))
    assert editor.received_id == 4


@pytest.mark.asyncio
async def test_plan_editor_remove_tool_call_clears_status_tracking() -> None:
    class _Editor(PlanEditor):
        def __init__(self) -> None:
            super().__init__(agent_instance_id=1, username="alice@example.com", turn_id=1)
            self.notified = False

        async def _remove_tool_call_locked(self, tool_call_id: int):
            assert tool_call_id == 4
            return Plan(), (4, 5)

        async def notify_plan_updated(self, plan: Plan) -> None:
            self.notified = True

    editor = _Editor()
    token = begin_tool_call_status_tracking()
    try:
        record_tool_call_for_status_tracking(4, ToolCallStatus.RUNNING)
        record_tool_call_for_status_tracking(5, ToolCallStatus.RUNNING)
        assert await editor.remove_tool_call(4)
    finally:
        tracked_ids = finish_tool_call_status_tracking(token)

    assert tracked_ids == []
    assert editor.notified


@pytest.mark.asyncio
async def test_plan_editor_remove_tool_call_skips_write_when_locked_predicate_rejects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_plan = Plan(
        steps=[
            PlanStep(
                status=PlanStepStatus.IN_PROGRESS,
                tool_calls=[ToolCall(tool_name="foreign", tool_call_id=4)],
            )
        ]
    )
    plan_lock = asyncio.Lock()
    write_count = 0

    def read_plan(*args, **kwargs):
        return stored_plan.model_copy(deep=True)

    def write_plan(plan: Plan) -> None:
        nonlocal write_count
        write_count += 1

    monkeypatch.setattr("app.tools.plan._plan_lock", lambda *args, **kwargs: plan_lock)
    monkeypatch.setattr("app.tools.plan._read_plan_unlocked", read_plan)
    monkeypatch.setattr("app.tools.plan._write_plan_unlocked", write_plan)
    editor = PlanEditor(agent_instance_id=1, username="alice@example.com", turn_id=1)

    removed = await editor.remove_tool_call(4, predicate=lambda _plan, _tool_call: False)

    assert not removed
    assert write_count == 0
    assert stored_plan.steps[0].tool_calls[0].tool_name == "foreign"


@pytest.mark.asyncio
async def test_finish_plan_ignores_untouched_existing_plan() -> None:
    class _Editor(PlanEditor):
        def __init__(self) -> None:
            super().__init__(agent_instance_id=1, username="alice@example.com", turn_id=1, conversation_id=10)
            self.plan = Plan(steps=[PlanStep(title="Old", status=PlanStepStatus.IN_PROGRESS)])
            self.updated = False

        async def get_plan(self):
            return self.plan

        async def update_plan(self, plan: Plan) -> None:
            self.updated = True
            self.plan = plan

    editor = _Editor()

    await ChatAgent._finish_plan(SimpleNamespace(_tool_context=SimpleNamespace(plan_editor=editor)))

    assert not editor.updated
    assert editor.plan.steps[0].status == PlanStepStatus.IN_PROGRESS
