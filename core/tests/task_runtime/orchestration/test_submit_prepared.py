"""Tests for ``TaskManager.submit_prepared``.

Validates that the new bypass-normalization API correctly executes prepared
batches and preserves caller-supplied ``batch_metadata`` verbatim."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.storage.artifact_store import FileArtifactStore
from app.biz.task_runtime.execution.contracts import Executor
from app.biz.task_runtime.execution.command.local import LocalBackend
from app.biz.task_runtime.domain.models import PreparedTaskBatch, TaskBatchInput, TaskDisplay
from app.biz.task_runtime.capabilities.builtin import BuiltinCapabilityProvider
from app.biz.task_runtime.capabilities.resolver import CapabilityResolver
from app.biz.task_runtime.capabilities.executor import CapabilityExecutor
from app.biz.task_runtime.manager import TaskManager
from app.biz.task_runtime.domain.models import CapabilityDispatch, SubAgentDispatch, TaskSpec
from app.biz.task_runtime.storage.file_store import FileRunStore
from app.biz.task_runtime.orchestration.materialization import _prepared_submission_fingerprint
from app.biz.task_runtime.workspace.layout import reset_workspace_layout, set_workspace_layout
from app.schemas.conversation.plan import Plan
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
        self.messages: dict[int, str] = {}
        self.deliverables: dict[int, list] = {}
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
        self.next_tool_call_id += 1
        self.messages[self.next_tool_call_id] = initial_message
        return self.next_tool_call_id

    async def update_tool_call_message(self, tool_call_id: int, message: str):
        self.messages[tool_call_id] = message
        return None

    async def update_tool_call(self, tool_call_id: int, updater):
        tool_call = SimpleNamespace(
            deliverables=self.deliverables.get(tool_call_id, []),
            tool_call_status=self.statuses.get(tool_call_id) if hasattr(self, "statuses") else None,
            execution_info=SimpleNamespace(
                task_runtime=SimpleNamespace(
                    current_stage="",
                    sandbox_id="",
                    sandbox_type="",
                    sandbox_endpoint="",
                    attempt=0,
                    max_attempts=0,
                    latest_progress_message="",
                )
            ),
        )
        updater(tool_call)
        self.deliverables[tool_call_id] = tool_call.deliverables
        return tool_call

    async def is_plan_cancelled(self) -> bool:
        return self.cancelled


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


class _CountingExecutor:
    def __init__(self, inner: Executor) -> None:
        self.inner = inner
        self.run_count = 0

    async def run(self, run, store):
        self.run_count += 1
        return await self.inner.run(run, store)


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
        await super().update_batch(batch)


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
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "hello"), _echo_task("task-2", "world")),
            join_strategy="partial_ok",
            description="Prepared echo batch.",
        ),
    )

    result = await manager.submit_prepared(_turn_context(), prepared)

    assert result.completed_count == 2
    assert result.failed_count == 0


@pytest.mark.asyncio
async def test_submit_prepared_persists_compact_rerun_source(tmp_path: Path) -> None:
    turn_path = tmp_path / "turn" / "1"
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "hello"),),
            join_strategy="all_success",
            max_concurrency=1,
            description="Replayable echo batch.",
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
        "reason": "Replayable echo batch.",
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
async def test_submit_prepared_reuses_replay_but_executes_new_submission(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    store = _MissNextBatchLookupStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "again"),),
            description="Replay-safe batch.",
        ),
    )
    rerun_prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "changed for intentional rerun"),),
            description="Intentional rerun batch.",
        ),
    )

    replay_context = _turn_context("submission-1")
    first = await manager.submit_prepared(replay_context, prepared)
    updates_after_first = store.update_batch_count
    store.miss_next_batch_lookup = True
    replay = await manager.submit_prepared(replay_context, prepared)
    rerun = await manager.submit_prepared(_turn_context("submission-2"), rerun_prepared)

    assert replay.batch_id == first.batch_id
    assert rerun.batch_id != first.batch_id
    assert executor.run_count == 2
    assert store.update_batch_count == updates_after_first + 1


@pytest.mark.asyncio
async def test_submit_prepared_rejects_divergent_replay(tmp_path: Path) -> None:
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), executor, max_concurrency=1)
    original = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "original"),), description="Original batch."),
    )
    divergent = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "different"),), description="Divergent replay."),
    )

    await manager.submit_prepared(_turn_context("submission-1"), original)

    with pytest.raises(RuntimeError, match="diverged"):
        await manager.submit_prepared(_turn_context("submission-1"), divergent)
    assert executor.run_count == 1


@pytest.mark.asyncio
async def test_submit_prepared_rejects_incomplete_replay_batch(tmp_path: Path) -> None:
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


@pytest.mark.asyncio
async def test_submit_prepared_replay_skips_execution_planning(tmp_path: Path, monkeypatch) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Replay batch."),
    )
    context = _turn_context("submission-1")
    first = await manager.submit_prepared(context, prepared)

    async def unexpected_planning(*args, **kwargs):
        raise AssertionError("execution planning must be skipped for replay")

    monkeypatch.setattr(manager.submitter._execution_planner, "plan", unexpected_planning)
    replay = await manager.submit_prepared(context, prepared)

    assert replay.batch_id == first.batch_id


@pytest.mark.asyncio
async def test_submit_prepared_replay_retries_transient_observation_failures(
    tmp_path: Path,
    monkeypatch,
) -> None:
    import app.biz.task_runtime.orchestration.submitter as submitter_module

    monkeypatch.setattr(submitter_module, "_REPLAY_RESULT_POLL_SECONDS", 0)
    store = _FailingDetailStore(tmp_path / "turn" / "results")
    manager = TaskManager(store, _tool_executor(tmp_path), max_concurrency=2)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(
            tasks=(_echo_task("task-1", "one"), _echo_task("task-2", "two")),
            description="Two-task replay batch.",
        ),
    )
    context = _turn_context("submission-1")
    first = await manager.submit_prepared(context, prepared)
    runs = await store.list_batch_runs(first.batch_id)
    store.fail_run_id = runs[0].run_id
    store.detail_failures_remaining = 1
    store.detail_calls = 0
    store.list_batch_runs_calls = 0

    replay = await manager.submit_prepared(context, prepared)

    assert replay.completed_count == 2
    assert replay.failed_count == 0
    assert store.detail_calls == 3
    assert store.list_batch_runs_calls <= 4


@pytest.mark.asyncio
async def test_replayed_batch_result_wait_rejects_empty_runs(tmp_path: Path) -> None:
    manager = TaskManager(FileRunStore(tmp_path / "turn" / "results"), _tool_executor(tmp_path), max_concurrency=1)
    context = _turn_context("submission-1")
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Replay batch."),
    )
    result = await manager.submit_prepared(context, prepared)
    batch = await manager.store.get_batch(result.batch_id)

    with pytest.raises(RuntimeError, match="has no materialized runs"):
        await manager.submitter._wait_for_replayed_batch_results(context, batch, [])


@pytest.mark.asyncio
async def test_submit_prepared_marks_parent_failed_when_replay_lookup_errors(tmp_path: Path) -> None:
    store = _FailingBatchLookupStore(tmp_path / "turn" / "results")
    executor = _CountingExecutor(_tool_executor(tmp_path))
    manager = TaskManager(store, executor, max_concurrency=1)
    prepared = PreparedTaskBatch(
        batch=TaskBatchInput(tasks=(_echo_task("task-1", "hello"),), description="Replay batch."),
    )
    failed_parent_calls: list[int] = []

    async def record_failure(_ctx, parent_tool_call_id: int) -> None:
        failed_parent_calls.append(parent_tool_call_id)

    manager.submitter._progress.mark_delegate_tasks_failed = record_failure
    store.fail_batch_lookup = True

    with pytest.raises(ConnectionError, match="simulated backend outage"):
        await manager.submit_prepared(_turn_context("submission-1"), prepared)

    assert len(failed_parent_calls) == 1
    assert executor.run_count == 0
