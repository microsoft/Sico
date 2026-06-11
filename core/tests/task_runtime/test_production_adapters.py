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

import time
from pathlib import Path

import pytest

from app.biz.task_runtime.artifact_store import FileArtifactStore, SeaweedFSArtifactStore
from app.biz.task_runtime.models import (
    BatchRecord,
    BatchStatus,
    ErrorClass,
    SandboxRequirement,
    SkillDispatch,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    ToolDispatch,
)
from app.biz.task_runtime.executors.runner_executor import RunnerExecutor
from app.biz.task_runtime.sandbox import InMemorySandboxLeaseManager, SandboxNoCapacityError
from app.biz.task_runtime.store import FileRunStore


def test_file_artifact_store_put_and_get(tmp_path: Path) -> None:
    source = tmp_path / "report.md"
    source.write_text("# Report", encoding="utf-8")
    store = FileArtifactStore(tmp_path / "artifacts")

    ref = store.put("run-1", "report.md", source, artifact_type="report")

    assert ref.size_bytes == len("# Report")
    assert store.get(ref.uri).read_text(encoding="utf-8") == "# Report"


def test_seaweedfs_artifact_store_put_and_get(tmp_path: Path) -> None:
    source = tmp_path / "report.md"
    source.write_text("# Report", encoding="utf-8")
    session = FakeSession()
    store = SeaweedFSArtifactStore(
        "http://seaweedfs-filer:14003",
        cache_root=tmp_path / "cache",
        session=session,
    )

    ref = store.put("run-1", "reports/report 1.md", source, artifact_type="report", role="primary")
    cached = store.get(ref.uri)

    assert ref.uri == "/storage/task-runtime/run-1/reports/report%201.md"
    assert ref.metadata == {"storage": "seaweedfs", "object_path": "task-runtime/run-1/reports/report 1.md"}
    assert ref.role == "primary"
    assert session.post_urls == ["http://seaweedfs-filer:14003/task-runtime/run-1/reports/report%201.md"]
    assert session.get_urls == ["http://seaweedfs-filer:14003/task-runtime/run-1/reports/report%201.md"]
    assert cached.read_text(encoding="utf-8") == "# Report"


def test_seaweedfs_artifact_store_rejects_traversal(tmp_path: Path) -> None:
    source = tmp_path / "report.md"
    source.write_text("# Report", encoding="utf-8")
    store = SeaweedFSArtifactStore("http://seaweedfs-filer:14003", cache_root=tmp_path / "cache", session=FakeSession())

    with pytest.raises(ValueError):
        store.put("run-1", "../report.md", source)


