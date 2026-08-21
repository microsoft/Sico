import time
from pathlib import Path

import pytest

from app.biz.task_runtime.storage.artifact_store import FileArtifactStore, SeaweedFSArtifactStore
from app.biz.task_runtime.domain.models import (
    BatchRecord,
    BatchStatus,
    ErrorClass,
    SandboxRequirement,
    CapabilityDispatch,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.sandbox.lease_manager import InMemorySandboxLeaseManager, SandboxNoCapacityError
from app.biz.task_runtime.storage.file_store import FileRunStore


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
        spec=TaskSpec(task_id="task-1", title="Task", dispatch=CapabilityDispatch(capability_id="skill:mock.run")),
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
