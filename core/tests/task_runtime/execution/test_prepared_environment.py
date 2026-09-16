from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from app.biz.skill.resolver import ResolvedAction
from app.biz.task_runtime.execution.environment import (
    FilePreparedEnvironmentStore,
    PreparedEnvironmentError,
    PreparedEnvironmentGCPolicy,
    PreparedEnvironmentManager,
    PreparedEnvironmentMetrics,
    PreparedEnvironmentRecord,
    PreparedEnvironmentGCSummary,
    PreparedImage,
    PreparedEnvironmentSpec,
    default_prepared_environment_manager,
    run_prepared_environment_reaper,
    runtime_content_digest,
)

_BASE_DIGEST = "registry.test/base@sha256:" + "1" * 64
_PREPARED_DIGEST = "registry.test/prepared@sha256:" + "2" * 64


class _Builder:
    def __init__(
        self,
        *,
        image: str = _PREPARED_DIGEST,
        error: Exception | None = None,
        resolve_error: Exception | None = None,
        delete_error: Exception | None = None,
    ) -> None:
        self.image = image
        self.error = error
        self.resolve_error = resolve_error
        self.delete_error = delete_error
        self.resolve_calls: list[str] = []
        self.build_calls: list[PreparedEnvironmentSpec] = []
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.block = False
        self.delete_calls: list[tuple[str, str]] = []

    async def resolve_base_image(self, image: str) -> str:
        self.resolve_calls.append(image)
        if self.resolve_error is not None:
            raise self.resolve_error
        return _BASE_DIGEST

    async def build(self, spec: PreparedEnvironmentSpec, runtime_root: Path) -> PreparedImage:
        self.build_calls.append(spec)
        self.started.set()
        if self.block:
            await self.release.wait()
        if self.error is not None:
            raise self.error
        return PreparedImage(image=self.image, size_bytes=100)

    async def delete(self, key: str, image: str) -> None:
        self.delete_calls.append((key, image))
        if self.delete_error is not None:
            raise self.delete_error


def _action() -> ResolvedAction:
    return ResolvedAction.model_validate(
        {
            "name": "run",
            "execution_requirement": {"backend": "kubernetes", "image": "registry.test/base:latest"},
            "preparation": {"steps": [{"argv": ["uv", "sync", "--frozen"]}]},
            "target_requirements": {"os": "linux"},
            "steps": [{"argv": ["uv", "run", "python", "runner.py"]}],
        }
    )


def _runtime(tmp_path: Path, content: str = "print('one')\n") -> Path:
    root = tmp_path / "runtime"
    root.mkdir(exist_ok=True)
    (root / "runner.py").write_text(content, encoding="utf-8")
    return root


def _gc_policy(**updates: int) -> PreparedEnvironmentGCPolicy:
    values = {
        "interval_seconds": 60,
        "idle_ttl_seconds": 1,
        "failed_ttl_seconds": 1,
        "build_ttl_seconds": 10,
        "delete_grace_seconds": 0,
        "quota_bytes": 0,
        "usage_lease_seconds": 60,
    }
    values.update(updates)
    return PreparedEnvironmentGCPolicy(**values)


def test_gc_lifecycle_durations_are_code_owned(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_GC_INTERVAL_SECONDS", "1")
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_IDLE_TTL_SECONDS", "1")
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_FAILED_TTL_SECONDS", "1")
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_BUILD_TTL_SECONDS", "1")
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_DELETE_GRACE_SECONDS", "1")
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_USAGE_LEASE_SECONDS", "1")
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_QUOTA_BYTES", "1024")

    policy = PreparedEnvironmentGCPolicy.from_env()

    assert policy == PreparedEnvironmentGCPolicy(quota_bytes=1024)


def test_environment_key_changes_with_execution_inputs(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    action = _action()
    base = PreparedEnvironmentSpec(
        base_image_digest=_BASE_DIGEST,
        preparation_steps=tuple(action.preparation.steps),
        runtime_digest=runtime_content_digest(runtime),
        execution_os="linux",
        architecture="amd64",
    )

    assert base.key == base.model_copy().key
    assert base.key != base.model_copy(update={"base_image_digest": "registry.test/base@sha256:" + "3" * 64}).key
    assert base.key != base.model_copy(update={"runtime_digest": "4" * 64}).key
    assert base.key != base.model_copy(update={"execution_os": "windows"}).key
    assert base.key != base.model_copy(update={"architecture": "arm64"}).key
    assert base.key != base.model_copy(update={"builder_version": "v2"}).key


def test_environment_manager_normalizes_oci_architecture(tmp_path: Path) -> None:
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), _Builder(), architecture="x86_64")

    assert manager.architecture == "amd64"