@pytest.mark.asyncio
async def test_file_run_store_sweep_marks_stale_run_failed(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    await store.create_batch(
        BatchRecord(
            batch_id="batch-1",
            parent_conversation_id=1,
            parent_turn_id=1,
            status=BatchStatus.RUNNING,
            total_count=1,
            created_at=1,
            updated_at=1,
        )
    )
    run = TaskRun(
        run_id="run-1",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=TaskSpec(task_id="task-1", title="Task", dispatch=SkillDispatch(skill_name="mock")),
        execution_policy=TaskExecutionPolicy(),
        status=TaskStatus.RUNNING,
        idempotency_key="key",
        executor="local_subprocess",
        worker_id="old-worker",
        queued_at=1,
        started_at=1,
        heartbeat_at=1,
    )
    await store.create_run(run)

    # StaleReconciler owns crash recovery in production; this exercises the
    # underlying FileRunStore.sweep_stale + fail_stale_run primitives directly.
    now_ms = int(time.time() * 1000)
    stale_runs = await store.sweep_stale(now_ms)
    for stale_run in stale_runs:
        run_snapshot = await store.get_run(stale_run.run_id)
        await store.fail_stale_run(
            run_snapshot.run_id,
            TaskResult(
                run_id=run_snapshot.run_id,
                task_id=run_snapshot.spec.task_id,
                status=TaskStatus.FAILED,
                title=run_snapshot.spec.title,
                summary="Task worker heartbeat became stale.",
                error_class=ErrorClass.INTERNAL,
                error_message="Task worker heartbeat became stale.",
                started_at=run_snapshot.started_at,
                ended_at=now_ms,
                duration_ms=0,
            ),
            "task-runtime-sweeper",
        )
    loaded = await store.get_run("run-1")

    assert [stale.run_id for stale in stale_runs] == ["run-1"]
    assert loaded.status == TaskStatus.FAILED
    assert loaded.worker_id == "task-runtime-sweeper"


@pytest.mark.asyncio
async def test_in_memory_sandbox_manager_limits_acquire_capacity() -> None:
    manager = InMemorySandboxLeaseManager({"android": 1}, acquire_timeout_seconds=0.01)
    first_token = await manager.reserve(SandboxRequirement(type="android"), "run-1")
    second_token = await manager.reserve(SandboxRequirement(type="android"), "run-2")
    first_lease = await manager.acquire(first_token)

    with pytest.raises(SandboxNoCapacityError):
        await manager.acquire(second_token)

    await manager.release(first_lease, "dirty")
    second_lease = await manager.acquire(second_token)

    assert manager.reset_count == 0
    assert second_lease.type == "emulator"


@pytest.mark.asyncio
async def test_runner_executor_enqueues_and_waits_for_result(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    await _create_batch_and_run(store, tmp_path)
    queue = CapturingQueue()
    executor = RunnerExecutor(queue, poll_interval_seconds=0.01, result_timeout_seconds=0.2)

    async def publish_result() -> None:
        token = await store.claim_run("run-1", "worker")
        await store.write_result(
            "run-1",
            TaskResult(
                run_id="run-1",
                task_id="task-1",
                status=TaskStatus.COMPLETED,
                title="Task",
                summary="done",
            ),
            token,
        )

    await publish_result()
    result = await executor.run(await store.get_run("run-1"), store)

    assert queue.run_ids == ["run-1"]
    assert result.status == TaskStatus.COMPLETED


@pytest.mark.asyncio
async def test_runner_executor_returns_blocked_when_result_times_out(tmp_path: Path) -> None:
    store = FileRunStore(tmp_path)
    await _create_batch_and_run(store, tmp_path)
    executor = RunnerExecutor(CapturingQueue(), poll_interval_seconds=0.01, result_timeout_seconds=0.01)

    result = await executor.run(await store.get_run("run-1"), store)

    assert result.status == TaskStatus.BLOCKED
    assert result.error_class == ErrorClass.TRANSIENT


class CapturingQueue:
    def __init__(self) -> None:
        self.run_ids: list[str] = []

    async def enqueue(self, run_id: str) -> None:
        self.run_ids.append(run_id)


class FakeResponse:
    def __init__(self, status_code: int = 200, content: bytes = b"") -> None:
        self.status_code = status_code
        self.content = content
        self.text = content.decode("utf-8", errors="replace")


class FakeSession:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.post_urls: list[str] = []
        self.get_urls: list[str] = []

    def post(self, url: str, *, files: dict, timeout: int) -> FakeResponse:
        self.post_urls.append(url)
        self.objects[url] = files["file"][1].read()
        return FakeResponse(status_code=201)

    def get(self, url: str, *, timeout: int) -> FakeResponse:
        self.get_urls.append(url)
        return FakeResponse(content=self.objects[url])


async def _create_batch_and_run(store: FileRunStore, tmp_path: Path) -> None:
    await store.create_batch(
        BatchRecord(
            batch_id="batch-1",
            parent_conversation_id=1,
            parent_turn_id=1,
            status=BatchStatus.RUNNING,
            total_count=1,
            created_at=1,
            updated_at=1,
        )
    )
    await store.create_run(
        TaskRun(
            run_id="run-1",
            batch_id="batch-1",
            parent_conversation_id=1,
            parent_turn_id=1,
            batch_item_index=0,
            username="alice@example.com",
            agent_id="agent",
            agent_instance_id=1,
            project_id=1,
            spec=TaskSpec(task_id="task-1", title="Task", dispatch=ToolDispatch(tool_name="echo")),
            execution_policy=TaskExecutionPolicy(),
            status=TaskStatus.QUEUED,
            idempotency_key="key",
            executor="local_subprocess",
            queued_at=1,
        )
    )
