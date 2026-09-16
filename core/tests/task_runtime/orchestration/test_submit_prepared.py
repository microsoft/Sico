"""Tests for prepared task-batch submission, execution, and duplicate observation."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
import shutil
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.storage.artifact_store import FileArtifactStore
from app.biz.task_runtime.execution.contracts import Executor
from app.biz.task_runtime.execution.command.local import LocalBackend
from app.biz.task_runtime.domain.models import (
    BatchStatus,
    ErrorClass,
    PreparedTaskBatch,
    TaskBatchInput,
    TaskDisplay,
    TaskResult,
    TaskStatus,
)
from app.biz.task_runtime.capabilities.builtin import BuiltinCapabilityProvider
from app.biz.task_runtime.capabilities.resolver import CapabilityResolver
from app.biz.task_runtime.capabilities.executor import CapabilityExecutor
from app.biz.task_runtime.manager import TaskManager
from app.biz.task_runtime.domain.models import CapabilityDispatch, SubAgentDispatch, TaskSpec
from app.biz.task_runtime.storage.file_store import FileRunStore
from app.biz.task_runtime.orchestration.materialization import _prepared_submission_fingerprint
from app.biz.task_runtime.presentation.port import BatchProjectionOptions
from app.biz.task_runtime.presentation.progress_sink import _TASK_RUNTIME_BATCH_ID_DISPLAY_KEY
from app.biz.task_runtime.workspace.layout import reset_workspace_layout, set_workspace_layout
from app.schemas.conversation.plan import (
    Plan,
    PlanStep,
    PlanStepStatus,
    ToolCall,
    ToolCallStatus,
    ToolDeliverable,
    ToolExecutionInfo,
    ToolType,
)
from app.biz.task_runtime.context import TurnContext
from app.tools.plan import PlanEditor


class _FakeWorkspaceLayout:
    def __init__(self, root: Path) -> None:
        self._root = root

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int = 0) -> Path:
        return self._root.parent / "turn" / str(turn_id)

    def workspace_path(self, agent_instance_id: int, username: str, *, conversation_id: int = 0) -> Path:
        return self._root


@pytest.fixture(autouse=True)
def _workspace_layout(tmp_path: Path, request: pytest.FixtureRequest) -> None:
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "workspace"))
    request.addfinalizer(lambda: reset_workspace_layout(token))


class _FakePlanEditor(PlanEditor):
    def __init__(self) -> None:
        self.plan: Plan | None = None
        self.next_tool_call_id = 0
        self.remove_failures_remaining = 0
        self.tree_update_failures_remaining = 0
        self.cancelled = False

    async def get_plan(self) -> Plan | None:
        return self.plan

    async def update_plan(self, plan: Plan) -> None:
        self.plan = plan

    async def create_tool_call(
        self,
        name,
        initial_message,
        execution_info=None,
        parent_tool_call_id=None,
        sub_call_index=0,
        display=None,
        tool_call_status=None,
    ):
        if self.plan is None:
            return 0
        self.next_tool_call_id += 1
        tool_call_id = self.next_tool_call_id
        status = ToolCallStatus.RUNNING if tool_call_status is None else tool_call_status
        tool_call = ToolCall(
            tool_name=name,
            message=initial_message,
            execution_info=execution_info or ToolExecutionInfo(),
            tool_call_id=tool_call_id,
            sub_call_index=sub_call_index,
            display=dict(display or {}),
            tool_call_status=status,
        )
        if parent_tool_call_id is None:
            if not self.plan.steps:
                self.plan.steps.append(PlanStep())
            self.plan.steps[0].tool_calls.append(tool_call)
        else:
            parent = self.plan.get_tool_call(parent_tool_call_id)
            if parent is None:
                return 0
            parent.sub_calls.append(tool_call)
        return tool_call_id

    async def repair_tool_call_tree(self, root: ToolCall, updater) -> bool:
        if self.plan is None:
            return False
        canonical = root.model_copy(deep=True)
        desired_ids = [tool_call.tool_call_id for tool_call in _walk_tool_call_tree(canonical)]
        if any(tool_call_id <= 0 for tool_call_id in desired_ids) or len(desired_ids) != len(set(desired_ids)):
            raise ValueError("repaired tool-call tree requires unique positive ids")
        snapshot = self.plan.model_copy(deep=True)
        desired_id_set = set(desired_ids)
        existing = next(
            (
                tool_call
                for step in self.plan.steps
                for tool_call in step.tool_calls
                if tool_call.tool_call_id == canonical.tool_call_id
            ),
            None,
        )
        try:
            if existing is None:
                current_ids = {
                    tool_call.tool_call_id
                    for step in self.plan.steps
                    for parent in step.tool_calls
                    for tool_call in _walk_tool_call_tree(parent)
                }
                if desired_id_set.intersection(current_ids):
                    raise RuntimeError("tool-call id conflict while repairing tree")
                if not self.plan.steps:
                    self.plan.steps.append(PlanStep())
                self.plan.steps[0].tool_calls.append(canonical)
                current = canonical
            else:
                outside_ids = {
                    tool_call.tool_call_id
                    for step in self.plan.steps
                    for parent in step.tool_calls
                    if parent is not existing
                    for tool_call in _walk_tool_call_tree(parent)
                }
                if desired_id_set.intersection(outside_ids):
                    raise RuntimeError("tool-call id conflict while repairing tree")
                current = existing
            updater(self.plan, current, canonical, 1)
            actual_ids = [
                tool_call.tool_call_id
                for step in self.plan.steps
                for parent in step.tool_calls
                for tool_call in _walk_tool_call_tree(parent)
            ]
            if any(actual_ids.count(tool_call_id) != 1 for tool_call_id in desired_ids):
                raise RuntimeError("invalid tool-call ids after repairing tree")
        except Exception:
            self.plan = snapshot
            raise
        return True

    async def update_tool_call_message(self, tool_call_id: int, message: str):
        def updater(tool_call):
            tool_call.message = message

        return await self.update_tool_call(tool_call_id, updater)

    async def update_tool_call(self, tool_call_id: int, updater):
        tool_call = self.plan.get_tool_call(tool_call_id) if self.plan is not None else None
        if tool_call is None:
            return None
        updater(tool_call)
        return tool_call

    async def update_tool_call_tree(self, tool_call_id: int, updater) -> bool:
        if self.tree_update_failures_remaining > 0:
            self.tree_update_failures_remaining -= 1
            raise ConnectionError("transient plan tree update failure")
        tool_call = self.plan.get_tool_call(tool_call_id) if self.plan is not None else None
        if tool_call is None:
            return False
        updater(self.plan, tool_call, 1)
        return True

    async def remove_tool_call(self, tool_call_id: int, *, predicate=None) -> bool:
        if self.remove_failures_remaining > 0:
            self.remove_failures_remaining -= 1
            raise ConnectionError("transient plan removal failure")
        if self.plan is None:
            return False
        tool_call = self.plan.get_tool_call(tool_call_id)
        if predicate is not None and (tool_call is None or not predicate(self.plan, tool_call)):
            return False

        def remove(tool_calls):
            for index, tool_call in enumerate(tool_calls):
                if tool_call.tool_call_id == tool_call_id:
                    tool_calls.pop(index)
                    return True
                if remove(tool_call.sub_calls):
                    return True
            return False

        removed = any(remove(step.tool_calls) for step in self.plan.steps)
        return removed

    async def notify_plan_updated(self, plan: Plan) -> None:
        self.plan = plan

    async def is_plan_cancelled(self) -> bool:
        return self.cancelled


def _walk_tool_call_tree(tool_call: ToolCall):
    yield tool_call
    for child in tool_call.sub_calls:
        yield from _walk_tool_call_tree(child)


def _turn_context(submission_id: str = "submission-1") -> TurnContext:
    return TurnContext(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        conversation_id=1,
        turn_id=1,
        plan_editor=_FakePlanEditor(),
        submission_id=submission_id,
    )


def _echo_task(task_id: str, message: str) -> TaskSpec:
    return TaskSpec(
        task_id=task_id,
        title=f"Echo {task_id}",
        dispatch=CapabilityDispatch(capability_id="builtin:echo"),
        args={"message": message},
    )


def test_submission_fingerprint_tracks_execution_semantics_only() -> None:
    original = _echo_task("task-1", "hello")
    original.display = TaskDisplay(plan_title="First title")
    original.metadata["general_planner"] = {"rationale": "first wording"}
    cosmetic_change = original.model_copy(deep=True)
    cosmetic_change.display.plan_title = "Different title"
    cosmetic_change.metadata["general_planner"] = {"rationale": "different wording"}
    execution_change = original.model_copy(deep=True)
    execution_change.args["message"] = "different payload"

    original_batch = PreparedTaskBatch(batch=TaskBatchInput(tasks=(original,)))
    cosmetic_batch = PreparedTaskBatch(batch=TaskBatchInput(tasks=(cosmetic_change,)))
    execution_batch = PreparedTaskBatch(batch=TaskBatchInput(tasks=(execution_change,)))
    concurrency_batch = PreparedTaskBatch(batch=TaskBatchInput(tasks=(original,), max_concurrency=1))

    assert _prepared_submission_fingerprint(original_batch, "adapter:general") == _prepared_submission_fingerprint(
        cosmetic_batch,
        "adapter:general",
    )
    assert _prepared_submission_fingerprint(original_batch, "adapter:general") != _prepared_submission_fingerprint(
        execution_batch,
        "adapter:general",
    )
    assert _prepared_submission_fingerprint(original_batch, "adapter:general") != _prepared_submission_fingerprint(
        original_batch,
        "adapter:workbook",
    )
    assert _prepared_submission_fingerprint(original_batch) != _prepared_submission_fingerprint(concurrency_batch)


def test_batch_projection_options_reject_contradictory_modes() -> None:
    with pytest.raises(ValueError, match="publish-only"):
        BatchProjectionOptions(publish_only=True, repair=True)
    with pytest.raises(ValueError, match="require settle_batch"):
        BatchProjectionOptions(recovering=True)


def test_submission_fingerprint_preserves_legacy_default_concurrency_shape() -> None:
    task = _echo_task("task-1", "hello")
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(task,)))
    legacy_payload = {
        "submission_source": "delegate",
        "tasks": [task.model_dump(mode="json", exclude={"display", "metadata"}, exclude_none=True)],
        "join_strategy": "partial_ok",
    }
    canonical = json.dumps(legacy_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    legacy_fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    assert _prepared_submission_fingerprint(prepared, "delegate") == legacy_fingerprint


def test_submission_fingerprint_normalizes_equivalent_sub_agent_grants() -> None:
    canonical = TaskSpec(
        task_id="task-1",
        title="Delegate",
        dispatch=SubAgentDispatch(capability_grants=["builtin:echo"]),
    )
    aliases = TaskSpec(
        task_id="task-1",
        title="Delegate",
        dispatch=SubAgentDispatch(capability_grants=["echo", "builtin:echo", "echo"]),
    )

    canonical_batch = PreparedTaskBatch(batch=TaskBatchInput(tasks=(canonical,)))
    aliases_batch = PreparedTaskBatch(batch=TaskBatchInput(tasks=(aliases,)))

    assert aliases.dispatch.capability_grants == ["builtin:echo"]
    assert _prepared_submission_fingerprint(canonical_batch) == _prepared_submission_fingerprint(aliases_batch)


def _tool_executor(tmp_path: Path) -> CapabilityExecutor:
    provider = BuiltinCapabilityProvider(
        artifact_store=FileArtifactStore(tmp_path / "artifacts"),
        command_backend=LocalBackend(),
    )
    return CapabilityExecutor(CapabilityResolver((provider,)))


class _FailingBatchLookupStore(FileRunStore):
    """Simulates a store read that fails for a reason other than "not found"."""

    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.fail_batch_lookup = False

    async def get_batch(self, batch_id: str):
        if self.fail_batch_lookup:
            raise ConnectionError(f"simulated backend outage for {batch_id}")
        return await super().get_batch(batch_id)


class _FailSecondRunCreationStore(FileRunStore):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.create_run_count = 0

    async def create_run(self, run) -> None:
        self.create_run_count += 1
        if self.create_run_count == 2:
            raise ConnectionError("simulated run materialization failure")
        await super().create_run(run)


class _CancelAfterBatchCreationStore(FileRunStore):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.cancel_after_create = True
        self.miss_next_batch_lookup = False
        self.batch_cancelled = asyncio.Event()
        self.materialization_observed = asyncio.Event()

    async def get_batch(self, batch_id: str):
        if self.miss_next_batch_lookup:
            self.miss_next_batch_lookup = False
            raise FileNotFoundError(f"simulated stale read for {batch_id}")
        batch = await super().get_batch(batch_id)
        if self.cancel_after_create:
            self.materialization_observed.set()
        return batch

    async def create_batch(self, batch) -> None:
        result = await super().create_batch(batch)
        if self.cancel_after_create:
            raise asyncio.CancelledError
        return result

    async def cancel_batch(self, batch_id: str, reason: str) -> None:
        await super().cancel_batch(batch_id, reason)
        self.batch_cancelled.set()


class _CancelBeforeLateBatchCommitStore(_CancelAfterBatchCreationStore):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.allow_commit = asyncio.Event()
        self.commit_task: asyncio.Task[None] | None = None

    async def create_batch(self, batch) -> None:
        async def commit_later() -> None:
            await self.allow_commit.wait()
            await FileRunStore.create_batch(self, batch)

        self.commit_task = asyncio.create_task(commit_later())
        raise asyncio.CancelledError


class _ErrorAfterBatchCreationStore(_CancelAfterBatchCreationStore):
    async def create_batch(self, batch) -> None:
        await FileRunStore.create_batch(self, batch)
        raise ConnectionError("create batch response lost")


class _TransientCleanupFailureStore(_FailSecondRunCreationStore):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.cancel_failures_remaining = 1

    async def cancel_run(self, run_id: str, reason: str) -> None:
        if self.cancel_failures_remaining > 0:
            self.cancel_failures_remaining -= 1
            raise ConnectionError("simulated transient cancellation failure")
        await super().cancel_run(run_id, reason)


class _BlockFailedBatchUpdateStore(FileRunStore):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.failed_update_started = asyncio.Event()
        self.stale_batch_read = asyncio.Event()
        self.release_failed_update = asyncio.Event()

    async def get_batch(self, batch_id: str):
        batch = await super().get_batch(batch_id)
        if self.failed_update_started.is_set() and not self.release_failed_update.is_set():
            self.stale_batch_read.set()
        return batch

    async def update_batch(self, batch) -> None:
        if batch.status == BatchStatus.FAILED:
            self.failed_update_started.set()
            await self.release_failed_update.wait()
        return await super().update_batch(batch)


class _BlockCompletedBatchUpdateStore(FileRunStore):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.completed_update_started = asyncio.Event()
        self.release_completed_update = asyncio.Event()

    async def update_batch(self, batch) -> None:
        if batch.status == BatchStatus.COMPLETED:
            self.completed_update_started.set()
            await self.release_completed_update.wait()
        return await super().update_batch(batch)


class _CountingExecutor:
    def __init__(self, inner: Executor) -> None:
        self.inner = inner
        self.run_count = 0

    async def run(self, run, store):
        self.run_count += 1
        return await self.inner.run(run, store)


class _BlockingExecutor(_CountingExecutor):
    def __init__(self, inner: Executor) -> None:
        super().__init__(inner)
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def run(self, run, store):
        self.started.set()
        await self.release.wait()
        return await super().run(run, store)


class _PartiallyBlockingExecutor(_CountingExecutor):
    def __init__(self, inner: Executor) -> None:
        super().__init__(inner)
        self.completed = asyncio.Event()
        self.blocked = asyncio.Event()
        self.release = asyncio.Event()

    async def run(self, run, store):
        if run.spec.task_id == "task-2":
            self.blocked.set()
            await self.release.wait()
        result = await super().run(run, store)
        if run.spec.task_id == "task-1":
            self.completed.set()
        return result


class _FixedStatusExecutor:
    def __init__(self, statuses: dict[str, TaskStatus]) -> None:
        self.statuses = statuses

    async def run(self, run, store):
        status = self.statuses[run.spec.task_id]
        return TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=status,
            title=run.spec.title,
            summary=status.value,
            error_class=None if status == TaskStatus.COMPLETED else ErrorClass.INTERNAL,
            error_message="" if status == TaskStatus.COMPLETED else status.value,
        )


class _MissNextBatchLookupStore(FileRunStore):
    miss_next_batch_lookup = False

    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.update_batch_count = 0

    async def get_batch(self, batch_id: str):
        if self.miss_next_batch_lookup:
            self.miss_next_batch_lookup = False
            raise FileNotFoundError(f"simulated stale read for {batch_id}")
        return await super().get_batch(batch_id)

    async def update_batch(self, batch):
        self.update_batch_count += 1
        return await super().update_batch(batch)


class _FailingDetailStore(FileRunStore):
    fail_run_id = ""
    detail_failures_remaining = 0

    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.detail_calls = 0
        self.list_batch_runs_calls = 0

    async def get_task_detail(self, run_id: str, view: str):
        self.detail_calls += 1
        if run_id == self.fail_run_id and self.detail_failures_remaining > 0:
            self.detail_failures_remaining -= 1
            raise ConnectionError("transient detail read failure")
        return await super().get_task_detail(run_id, view)

    async def list_batch_runs(self, batch_id: str):
        self.list_batch_runs_calls += 1
        return await super().list_batch_runs(batch_id)


def test_skill_sandbox_normalization_writes_the_authoritative_options() -> None:
    # required_sandbox arrives LLM-supplied and can name an OS the skill cannot
    # run on, so the registry overwrites it. What gets written must be the one OS
    # the field holds - the descriptor states a candidate *set*, and assigning
    # that set here would sail past TaskSpec (no validate_assignment) and only
    # surface later as "this task was prepared for ('android',)".
    from app.biz.task_runtime.capabilities.loader import CapabilityCard
    from app.biz.task_runtime.orchestration.execution_plan import ExecutionPlanner

    card = CapabilityCard(
        name="android-test.run",
        skill_name="android-test",
        action_name="run",
        infra_requirements=["sandbox.android"],
    )
    task = TaskSpec(
        task_id="t",
        title="T",
        dispatch=CapabilityDispatch(capability_id="skill:android-test.run"),
        required_sandbox=None,
    )
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(task,)))

    planner = ExecutionPlanner(
        SimpleNamespace(),
        1,
        SimpleNamespace(resolve=lambda _: card),
    )
    planner.normalize(prepared)

    assert task.required_sandbox == ["android"]
    assert task.selected_sandbox == "android"


@pytest.mark.asyncio
async def test_submit_prepared_executes_prepared_echo_batch(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=2)
    context = _turn_context()
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "hello"), _echo_task("task-2", "world")),
            join_strategy="partial_ok",
            description="Prepared echo batch.",
        ),
    )

    result = await manager.submit_prepared(context, prepared)

    assert result.completed_count == 2
    assert result.failed_count == 0
    step = context.plan_editor.plan.steps[0]
    assert step.status == PlanStepStatus.COMPLETED
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.tool_calls[0].display[_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY] == result.batch_id


@pytest.mark.asyncio
async def test_materialization_cancellation_settles_created_projection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    async def cancel_planning(*args, **kwargs):
        raise asyncio.CancelledError

    monkeypatch.setattr(manager.submitter._execution_planner, "plan", cancel_planning)

    with pytest.raises(asyncio.CancelledError):
        await manager.submit_prepared(context, prepared)

    step = context.plan_editor.plan.steps[0]
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.FAILED
    assert step.status == PlanStepStatus.CANCELLED
    assert await store.list_batches_by_turn(context.conversation_id, context.turn_id) == []


@pytest.mark.asyncio
async def test_materialization_cancellation_converges_owned_committed_batch(tmp_path: Path) -> None:
    store = _CancelAfterBatchCreationStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    with pytest.raises(asyncio.CancelledError):
        await manager.submit_prepared(context, prepared)

    await asyncio.wait_for(store.batch_cancelled.wait(), timeout=1)
    batches = await store.list_batches_by_turn(context.conversation_id, context.turn_id)
    step = context.plan_editor.plan.steps[0]
    assert len(batches) == 1
    assert batches[0].status == BatchStatus.CANCELLED
    assert await store.list_batch_runs(batches[0].batch_id) == []
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.FAILED
    assert step.status == PlanStepStatus.CANCELLED


@pytest.mark.asyncio
async def test_materialization_cancellation_converges_batch_committed_after_caller_returns(tmp_path: Path) -> None:
    store = _CancelBeforeLateBatchCommitStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    with pytest.raises(asyncio.CancelledError):
        await manager.submit_prepared(context, prepared)

    assert await store.list_batches_by_turn(context.conversation_id, context.turn_id) == []
    store.allow_commit.set()
    await asyncio.wait_for(store.batch_cancelled.wait(), timeout=1)
    if store.commit_task is not None:
        await store.commit_task

    batches = await store.list_batches_by_turn(context.conversation_id, context.turn_id)
    assert len(batches) == 1
    assert batches[0].status == BatchStatus.CANCELLED


@pytest.mark.asyncio
async def test_materialization_cancellation_does_not_cancel_another_owner_batch(tmp_path: Path) -> None:
    store = _CancelAfterBatchCreationStore(tmp_path / "turn" / "results")
    store.cancel_after_create = False
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(store, executor, max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    first = await manager.submit_prepared(context, prepared)
    store.miss_next_batch_lookup = True
    store.cancel_after_create = True

    with pytest.raises(asyncio.CancelledError):
        await manager.submit_prepared(context, prepared)

    await asyncio.wait_for(store.materialization_observed.wait(), timeout=1)
    async with asyncio.timeout(1):
        while len(context.plan_editor.plan.steps[0].tool_calls) != 1:
            await asyncio.sleep(0)
    batch = await store.get_batch(first.batch_id)
    assert batch.status == BatchStatus.COMPLETED
    assert executor.run_count == 1
    assert context.plan_editor.plan.steps[0].tool_calls[0].tool_call_id == batch.parent_tool_call_id


@pytest.mark.asyncio
async def test_materialization_error_converges_owned_committed_batch(tmp_path: Path) -> None:
    store = _ErrorAfterBatchCreationStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    with pytest.raises(ConnectionError, match="create batch response lost"):
        await manager.submit_prepared(context, prepared)

    await asyncio.wait_for(store.batch_cancelled.wait(), timeout=1)
    batch = (await store.list_batches_by_turn(context.conversation_id, context.turn_id))[0]
    step = context.plan_editor.plan.steps[0]
    assert batch.status == BatchStatus.CANCELLED
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.FAILED
    assert step.status == PlanStepStatus.CANCELLED


@pytest.mark.asyncio
async def test_owner_reconciles_children_after_transient_projection_failures(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    context.plan_editor.tree_update_failures_remaining = 3
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    result = await manager.submit_prepared(context, prepared)

    step = context.plan_editor.plan.steps[0]
    parent = step.tool_calls[0]
    assert result.status == BatchStatus.COMPLETED
    assert context.plan_editor.tree_update_failures_remaining == 0
    assert parent.tool_call_status == ToolCallStatus.SUCCESSFUL
    assert parent.sub_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("statuses", "expected_batch_status", "expected_step_status"),
    [
        (
            {"task-1": TaskStatus.COMPLETED, "task-2": TaskStatus.FAILED},
            BatchStatus.PARTIAL,
            PlanStepStatus.COMPLETED,
        ),
        ({"task-1": TaskStatus.TIMED_OUT}, BatchStatus.TIMED_OUT, PlanStepStatus.FAILED),
        ({"task-1": TaskStatus.BLOCKED}, BatchStatus.BLOCKED, PlanStepStatus.FAILED),
    ],
)
async def test_terminal_batch_status_is_not_reclassified_when_projection_reconciliation_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    statuses: dict[str, TaskStatus],
    expected_batch_status: BatchStatus,
    expected_step_status: PlanStepStatus,
) -> None:
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _FixedStatusExecutor(statuses), max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=tuple(_echo_task(task_id, task_id) for task_id in statuses)),
    )
    context = _turn_context()
    reconciliation_calls = 0

    async def fail_reconciliation(*args, **kwargs):
        nonlocal reconciliation_calls
        reconciliation_calls += 1
        raise RuntimeError("projection failed")

    monkeypatch.setattr(manager.submitter._progress, "sync_batch_projection", fail_reconciliation)

    result = await manager.submit_prepared(context, prepared)

    batches = await store.list_batches_by_turn(1, 1)
    step = context.plan_editor.plan.steps[0]
    assert len(batches) == 1
    assert reconciliation_calls == 3
    assert result.status == expected_batch_status
    assert batches[0].status == expected_batch_status
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.FAILED
    assert step.status == expected_step_status


@pytest.mark.asyncio
async def test_late_cancellation_does_not_rewrite_terminal_batch(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    async def cancel_reconciliation(*args, **kwargs):
        raise asyncio.CancelledError

    manager.submitter._progress.sync_batch_projection = cancel_reconciliation

    with pytest.raises(asyncio.CancelledError):
        await manager.submit_prepared(context, prepared)

    batch = (await store.list_batches_by_turn(1, 1))[0]
    step = context.plan_editor.plan.steps[0]
    assert batch.status == BatchStatus.COMPLETED
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_cancel_turn_settles_parent_and_plan_step(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = _BlockingExecutor(_tool_executor(tmp_path))
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()
    projection_options: list[BatchProjectionOptions] = []
    sync_batch_projection = manager.progress.sync_batch_projection

    async def record_projection_sync(*args, **kwargs):
        projection_options.append(kwargs["options"])
        return await sync_batch_projection(*args, **kwargs)

    monkeypatch.setattr(manager.progress, "sync_batch_projection", record_projection_sync)

    try:
        assert await manager.cancel_turn(context) == 1
        batch = (await store.list_batches_by_turn(context.conversation_id, context.turn_id))[0]
        step = context.plan_editor.plan.steps[0]
        parent = step.tool_calls[0]
        assert batch.status == BatchStatus.CANCELLED
        assert batch.counts["cancelled"] == 1
        assert parent.tool_call_status == ToolCallStatus.FAILED
        assert parent.sub_calls[0].tool_call_status == ToolCallStatus.FAILED
        assert step.status == PlanStepStatus.CANCELLED
        assert projection_options == [BatchProjectionOptions.cancellation()]
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.status == BatchStatus.CANCELLED


@pytest.mark.asyncio
async def test_cancel_turn_does_not_settle_active_sibling_tool_call(tmp_path: Path) -> None:
    executor = _BlockingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()
    step = context.plan_editor.plan.steps[0]
    sibling = ToolCall(tool_name="Still running", tool_call_id=999, tool_call_status=ToolCallStatus.RUNNING)
    step.tool_calls.append(sibling)

    try:
        assert await manager.cancel_turn(context) == 1
        parent = step.tool_calls[0]
        assert parent.tool_call_status == ToolCallStatus.FAILED
        assert parent.sub_calls[0].tool_call_status == ToolCallStatus.FAILED
        assert sibling.tool_call_status == ToolCallStatus.RUNNING
        assert step.status == PlanStepStatus.IN_PROGRESS
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.status == BatchStatus.CANCELLED


@pytest.mark.asyncio
async def test_cancel_turn_falls_back_for_incomplete_result_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = _BlockingExecutor(_tool_executor(tmp_path))
    store = _FailingDetailStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()
    run = (await store.list_batch_runs((await store.list_batches_by_turn(1, 1))[0].batch_id))[0]
    store.fail_run_id = run.run_id
    store.detail_failures_remaining = 1
    projection_sync_calls = 0
    sync_batch_projection = manager.progress.sync_batch_projection

    async def record_projection_sync(*args, **kwargs):
        nonlocal projection_sync_calls
        projection_sync_calls += 1
        return await sync_batch_projection(*args, **kwargs)

    monkeypatch.setattr(manager.progress, "sync_batch_projection", record_projection_sync)

    try:
        assert await manager.cancel_turn(context) == 1
        step = context.plan_editor.plan.steps[0]
        parent = step.tool_calls[0]
        assert projection_sync_calls == 0
        assert parent.tool_call_status == ToolCallStatus.FAILED
        assert parent.sub_calls[0].tool_call_status == ToolCallStatus.FAILED
        assert step.status == PlanStepStatus.CANCELLED
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.status == BatchStatus.CANCELLED


@pytest.mark.asyncio
async def test_cancel_turn_falls_back_when_projection_sync_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = _BlockingExecutor(_tool_executor(tmp_path))
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()

    async def fail_projection_sync(*args, **kwargs):
        raise ConnectionError("projection store unavailable")

    monkeypatch.setattr(manager.progress, "sync_batch_projection", fail_projection_sync)

    try:
        assert await manager.cancel_turn(context) == 1
        step = context.plan_editor.plan.steps[0]
        parent = step.tool_calls[0]
        assert parent.tool_call_status == ToolCallStatus.FAILED
        assert parent.sub_calls[0].tool_call_status == ToolCallStatus.FAILED
        assert step.status == PlanStepStatus.CANCELLED
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.status == BatchStatus.CANCELLED


@pytest.mark.asyncio
async def test_owner_cancellation_uses_single_authoritative_batch_transition(tmp_path: Path) -> None:
    executor = _BlockingExecutor(_tool_executor(tmp_path))
    store = _MissNextBatchLookupStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()

    owner.cancel()
    with pytest.raises(asyncio.CancelledError):
        await owner

    batch = (await store.list_batches_by_turn(context.conversation_id, context.turn_id))[0]
    assert batch.status == BatchStatus.CANCELLED
    assert store.update_batch_count == 1
    assert context.plan_editor.plan.steps[0].status == PlanStepStatus.CANCELLED


@pytest.mark.asyncio
async def test_submit_prepared_converges_runs_after_partial_materialization_failure(tmp_path: Path) -> None:
    store = _TransientCleanupFailureStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "hello"), _echo_task("task-2", "world")),
            description="Partially materialized batch.",
        ),
    )

    with pytest.raises(ConnectionError, match="simulated run materialization failure"):
        await manager.submit_prepared(context, prepared)

    batches = await store.list_batches_by_turn(context.conversation_id, context.turn_id)
    assert len(batches) == 1
    assert batches[0].status == BatchStatus.FAILED
    runs = await store.list_batch_runs(batches[0].batch_id)
    assert len(runs) == 1
    assert runs[0].status == TaskStatus.CANCELLED
    assert store.cancel_failures_remaining == 0
    step = context.plan_editor.plan.steps[0]
    assert step.status == PlanStepStatus.FAILED
    assert step.tool_calls[0].tool_call_status == ToolCallStatus.FAILED
    assert all(child.tool_call_status == ToolCallStatus.FAILED for child in step.tool_calls[0].sub_calls)


@pytest.mark.asyncio
async def test_duplicate_submission_respects_failed_batch_after_owner_cancels_active_runs(tmp_path: Path) -> None:
    store = _BlockFailedBatchUpdateStore(tmp_path / "turn" / "results")
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(store, executor, max_concurrency=2)
    context = _turn_context()
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two"))),
    )

    async def fail_execution(*args, **kwargs):
        raise RuntimeError("scheduler failed")

    manager.submitter._staged_executor.run = fail_execution
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await store.failed_update_started.wait()
    duplicate_task = asyncio.create_task(manager.submit_prepared(context, prepared))
    await store.stale_batch_read.wait()
    store.release_failed_update.set()

    with pytest.raises(RuntimeError, match="scheduler failed"):
        await owner
    duplicate = await duplicate_task
    batch = (await store.list_batches_by_turn(context.conversation_id, context.turn_id))[0]
    runs = await store.list_batch_runs(batch.batch_id)

    assert batch.status == BatchStatus.FAILED
    assert all(run.status == TaskStatus.CANCELLED for run in runs)
    assert duplicate.status == BatchStatus.FAILED
    assert duplicate.cancelled_count == 2
    assert executor.run_count == 0


@pytest.mark.asyncio
async def test_submit_prepared_persists_compact_rerun_source(tmp_path: Path) -> None:
    turn_path = tmp_path / "turn" / "1"
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "hello"),),
            join_strategy="all_success",
            max_concurrency=1,
            description="Repeatable echo batch.",
        ),
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    source_path = turn_path / "rerun_sources" / f"{result.batch_id}.json"
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    assert payload == {
        "schema_version": 1,
        "turn_id": 1,
        "conversation_id": 1,
        "batch_id": result.batch_id,
        "submission_id": "submission-1",
        "reason": "Repeatable echo batch.",
        "join_strategy": "all_success",
        "task_count": 1,
        "created_at": payload["created_at"],
        "tasks": [
            {
                "task_id": "task-1",
                "title": "Echo task-1",
                "dispatch": {"type": "capability", "capability_id": "builtin:echo"},
                "args": {"message": "hello"},
                "stage": 0,
            }
        ],
        "max_concurrency": 1,
    }


@pytest.mark.asyncio
async def test_rerun_source_does_not_persist_transient_runtime_concurrency(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    result = await manager.submit_prepared(_turn_context(), prepared)

    source_path = tmp_path / "turn" / "1" / "rerun_sources" / f"{result.batch_id}.json"
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    assert "max_concurrency" not in payload


@pytest.mark.asyncio
async def test_submit_prepared_skips_oversized_rerun_source_without_failing_batch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.biz.task_runtime.orchestration.materialization.RERUN_SOURCE_MAX_BYTES", 1)
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))

    result = await manager.submit_prepared(_turn_context(), prepared)

    source_path = tmp_path / "turn" / "1" / "rerun_sources" / f"{result.batch_id}.json"
    assert result.completed_count == 1
    assert not source_path.exists()


@pytest.mark.asyncio
async def test_submit_prepared_preserves_caller_supplied_batch_metadata(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "ok"),),
            description="Single task.",
        ),
        batch_metadata={"source": "request-builder", "trace_id": "abc-123"},
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    batch = await manager.store.get_batch(result.batch_id)
    assert batch is not None
    assert batch.metadata["source"] == "request-builder"
    assert batch.metadata["trace_id"] == "abc-123"
    assert batch.metadata["_task_runtime"]["submission_id"] == "submission-1"


@pytest.mark.asyncio
async def test_submit_prepared_uses_caller_join_strategy(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "fast"),),
            join_strategy="first_success",
            description="First-success batch.",
        ),
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    assert result.completed_count == 1


@pytest.mark.asyncio
async def test_submit_prepared_uses_caller_concurrency_cap(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=5)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two")),
            max_concurrency=1,
        )
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    batch = await manager.store.get_batch(result.batch_id)
    assert batch is not None
    assert batch.max_concurrency == 1


@pytest.mark.asyncio
async def test_submit_prepared_reuses_duplicate_but_executes_new_submission(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    store = _MissNextBatchLookupStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "again"),),
            description="Duplicate-safe batch.",
        ),
    )
    rerun_prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "changed for intentional rerun"),),
            description="Intentional rerun batch.",
        ),
    )

    duplicate_context = _turn_context("submission-1")
    first = await manager.submit_prepared(duplicate_context, prepared)
    updates_after_first = store.update_batch_count
    plan_calls_after_first = len(duplicate_context.plan_editor.plan.steps[0].tool_calls)
    store.miss_next_batch_lookup = True
    duplicate = await manager.submit_prepared(duplicate_context, prepared)
    rerun = await manager.submit_prepared(_turn_context("submission-2"), rerun_prepared)

    assert duplicate.batch_id == first.batch_id
    assert rerun.batch_id != first.batch_id
    assert executor.run_count == 2
    assert store.update_batch_count == updates_after_first + 1
    assert len(duplicate_context.plan_editor.plan.steps[0].tool_calls) == plan_calls_after_first


@pytest.mark.asyncio
async def test_submit_prepared_retries_provisional_projection_removal(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    store = _MissNextBatchLookupStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "again"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    store.miss_next_batch_lookup = True
    context.plan_editor.remove_failures_remaining = 1
    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.completed_count == 1
    assert executor.run_count == 1
    assert context.plan_editor.remove_failures_remaining == 0
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1
    assert context.plan_editor.plan.steps[0].status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_duplicate_submission_resettles_step_after_late_provisional_removal(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    store = _MissNextBatchLookupStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "again"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    store.miss_next_batch_lookup = True
    context.plan_editor.remove_failures_remaining = 3
    context.plan_editor.tree_update_failures_remaining = 1
    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.completed_count == 1
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1
    assert context.plan_editor.plan.steps[0].status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_duplicate_submission_settles_provisional_parent_when_removal_keeps_failing(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    store = _MissNextBatchLookupStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "again"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    store.miss_next_batch_lookup = True
    context.plan_editor.remove_failures_remaining = 6
    duplicate = await manager.submit_prepared(context, prepared)

    parents = context.plan_editor.plan.steps[0].tool_calls
    assert duplicate.completed_count == 1
    assert executor.run_count == 1
    assert len(parents) == 2
    assert parents[-1].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert context.plan_editor.plan.steps[0].status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_duplicate_submission_reuses_complete_plan_projection(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    first = await manager.submit_prepared(context, prepared)
    tool_call_count = context.plan_editor.next_tool_call_id
    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.batch_id == first.batch_id
    assert executor.run_count == 1
    assert context.plan_editor.next_tool_call_id == tool_call_count
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1


@pytest.mark.asyncio
async def test_duplicate_submission_does_not_mirror_observer_timeout_to_owner_projection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    executor = _BlockingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()
    monkeypatch.setattr(submitter_module, "_reuse_wait_timeout_seconds", lambda _run: 0)
    monkeypatch.setattr(submitter_module, "_EXISTING_BATCH_RESULT_POLL_SECONDS", 0)

    try:
        duplicate = await manager.submit_prepared(context, prepared)
        step = context.plan_editor.plan.steps[0]
        assert duplicate.blocked_count == 1
        assert len(step.tool_calls) == 1
        assert step.tool_calls[0].tool_call_status == ToolCallStatus.RUNNING
        assert step.tool_calls[0].sub_calls[0].tool_call_status == ToolCallStatus.RUNNING
        assert step.status == PlanStepStatus.IN_PROGRESS
    finally:
        executor.release.set()
        owner_result = await owner
    assert owner_result.completed_count == 1


@pytest.mark.asyncio
async def test_duplicate_submission_with_partial_observation_returns_blocked(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    executor = _PartiallyBlockingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "done"), _echo_task("task-2", "waiting")),
            description="Partially observed duplicate-safe batch.",
        ),
    )
    context = _turn_context("submission-1")
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await asyncio.gather(executor.completed.wait(), executor.blocked.wait())
    monkeypatch.setattr(submitter_module, "_reuse_wait_timeout_seconds", lambda _run: 0.01)
    monkeypatch.setattr(submitter_module, "_EXISTING_BATCH_RESULT_POLL_SECONDS", 0)

    try:
        duplicate = await manager.submit_prepared(context, prepared)
        assert duplicate.status == BatchStatus.BLOCKED
        assert duplicate.completed_count == 1
        assert duplicate.blocked_count == 1
        assert context.plan_editor.plan.steps[0].status == PlanStepStatus.IN_PROGRESS
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.completed_count == 2


@pytest.mark.asyncio
async def test_duplicate_submission_timeout_tolerates_projection_write_failures(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    executor = _PartiallyBlockingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "done"), _echo_task("task-2", "waiting"))),
    )
    context = _turn_context("submission-1")
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await asyncio.gather(executor.completed.wait(), executor.blocked.wait())
    monkeypatch.setattr(submitter_module, "_reuse_wait_timeout_seconds", lambda _run: 0.01)
    monkeypatch.setattr(submitter_module, "_EXISTING_BATCH_RESULT_POLL_SECONDS", 0)
    sync_batch_projection = manager.progress.sync_batch_projection
    failed_updates = 0

    async def fail_observer_update(*args, **kwargs):
        nonlocal failed_updates
        options = kwargs.get("options")
        if options is not None and not options.publish_only and not options.repair:
            failed_updates += 1
            raise ConnectionError("plan store unavailable")
        return await sync_batch_projection(*args, **kwargs)

    monkeypatch.setattr(manager.progress, "sync_batch_projection", fail_observer_update)

    try:
        duplicate = await manager.submit_prepared(context, prepared)
        assert duplicate.status == BatchStatus.BLOCKED
        assert duplicate.completed_count == 1
        assert duplicate.blocked_count == 1
        assert failed_updates == 3
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.completed_count == 2


@pytest.mark.asyncio
async def test_duplicate_submission_does_not_settle_plan_before_authoritative_batch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    store = _BlockCompletedBatchUpdateStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await store.completed_update_started.wait()
    monkeypatch.setattr(submitter_module, "_reuse_wait_timeout_seconds", lambda _run: 0.01)
    monkeypatch.setattr(submitter_module, "_EXISTING_BATCH_RESULT_POLL_SECONDS", 0)

    try:
        duplicate = await manager.submit_prepared(context, prepared)
        step = context.plan_editor.plan.steps[0]
        assert duplicate.status == BatchStatus.BLOCKED
        assert duplicate.completed_count == 1
        assert step.tool_calls[0].tool_call_status == ToolCallStatus.RUNNING
        assert step.tool_calls[0].sub_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
        assert step.status == PlanStepStatus.IN_PROGRESS
    finally:
        store.release_completed_update.set()
        owner_result = await owner

    assert owner_result.status == BatchStatus.COMPLETED
    assert context.plan_editor.plan.steps[0].status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_owner_adopts_authoritative_cancellation_during_finalization(tmp_path: Path) -> None:
    store = _BlockCompletedBatchUpdateStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context()
    prepared = PreparedTaskBatch(batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),)))
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await store.completed_update_started.wait()

    assert await manager.cancel_turn(context) == 1
    store.release_completed_update.set()
    owner_result = await owner

    batch = (await store.list_batches_by_turn(context.conversation_id, context.turn_id))[0]
    step = context.plan_editor.plan.steps[0]
    parent = step.tool_calls[0]
    assert owner_result.status == BatchStatus.CANCELLED
    assert owner_result.completed_count == 1
    assert batch.status == BatchStatus.CANCELLED
    assert batch.counts["completed"] == 1
    assert parent.tool_call_status == ToolCallStatus.FAILED
    assert parent.sub_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.CANCELLED


@pytest.mark.asyncio
async def test_duplicate_submission_timeout_does_not_create_failed_fallback_projection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    executor = _BlockingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()
    context.plan_editor.plan.steps[0].tool_calls.clear()
    monkeypatch.setattr(submitter_module, "_reuse_wait_timeout_seconds", lambda _run: 0)
    monkeypatch.setattr(submitter_module, "_EXISTING_BATCH_RESULT_POLL_SECONDS", 0)

    try:
        duplicate = await manager.submit_prepared(context, prepared)
        step = context.plan_editor.plan.steps[0]
        assert duplicate.blocked_count == 1
        assert step.status == PlanStepStatus.IN_PROGRESS
        assert step.tool_calls == []
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.completed_count == 1
    assert context.plan_editor.plan.steps[0].status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_duplicate_submission_timeout_only_terminalizes_unremovable_provisional_projection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    executor = _BlockingExecutor(_tool_executor(tmp_path))
    store = _MissNextBatchLookupStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")
    owner = asyncio.create_task(manager.submit_prepared(context, prepared))
    await executor.started.wait()
    owner_parent = context.plan_editor.plan.steps[0].tool_calls[0]
    owner_parent_id = owner_parent.tool_call_id
    owner_child_id = owner_parent.sub_calls[0].tool_call_id
    store.miss_next_batch_lookup = True
    context.plan_editor.remove_failures_remaining = 6
    monkeypatch.setattr(submitter_module, "_reuse_wait_timeout_seconds", lambda _run: 0)
    monkeypatch.setattr(submitter_module, "_EXISTING_BATCH_RESULT_POLL_SECONDS", 0)

    try:
        duplicate = await manager.submit_prepared(context, prepared)
        step = context.plan_editor.plan.steps[0]
        parents = step.tool_calls
        assert duplicate.blocked_count == 1
        assert len(parents) == 2
        assert context.plan_editor.next_tool_call_id == 3
        assert parents[0].tool_call_id == owner_parent_id
        assert parents[0].tool_call_status == ToolCallStatus.RUNNING
        assert parents[0].sub_calls[0].tool_call_id == owner_child_id
        assert parents[0].sub_calls[0].tool_call_status == ToolCallStatus.RUNNING
        assert parents[1].tool_call_status == ToolCallStatus.FAILED
        assert parents[1].sub_calls == []
        assert step.status == PlanStepStatus.IN_PROGRESS
    finally:
        executor.release.set()
        owner_result = await owner

    assert owner_result.completed_count == 1
    assert context.plan_editor.plan.steps[0].status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_duplicate_submission_rebuilds_mismatched_plan_projection(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    original_parent = context.plan_editor.plan.steps[0].tool_calls[0]
    original_parent_id = original_parent.tool_call_id
    original_child_id = original_parent.sub_calls[0].tool_call_id
    original_child = original_parent.sub_calls[0]
    original_child.tool_name = "Wrong task"
    original_child.deliverables = [ToolDeliverable(markdown_title="Keep me")]
    original_child.sub_calls = [ToolCall(tool_name="nested", tool_call_id=100)]
    first_duplicate = await manager.submit_prepared(context, prepared)
    second_duplicate = await manager.submit_prepared(context, prepared)

    parents = context.plan_editor.plan.steps[0].tool_calls
    assert first_duplicate.completed_count == 1
    assert second_duplicate.completed_count == 1
    assert executor.run_count == 1
    assert len(parents) == 1
    assert parents[0].tool_call_id == original_parent_id
    assert parents[0].sub_calls[0].tool_call_id == original_child_id
    assert parents[0].sub_calls[0].tool_name == "Echo task-1"
    assert parents[0].sub_calls[0].deliverables[0].markdown_title == "Keep me"
    assert parents[0].sub_calls[0].sub_calls[0].tool_call_id == 100


@pytest.mark.asyncio
async def test_duplicate_submission_atomically_marks_exact_legacy_projection(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    first = await manager.submit_prepared(context, prepared)
    parent = context.plan_editor.plan.steps[0].tool_calls[0]
    parent.display.pop(_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY)
    batch = await manager.store.get_batch(first.batch_id)
    runs = await manager.store.list_batch_runs(first.batch_id)

    assert await manager.submitter._progress.sync_batch_projection(
        context,
        batch,
        runs,
        [],
        options=BatchProjectionOptions(publish_only=True),
    )
    assert _TASK_RUNTIME_BATCH_ID_DISPLAY_KEY not in parent.display

    duplicate = await manager.submit_prepared(context, prepared)

    parent = context.plan_editor.plan.steps[0].tool_calls[0]
    assert duplicate.batch_id == first.batch_id
    assert executor.run_count == 1
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1
    assert parent.display[_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY] == first.batch_id


@pytest.mark.asyncio
async def test_recovery_reconciliation_atomically_upgrades_legacy_projection(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    result = await manager.submit_prepared(context, prepared)
    batch = await store.get_batch(result.batch_id)
    runs = await store.list_batch_runs(result.batch_id)
    step = context.plan_editor.plan.steps[0]
    parent = step.tool_calls[0]
    parent.display.pop(_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY)
    parent.tool_call_status = ToolCallStatus.RUNNING
    parent.sub_calls[0].tool_call_status = ToolCallStatus.RUNNING
    step.status = PlanStepStatus.IN_PROGRESS
    progress = manager.submitter._progress

    assert await progress.sync_batch_projection(
        context,
        batch,
        runs,
        result.results,
        options=BatchProjectionOptions(
            settle_batch=True,
            allow_unmarked=True,
            finish_unstarted_tail=True,
            recovering=True,
        ),
    )

    assert parent.display[_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY] == batch.batch_id
    assert parent.tool_call_status == ToolCallStatus.SUCCESSFUL
    assert parent.sub_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
@pytest.mark.parametrize("foreign_batch_id", [None, "batch-foreign"])
async def test_duplicate_submission_does_not_overwrite_ambiguous_fixed_id_parent(
    tmp_path: Path,
    foreign_batch_id: str | None,
) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    parent_id = context.plan_editor.plan.steps[0].tool_calls[0].tool_call_id
    foreign_display = (
        {_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY: foreign_batch_id}
        if foreign_batch_id is not None
        else {}
    )
    context.plan_editor.plan.steps[0].tool_calls[0] = ToolCall(
        tool_name="Run Tasks",
        execution_info=ToolExecutionInfo(tool_type=ToolType.BUILTIN, builtin_tool_name="run_tasks"),
        tool_call_id=parent_id,
        display=foreign_display,
        sub_calls=[ToolCall(tool_name="Foreign task", tool_call_id=99)],
    )
    before_duplicate = context.plan_editor.plan.model_copy(deep=True)

    with pytest.raises(RuntimeError, match="belongs to"):
        await manager.submit_prepared(context, prepared)

    assert executor.run_count == 1
    assert context.plan_editor.plan == before_duplicate


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", ["foreign_marker", "duplicate_parent_id"])
async def test_parent_projection_mutations_reject_ambiguous_ownership(
    tmp_path: Path,
    corruption: str,
) -> None:
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context("submission-1")
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    result = await manager.submit_prepared(context, prepared)
    batch = await store.get_batch(result.batch_id)
    runs = await store.list_batch_runs(result.batch_id)
    parent = context.plan_editor.plan.steps[0].tool_calls[0]
    if corruption == "foreign_marker":
        parent.display[_TASK_RUNTIME_BATCH_ID_DISPLAY_KEY] = "batch-foreign"
    else:
        parent.sub_calls[0].sub_calls.append(
            ToolCall(tool_name="duplicate parent id", tool_call_id=parent.tool_call_id)
        )
    before_mutations = context.plan_editor.plan.model_copy(deep=True)
    progress = manager.submitter._progress

    assert not await progress.remove_delegate_tasks_call(
        context,
        parent.tool_call_id,
        batch_id=batch.batch_id,
    )
    with pytest.raises(RuntimeError, match="not owned by batch"):
        await progress.mark_delegate_tasks_terminal(
            context,
            parent.tool_call_id,
            BatchStatus.COMPLETED,
            batch_id=batch.batch_id,
        )
    with pytest.raises(RuntimeError, match="not owned by batch"):
        await progress.mark_delegate_tasks_failed(
            context,
            parent.tool_call_id,
            batch_id=batch.batch_id,
        )
    await progress.publish_parent_batch_progress(context, batch, runs)
    with pytest.raises(RuntimeError, match="not owned by batch"):
        await progress.mark_parent_step_terminal_if_settled(
            context,
            parent.tool_call_id,
            batch.status,
            batch_id=batch.batch_id,
        )

    assert context.plan_editor.plan == before_mutations


@pytest.mark.asyncio
async def test_duplicate_submission_repairs_reordered_projection_children(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two"))),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    parent = context.plan_editor.plan.steps[0].tool_calls[0]
    original_ids = [child.tool_call_id for child in parent.sub_calls]
    parent.sub_calls.reverse()

    duplicate = await manager.submit_prepared(context, prepared)

    parent = context.plan_editor.plan.steps[0].tool_calls[0]
    assert duplicate.completed_count == 2
    assert executor.run_count == 2
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1
    assert [child.tool_call_id for child in parent.sub_calls] == original_ids
    assert [child.sub_call_index for child in parent.sub_calls] == [0, 1]


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict_with_parent", [False, True])
async def test_duplicate_submission_rejects_conflicting_persisted_projection_ids(
    tmp_path: Path,
    conflict_with_parent: bool,
) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two"))),
    )
    context = _turn_context("submission-1")

    first = await manager.submit_prepared(context, prepared)
    batch = await manager.store.get_batch(first.batch_id)
    runs = await manager.store.list_batch_runs(first.batch_id)
    conflicting_id = batch.parent_tool_call_id if conflict_with_parent else runs[0].plan_batch_call_id
    runs[1].plan_batch_call_id = conflicting_id
    await manager.store.update_run(runs[1])

    with pytest.raises((RuntimeError, ValueError), match="tool-call id|unique positive ids"):
        await manager.submit_prepared(context, prepared)

    assert executor.run_count == 2
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1


@pytest.mark.asyncio
async def test_duplicate_submission_rejects_nested_projection_id_conflict(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two"))),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    parent = context.plan_editor.plan.steps[0].tool_calls[0]
    parent.sub_calls[0].sub_calls.append(
        ToolCall(tool_name="conflicting nested call", tool_call_id=parent.sub_calls[1].tool_call_id)
    )
    before_duplicate = context.plan_editor.plan.model_copy(deep=True)

    with pytest.raises(RuntimeError, match="invalid tool-call ids after repairing tree"):
        await manager.submit_prepared(context, prepared)

    assert executor.run_count == 2
    assert context.plan_editor.plan == before_duplicate


@pytest.mark.asyncio
async def test_duplicate_submission_repairs_terminal_existing_projection(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    first = await manager.submit_prepared(context, prepared)
    step = context.plan_editor.plan.steps[0]
    parent = step.tool_calls[0]
    child = parent.sub_calls[0]
    step.status = PlanStepStatus.IN_PROGRESS
    parent.tool_call_status = ToolCallStatus.RUNNING
    child.tool_call_status = ToolCallStatus.RUNNING

    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.batch_id == first.batch_id
    assert executor.run_count == 1
    assert len(step.tool_calls) == 1
    assert child.tool_call_status == ToolCallStatus.SUCCESSFUL
    assert parent.tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_duplicate_submission_retries_terminal_projection_repair(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    step = context.plan_editor.plan.steps[0]
    parent = step.tool_calls[0]
    child = parent.sub_calls[0]
    step.status = PlanStepStatus.IN_PROGRESS
    parent.tool_call_status = ToolCallStatus.RUNNING
    child.tool_call_status = ToolCallStatus.RUNNING
    context.plan_editor.tree_update_failures_remaining = 1

    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.completed_count == 1
    assert context.plan_editor.tree_update_failures_remaining == 0
    assert child.tool_call_status == ToolCallStatus.SUCCESSFUL
    assert parent.tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_duplicate_submission_rebuilds_missing_plan_projection(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    first = await manager.submit_prepared(context, prepared)
    context.plan_editor.plan.steps[0].tool_calls.clear()
    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.batch_id == first.batch_id
    assert executor.run_count == 1
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1
    assert len(context.plan_editor.plan.steps[0].tool_calls[0].sub_calls) == 1


@pytest.mark.asyncio
async def test_submit_prepared_rejects_divergent_duplicate(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    original = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "original"),), description="Original batch."),
    )
    divergent = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "different"),), description="Divergent duplicate."),
    )

    context = _turn_context("submission-1")
    await manager.submit_prepared(context, original)
    tool_call_count = context.plan_editor.next_tool_call_id

    with pytest.raises(RuntimeError, match="diverged"):
        await manager.submit_prepared(context, divergent)
    assert executor.run_count == 1
    assert context.plan_editor.next_tool_call_id == tool_call_count
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1


@pytest.mark.asyncio
async def test_duplicate_submission_does_not_partially_write_failed_canonical_repair(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    context.plan_editor.plan.steps[0].tool_calls.clear()

    async def fail_projection(*args, **kwargs):
        options = kwargs.get("options")
        if options is not None and options.repair:
            raise RuntimeError("projection failed")
        return False

    monkeypatch.setattr(manager.submitter._progress, "sync_batch_projection", fail_projection)

    with pytest.raises(RuntimeError, match="failed to sync plan projection"):
        await manager.submit_prepared(context, prepared)
    assert context.plan_editor.plan.steps[0].tool_calls == []


@pytest.mark.asyncio
async def test_duplicate_submission_reconciles_repaired_projection_on_next_delivery(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")

    await manager.submit_prepared(context, prepared)
    context.plan_editor.plan.steps[0].tool_calls.clear()
    context.plan_editor.plan.steps[0].status = PlanStepStatus.IN_PROGRESS
    context.plan_editor.tree_update_failures_remaining = 3

    with pytest.raises(RuntimeError, match="failed to sync plan projection"):
        await manager.submit_prepared(context, prepared)

    duplicate = await manager.submit_prepared(context, prepared)
    step = context.plan_editor.plan.steps[0]
    parent = step.tool_calls[0]
    assert duplicate.completed_count == 1
    assert len(step.tool_calls) == 1
    assert parent.tool_call_status == ToolCallStatus.SUCCESSFUL
    assert parent.sub_calls[0].tool_call_status == ToolCallStatus.SUCCESSFUL
    assert step.status == PlanStepStatus.COMPLETED


@pytest.mark.asyncio
async def test_submit_prepared_rejects_incomplete_existing_batch(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two")),
            description="Two-task batch.",
        ),
    )
    context = _turn_context("submission-1")

    first = await manager.submit_prepared(context, prepared)
    runs = await store.list_batch_runs(first.batch_id)
    shutil.rmtree(store.run_dir(first.batch_id, runs[-1].run_id))

    with pytest.raises(RuntimeError, match="expected 2 materialized runs, found 1"):
        await manager.submit_prepared(context, prepared)
    assert len(context.plan_editor.plan.steps[0].tool_calls) == 1


@pytest.mark.asyncio
async def test_duplicate_submission_skips_execution_planning(tmp_path: Path, monkeypatch) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")
    first = await manager.submit_prepared(context, prepared)

    async def unexpected_planning(*args, **kwargs):
        raise AssertionError("execution planning must be skipped for a duplicate submission")

    monkeypatch.setattr(manager.submitter._execution_planner, "plan", unexpected_planning)
    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.batch_id == first.batch_id


@pytest.mark.asyncio
async def test_duplicate_submission_retries_transient_observation_failures(
    tmp_path: Path,
    monkeypatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    monkeypatch.setattr(submitter_module, "_EXISTING_BATCH_RESULT_POLL_SECONDS", 0)
    store = _FailingDetailStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two")),
            description="Two-task duplicate-safe batch.",
        ),
    )
    context = _turn_context("submission-1")
    first = await manager.submit_prepared(context, prepared)
    runs = await store.list_batch_runs(first.batch_id)
    store.fail_run_id = runs[0].run_id
    store.detail_failures_remaining = 1
    store.detail_calls = 0
    store.list_batch_runs_calls = 0

    duplicate = await manager.submit_prepared(context, prepared)

    assert duplicate.completed_count == 2
    assert duplicate.failed_count == 0
    assert store.detail_calls == 3
    assert store.list_batch_runs_calls <= 4


@pytest.mark.asyncio
async def test_existing_batch_result_wait_rejects_empty_runs(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context("submission-1")
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    result = await manager.submit_prepared(context, prepared)
    batch = await manager.store.get_batch(result.batch_id)

    with pytest.raises(RuntimeError, match="has no materialized runs"):
        await manager.submitter._wait_for_existing_batch_results(batch, [])


@pytest.mark.asyncio
async def test_submit_prepared_does_not_create_projection_when_duplicate_lookup_errors(tmp_path: Path) -> None:
    store = _FailingBatchLookupStore(tmp_path / "turn" / "results")
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Duplicate-safe batch."),
    )
    context = _turn_context("submission-1")
    store.fail_batch_lookup = True

    with pytest.raises(ConnectionError, match="simulated backend outage"):
        await manager.submit_prepared(context, prepared)

    assert context.plan_editor.plan is None
    assert executor.run_count == 0
    assert await store.list_batches_by_turn(context.conversation_id, context.turn_id) == []