@pytest.mark.asyncio
async def test_concurrent_cold_requests_build_once(tmp_path: Path) -> None:
    builder = _Builder()
    builder.block = True
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), builder)
    action = _action()
    runtime = _runtime(tmp_path)

    first = asyncio.create_task(manager.ensure_ready(action, runtime))
    await builder.started.wait()
    second = asyncio.create_task(manager.ensure_ready(action, runtime))
    await asyncio.sleep(0)
    builder.release.set()
    first_ref, second_ref = await asyncio.gather(first, second)

    assert first_ref == second_ref
    assert first_ref.image == _PREPARED_DIGEST
    assert len(builder.build_calls) == 1


@pytest.mark.asyncio
async def test_separate_managers_share_build_lock(tmp_path: Path) -> None:
    builder = _Builder()
    builder.block = True
    store_root = tmp_path / "state"
    first_manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(store_root), builder)
    second_manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(store_root), builder)
    action = _action()
    runtime = _runtime(tmp_path)

    first = asyncio.create_task(first_manager.ensure_ready(action, runtime))
    await builder.started.wait()
    second = asyncio.create_task(second_manager.ensure_ready(action, runtime))
    await asyncio.sleep(0)
    builder.release.set()
    refs = await asyncio.gather(first, second)

    assert refs[0] == refs[1]
    assert len(builder.build_calls) == 1


@pytest.mark.asyncio
async def test_warm_request_reuses_ready_image(tmp_path: Path) -> None:
    builder = _Builder()
    metrics = PreparedEnvironmentMetrics()
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), builder, metrics=metrics)
    action = _action()
    runtime = _runtime(tmp_path)

    first = await manager.ensure_ready(action, runtime)
    second = await manager.ensure_ready(action, runtime)

    assert first == second
    assert len(builder.build_calls) == 1
    assert metrics.snapshot()["builds"] == 1
    assert metrics.snapshot()["cache_hits"] == 1


@pytest.mark.asyncio
async def test_warm_request_reuses_last_resolved_base_without_registry_network(tmp_path: Path) -> None:
    builder = _Builder()
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), builder)
    action = _action()
    runtime = _runtime(tmp_path)
    first = await manager.ensure_ready(action, runtime)
    builder.resolve_error = RuntimeError("registry offline")

    second = await manager.ensure_ready(action, runtime)

    assert second == first
    assert len(builder.build_calls) == 1


@pytest.mark.asyncio
async def test_failed_build_is_persisted_and_not_ready(tmp_path: Path) -> None:
    builder = _Builder(error=RuntimeError("registry unavailable"))
    store = FilePreparedEnvironmentStore(tmp_path / "state")
    metrics = PreparedEnvironmentMetrics()
    manager = PreparedEnvironmentManager(store, builder, metrics=metrics)

    with pytest.raises(PreparedEnvironmentError, match="registry unavailable"):
        await manager.ensure_ready(_action(), _runtime(tmp_path))

    record = store.get(builder.build_calls[0].key)
    assert record is not None
    assert record.state == "failed"
    assert record.image == ""
    assert metrics.snapshot()["failures"] == 1


@pytest.mark.asyncio
async def test_builder_must_return_immutable_digest(tmp_path: Path) -> None:
    builder = _Builder(image="registry.test/prepared:latest")
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), builder)

    with pytest.raises(PreparedEnvironmentError, match="immutable image digest"):
        await manager.ensure_ready(_action(), _runtime(tmp_path))


