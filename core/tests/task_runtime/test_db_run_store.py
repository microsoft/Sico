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

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.task_runtime.db_store import DBRunStore
from app.biz.task_runtime.models import (
    ArtifactRef,
    BatchRecord,
    BatchStatus,
    FencingToken,
    SkillDispatch,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.store import IdempotencyCollisionError, StaleWorkerError
from app.biz.reverse_grpc.taskruntime import (
    ReverseTaskRuntimeAlreadyExistsError,
    ReverseTaskRuntimeServiceError,
    ReverseTaskRuntimeStaleError,
)


@pytest.mark.asyncio
async def test_db_run_store_round_trips_run_and_result(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    store = DBRunStore(service)
    batch = _batch()
    run = _run(tmp_path)
    result = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary="done",
        artifacts=[ArtifactRef(name="report", type="report", uri="file://report.md")],
    )

    await store.create_batch(batch)
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    await store.write_result(run.run_id, result, token)

    detail = await store.get_task_detail(run.run_id, "artifacts")

    lookup = await store.lookup_idempotent("key")
    assert lookup is not None
    assert lookup.run_id == run.run_id
    assert detail.run.status == TaskStatus.COMPLETED
    assert detail.result == result
    assert detail.artifacts == result.artifacts


@pytest.mark.asyncio
async def test_db_run_store_maps_already_exists_to_collision(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    service.create_run_error = ReverseTaskRuntimeAlreadyExistsError("dup key")
    store = DBRunStore(service)

    with pytest.raises(IdempotencyCollisionError):
        await store.create_run(_run(tmp_path))


@pytest.mark.asyncio
async def test_db_run_store_maps_claim_failed_precondition_to_stale(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    service.claim_error = ReverseTaskRuntimeStaleError("not claimable")
    store = DBRunStore(service)
    run = _run(tmp_path)
    await store.create_run(run)

    with pytest.raises(StaleWorkerError):
        await store.claim_run(run.run_id, "worker-1")


@pytest.mark.asyncio
async def test_db_run_store_maps_write_result_failed_precondition_to_stale(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    service.write_result_error = ReverseTaskRuntimeStaleError("token superseded")
    store = DBRunStore(service)
    run = _run(tmp_path)
    await store.create_run(run)
    token = await store.claim_run(run.run_id, "worker-1")
    result = TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary="done",
    )

    with pytest.raises(StaleWorkerError):
        await store.write_result(run.run_id, result, token)


@pytest.mark.asyncio
async def test_db_run_store_get_run_missing_raises(tmp_path: Path) -> None:
    store = DBRunStore(FakeTaskRuntimeService())
    with pytest.raises(FileNotFoundError):
        await store.get_run("nope")


@pytest.mark.asyncio
async def test_db_run_store_set_progress_truncates_message(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    store = DBRunStore(service)
    await store.set_progress("run-1", "x" * 2000, ts=123)

    assert service.progress == ("run-1", "x" * 1000, 123)


@pytest.mark.asyncio
async def test_db_run_store_heartbeat_batch_forwards_batch_id(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    store = DBRunStore(service)
    await store.heartbeat_batch("batch-42")

    assert service.heartbeat_batch_id == "batch-42"


@pytest.mark.asyncio
async def test_db_run_store_reopen_forwards_payload_and_expected_attempt(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    store = DBRunStore(service)
    run = _run(tmp_path)
    await store.create_run(run)
    next_run = run.model_copy(update={"attempt": 2, "status": TaskStatus.QUEUED})

    await store.reopen_run_for_retry(next_run, expected_attempt=1)

    assert service.reopen_call is not None
    sent_json, expected = service.reopen_call
    assert expected == 1
    assert TaskRun.model_validate_json(sent_json).attempt == 2


@pytest.mark.asyncio
async def test_db_run_store_maps_reopen_failed_precondition_to_stale(tmp_path: Path) -> None:
    service = FakeTaskRuntimeService()
    service.reopen_error = ReverseTaskRuntimeStaleError("not reopenable")
    store = DBRunStore(service)
    run = _run(tmp_path).model_copy(update={"attempt": 2, "status": TaskStatus.QUEUED})

    with pytest.raises(StaleWorkerError):
        await store.reopen_run_for_retry(run, expected_attempt=1)


class FakeTaskRuntimeService:
    def __init__(self) -> None:
        self.batch_json = ""
        self.runs: dict[str, str] = {}
        self.result_json = ""
        self.token_json = FencingToken(run_id="run-1", token="new", issued_at=2).model_dump_json()
        self.create_run_error: Exception | None = None
        self.claim_error: Exception | None = None
        self.write_result_error: Exception | None = None
        self.reopen_error: Exception | None = None
        self.reopen_call: tuple[str, int] | None = None
        self.progress: tuple[str, str, int] | None = None
        self.heartbeat_batch_id: str | None = None

    def create_batch(self, batch_json: str) -> None:
        self.batch_json = batch_json

    def create_run(self, run_json: str) -> None:
        if self.create_run_error is not None:
            raise self.create_run_error
        run = TaskRun.model_validate_json(run_json)
        self.runs[run.run_id] = run_json

    def lookup_idempotent(self, idempotency_key: str) -> SimpleNamespace:
        for run_json in self.runs.values():
            run = TaskRun.model_validate_json(run_json)
            if run.idempotency_key == idempotency_key:
                return SimpleNamespace(found=True, run_json=run_json)
        return SimpleNamespace(found=False, run_json="")

    def claim_run(self, run_id: str, worker_id: str) -> SimpleNamespace:
        if self.claim_error is not None:
            raise self.claim_error
        run = TaskRun.model_validate_json(self.runs[run_id])
        run.status = TaskStatus.RUNNING
        run.worker_id = worker_id
        run.fencing_token = "new"
        run.started_at = 2
        run.heartbeat_at = 2
        self.runs[run_id] = run.model_dump_json()
        return SimpleNamespace(token_json=self.token_json)

    def heartbeat_batch(self, batch_id: str) -> None:
        self.heartbeat_batch_id = batch_id

    def write_result(self, run_id: str, result_json: str, token_json: str) -> None:
        if self.write_result_error is not None:
            raise self.write_result_error
        token = FencingToken.model_validate_json(token_json)
        if token.token != "new":
            raise ReverseTaskRuntimeServiceError("stale worker token for run run-1")
        self.result_json = result_json
        run = TaskRun.model_validate_json(self.runs[run_id])
        result = TaskResult.model_validate_json(result_json)
        run.status = result.status
        run.ended_at = result.ended_at or 3
        run.last_error_class = result.error_class
        run.last_error = result.error_message
        self.runs[run_id] = run.model_dump_json()

    def set_run_progress(self, run_id: str, message: str, ts: int) -> None:
        self.progress = (run_id, message, ts)

    def reopen_run_for_retry(self, run_json: str, expected_attempt: int) -> None:
        if self.reopen_error is not None:
            raise self.reopen_error
        self.reopen_call = (run_json, expected_attempt)
        run = TaskRun.model_validate_json(run_json)
        self.runs[run.run_id] = run_json
        self.result_json = ""

    def get_run(self, run_id: str) -> SimpleNamespace:
        run_json = self.runs.get(run_id)
        if run_json is None:
            return SimpleNamespace(found=False, run_json="")
        return SimpleNamespace(found=True, run_json=run_json)

    def get_task_detail(self, run_id: str, view: str) -> SimpleNamespace:
        return SimpleNamespace(
            found=True,
            run_json=self.runs[run_id],
            result_json=self.result_json,
            content="",
            artifacts_json="[]",
        )


def _batch() -> BatchRecord:
    return BatchRecord(
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        status=BatchStatus.QUEUED,
        total_count=1,
        created_at=1,
        updated_at=1,
    )


def _run(tmp_path: Path) -> TaskRun:
    spec = TaskSpec(task_id="task-1", title="Task 1", dispatch=SkillDispatch(skill_name="mock"))
    return TaskRun(
        run_id="run-1",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key="key",
        executor="local_subprocess",
        queued_at=1,
    )