@pytest.mark.asyncio
async def test_resolved_base_image_must_be_immutable(tmp_path: Path) -> None:
    builder = _Builder()

    async def mutable_base(_image: str) -> str:
        return "registry.test/base:latest"

    builder.resolve_base_image = mutable_base  # type: ignore[method-assign]
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), builder)

    with pytest.raises(PreparedEnvironmentError, match="immutable image digest"):
        await manager.ensure_ready(_action(), _runtime(tmp_path))

    assert builder.build_calls == []


@pytest.mark.asyncio
async def test_any_backend_uses_configured_oci_worker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "docker")
    action = _action().model_copy(
        update={"execution_requirement": _action().execution_requirement.model_copy(update={"backend": "any"})}
    )
    builder = _Builder()
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), builder)

    environment = await manager.ensure_ready(action, _runtime(tmp_path))

    assert environment.image == _PREPARED_DIGEST
    assert builder.build_calls[0].execution_os == "linux"


@pytest.mark.asyncio
async def test_any_backend_uses_configured_environment_runner(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "runner")
    action = _action().model_copy(
        update={"execution_requirement": _action().execution_requirement.model_copy(update={"backend": "any"})}
    )
    builder = _Builder()
    manager = PreparedEnvironmentManager(FilePreparedEnvironmentStore(tmp_path / "state"), builder)

    environment = await manager.ensure_ready(action, _runtime(tmp_path))

    assert environment.image == _PREPARED_DIGEST
    assert len(builder.build_calls) == 1


def test_default_environment_manager_is_disabled_without_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASK_RUNTIME_ENVIRONMENT_BUILDER_ENDPOINT", raising=False)
    monkeypatch.delenv("TASK_RUNTIME_PREPARED_ENV_ROOT", raising=False)

    assert default_prepared_environment_manager() is None


def test_default_environment_manager_rejects_partial_configuration(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_BUILDER_ENDPOINT", "http://environment-runner:8080")
    monkeypatch.delenv("TASK_RUNTIME_PREPARED_ENV_ROOT", raising=False)

    with pytest.raises(ValueError, match="must be configured together"):
        default_prepared_environment_manager()

    monkeypatch.delenv("TASK_RUNTIME_ENVIRONMENT_BUILDER_ENDPOINT", raising=False)
    monkeypatch.setenv("TASK_RUNTIME_PREPARED_ENV_ROOT", str(tmp_path))

    with pytest.raises(ValueError, match="must be configured together"):
        default_prepared_environment_manager()


def test_default_environment_manager_accepts_complete_configuration(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("TASK_RUNTIME_ENVIRONMENT_BUILDER_ENDPOINT", "http://environment-runner:8080")
    monkeypatch.setenv("TASK_RUNTIME_PREPARED_ENV_ROOT", str(tmp_path))

    assert isinstance(default_prepared_environment_manager(), PreparedEnvironmentManager)


@pytest.mark.asyncio
async def test_active_usage_lease_prevents_collection_until_release(tmp_path: Path) -> None:
    builder = _Builder()
    store = FilePreparedEnvironmentStore(tmp_path / "state")
    manager = PreparedEnvironmentManager(store, builder, gc_policy=_gc_policy())
    action = _action()
    runtime = _runtime(tmp_path)
    base = int(time.time() * 1000)

    async with manager.use(action, runtime):
        summary = await manager.run_gc_once(now=base + 2_000)
        assert summary.active_leases == 1
        assert summary.deleted == 0

    summary = await manager.run_gc_once(now=base + 4_000)

    assert summary.deleted == 1
    assert len(builder.delete_calls) == 1
    assert store.list_records() == []


@pytest.mark.asyncio
async def test_expired_usage_lease_does_not_pin_environment(tmp_path: Path) -> None:
    builder = _Builder()
    store = FilePreparedEnvironmentStore(tmp_path / "state")
    manager = PreparedEnvironmentManager(store, builder, gc_policy=_gc_policy())
    environment = await manager.ensure_ready(_action(), _runtime(tmp_path))
    record = store.get(environment.key)
    assert record is not None
    store.put(record.model_copy(update={"last_used_at": 1, "leases": {"crashed-worker": 2}}))

    summary = await manager.run_gc_once(now=10_000)

    assert summary.expired_leases == 1
    assert summary.deleted == 1


@pytest.mark.asyncio
async def test_gc_marks_then_waits_for_grace_period(tmp_path: Path) -> None:
    builder = _Builder()
    store = FilePreparedEnvironmentStore(tmp_path / "state")
    manager = PreparedEnvironmentManager(store, builder, gc_policy=_gc_policy(delete_grace_seconds=10))
    environment = await manager.ensure_ready(_action(), _runtime(tmp_path))
    record = store.get(environment.key)
    assert record is not None
    base = record.last_used_at

    marked = await manager.run_gc_once(now=base + 2_000)
    before_grace = await manager.run_gc_once(now=base + 9_000)
    after_grace = await manager.run_gc_once(now=base + 12_000)

    assert marked.marked == 1
    assert marked.deleted == 0
    assert before_grace.deleted == 0
    assert after_grace.deleted == 1


@pytest.mark.asyncio
async def test_quota_gc_deletes_least_recently_used_environment(tmp_path: Path) -> None:
    builder = _Builder()
    store = FilePreparedEnvironmentStore(tmp_path / "state")
    manager = PreparedEnvironmentManager(store, builder, gc_policy=_gc_policy(idle_ttl_seconds=10_000, quota_bytes=150))
    old_key = "a" * 64
    new_key = "b" * 64
    for key, last_used in ((old_key, 100), (new_key, 200)):
        store.put(
            PreparedEnvironmentRecord(
                key=key,
                state="ready",
                image=f"registry.test/prepared@sha256:{key}",
                image_size_bytes=100,
                created_at=last_used,
                updated_at=last_used,
                last_used_at=last_used,
            )
        )

    summary = await manager.run_gc_once(now=1_000)

    assert summary.deleted == 1
    assert store.get(old_key) is None
    assert store.get(new_key) is not None


@pytest.mark.asyncio
async def test_gc_reconciles_stale_build_record(tmp_path: Path) -> None:
    store = FilePreparedEnvironmentStore(tmp_path / "state")
    builder = _Builder()
    manager = PreparedEnvironmentManager(store, builder, gc_policy=_gc_policy(build_ttl_seconds=10))
    key = "c" * 64
    store.put(PreparedEnvironmentRecord(key=key, state="building", created_at=1, updated_at=1))

    summary = await manager.run_gc_once(now=20_000)

    record = store.get(key)
    assert summary.stale_builds == 1
    assert record is not None
    assert record.state == "failed"
    assert "stale" in record.error

    cleanup = await manager.run_gc_once(now=22_000)

    assert cleanup.deleted == 1
    assert builder.delete_calls == [(key, "")]
    assert store.get(key) is None


@pytest.mark.asyncio
async def test_deletion_failure_retains_record_and_retries(tmp_path: Path) -> None:
    builder = _Builder(delete_error=RuntimeError("registry unavailable"))
    store = FilePreparedEnvironmentStore(tmp_path / "state")
    manager = PreparedEnvironmentManager(store, builder, gc_policy=_gc_policy())
    environment = await manager.ensure_ready(_action(), _runtime(tmp_path))
    record = store.get(environment.key)
    assert record is not None

    failed = await manager.run_gc_once(now=record.last_used_at + 2_000)
    retained = store.get(environment.key)
    assert failed.deletion_failures == 1
    assert retained is not None
    assert retained.state == "deleting"
    assert retained.delete_attempts == 1

    builder.delete_error = None
    retried = await manager.run_gc_once(now=record.last_used_at + 3_000)

    assert retried.deleted == 1
    assert store.get(environment.key) is None


@pytest.mark.asyncio
async def test_prepared_environment_reaper_runs_immediate_sweep() -> None:
    stop = asyncio.Event()

    class ReaperManager:
        gc_policy = _gc_policy(interval_seconds=60)

        def __init__(self) -> None:
            self.calls = 0

        async def run_gc_once(self) -> PreparedEnvironmentGCSummary:
            self.calls += 1
            stop.set()
            return PreparedEnvironmentGCSummary(scanned=1)

    manager = ReaperManager()

    await run_prepared_environment_reaper(stop, manager)  # type: ignore[arg-type]

    assert manager.calls == 1
