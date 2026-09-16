"""Content-addressed preparation of immutable skill execution images."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import io
import json
import logging
import os
import platform
import re
import tarfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncContextManager, AsyncIterator, Literal, Protocol

import portalocker
import requests
from pydantic import BaseModel, ConfigDict, Field

from app.biz.skill.resolver import ACTION_MANIFEST_SCHEMA_VERSION, ResolvedAction, ResolvedActionStep

DEFAULT_BUILDER_VERSION = "prepared-environment-v1"
DEFAULT_MAX_BUILD_CONTEXT_BYTES = 64 * 1024 * 1024
PREPARED_SKILL_RUNTIME_ROOT = "/opt/sico-skill"
DEFAULT_GC_INTERVAL_SECONDS = 5 * 60
DEFAULT_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60
DEFAULT_FAILED_TTL_SECONDS = 24 * 60 * 60
DEFAULT_BUILD_TTL_SECONDS = 60 * 60
DEFAULT_DELETE_GRACE_SECONDS = 60 * 60
DEFAULT_USAGE_LEASE_SECONDS = 900
_IMAGE_DIGEST_RE = re.compile(r"^(?:.+@)?sha256:[0-9a-f]{64}$")
_LOGGER = logging.getLogger(__name__)
_DEFAULT_MANAGER: PreparedEnvironmentManager | None = None
_DEFAULT_MANAGER_CONFIG: tuple[str, ...] | None = None


class PreparedEnvironmentError(RuntimeError):
    """Preparation could not produce a reusable immutable environment."""


@dataclass(frozen=True)
class PreparedEnvironmentGCPolicy:
    interval_seconds: int = DEFAULT_GC_INTERVAL_SECONDS
    idle_ttl_seconds: int = DEFAULT_IDLE_TTL_SECONDS
    failed_ttl_seconds: int = DEFAULT_FAILED_TTL_SECONDS
    build_ttl_seconds: int = DEFAULT_BUILD_TTL_SECONDS
    delete_grace_seconds: int = DEFAULT_DELETE_GRACE_SECONDS
    quota_bytes: int = 0
    usage_lease_seconds: int = DEFAULT_USAGE_LEASE_SECONDS

    @classmethod
    def from_env(cls) -> PreparedEnvironmentGCPolicy:
        return cls(
            quota_bytes=_nonnegative_env("TASK_RUNTIME_ENVIRONMENT_QUOTA_BYTES", cls.quota_bytes),
        )


@dataclass(frozen=True)
class PreparedEnvironmentGCSummary:
    scanned: int = 0
    marked: int = 0
    deleted: int = 0
    deletion_failures: int = 0
    stale_builds: int = 0
    active_leases: int = 0
    expired_leases: int = 0
    total_bytes: int = 0


class PreparedEnvironmentSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    base_image_digest: str
    preparation_steps: tuple[ResolvedActionStep, ...]
    runtime_digest: str
    execution_os: Literal["linux"]
    architecture: Literal["amd64", "arm64"]
    manifest_schema_version: int = ACTION_MANIFEST_SCHEMA_VERSION
    builder_version: str = DEFAULT_BUILDER_VERSION

    @property
    def key(self) -> str:
        payload = self.model_dump(mode="json")
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
        return hashlib.sha256(encoded).hexdigest()


class PreparedEnvironmentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    state: Literal["building", "ready", "failed", "deleting"]
    image: str = ""
    error: str = ""
    image_size_bytes: int = 0
    created_at: int
    updated_at: int
    last_used_at: int = 0
    marked_at: int = 0
    delete_attempts: int = 0
    leases: dict[str, int] = Field(default_factory=dict)


class PreparedEnvironmentRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str
    image: str


class PreparedImage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    image: str
    size_bytes: int = 0


class BaseImageResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image: str
    architecture: str
    digest: str
    updated_at: int


class PreparedEnvironmentBuilder(Protocol):
    async def resolve_base_image(self, image: str) -> str: ...

    async def build(self, spec: PreparedEnvironmentSpec, runtime_root: Path) -> PreparedImage: ...

    async def delete(self, key: str, image: str) -> None: ...


class PreparedEnvironmentStore(Protocol):
    def get(self, key: str) -> PreparedEnvironmentRecord | None: ...

    def put(self, record: PreparedEnvironmentRecord) -> None: ...

    def get_base_image(self, image: str, architecture: str) -> BaseImageResolution | None: ...

    def put_base_image(self, resolution: BaseImageResolution) -> None: ...

    def list_records(self) -> list[PreparedEnvironmentRecord]: ...

    def acquire_usage(self, key: str, lease_id: str, *, now: int, expires_at: int) -> PreparedEnvironmentRecord | None: ...

    def renew_usage(self, key: str, lease_id: str, *, now: int, expires_at: int) -> bool: ...

    def release_usage(self, key: str, lease_id: str, *, now: int) -> None: ...

    def mark(self, key: str, *, now: int) -> bool: ...

    def begin_delete(self, key: str, *, now: int, grace_ms: int) -> PreparedEnvironmentRecord | None: ...

    def deletion_failed(self, key: str, *, now: int, error: str) -> None: ...

    def reconcile_stale_build(self, key: str, *, now: int, stale_before: int) -> bool: ...

    def delete_record(self, key: str) -> None: ...

    def build_lock(self, key: str) -> AsyncContextManager[None]: ...

    def gc_lock(self) -> AsyncContextManager[None]: ...


class PreparedEnvironmentMetrics:
    """Small in-process lifecycle aggregator suitable for later export."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts = {
            "cache_hits": 0,
            "builds": 0,
            "waits": 0,
            "failures": 0,
            "build_ms": 0,
            "leases_acquired": 0,
            "leases_released": 0,
            "expired_leases": 0,
            "marked": 0,
            "deleted": 0,
            "deletion_failures": 0,
            "stale_builds": 0,
        }

    def increment(self, name: str, value: int = 1) -> None:
        with self._lock:
            self._counts[name] += value

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counts)


class FilePreparedEnvironmentBuildLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock: portalocker.Lock | None = None

    async def __aenter__(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = portalocker.Lock(self.path, mode="a", timeout=900)
        await asyncio.to_thread(self._lock.acquire)

    async def __aexit__(self, *_exc: object) -> None:
        lock, self._lock = self._lock, None
        if lock is not None:
            await asyncio.to_thread(lock.release)


class FilePreparedEnvironmentStore:
    """Atomic single-host store used by local deployments and tests."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.records = root / "records"
        self.lock_file = root / ".records.lock"

    def get(self, key: str) -> PreparedEnvironmentRecord | None:
        _validate_key(key)
        with self._lock():
            path = self.records / f"{key}.json"
            if not path.exists():
                return None
            return PreparedEnvironmentRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def put(self, record: PreparedEnvironmentRecord) -> None:
        _validate_key(record.key)
        with self._lock():
            path = self.records / f"{record.key}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(f".{os.getpid()}.tmp")
            temporary.write_text(record.model_dump_json(indent=2), encoding="utf-8")
            os.replace(temporary, path)

    def get_base_image(self, image: str, architecture: str) -> BaseImageResolution | None:
        path = self.root / "base-images" / f"{_base_resolution_key(image, architecture)}.json"
        with self._lock():
            if not path.exists():
                return None
            return BaseImageResolution.model_validate_json(path.read_text(encoding="utf-8"))

    def put_base_image(self, resolution: BaseImageResolution) -> None:
        path = self.root / "base-images" / f"{_base_resolution_key(resolution.image, resolution.architecture)}.json"
        with self._lock():
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(f".{os.getpid()}.tmp")
            temporary.write_text(resolution.model_dump_json(indent=2), encoding="utf-8")
            os.replace(temporary, path)

    def list_records(self) -> list[PreparedEnvironmentRecord]:
        with self._lock():
            if not self.records.exists():
                return []
            return [
                PreparedEnvironmentRecord.model_validate_json(path.read_text(encoding="utf-8"))
                for path in sorted(self.records.glob("*.json"))
            ]

    def acquire_usage(
        self,
        key: str,
        lease_id: str,
        *,
        now: int,
        expires_at: int,
    ) -> PreparedEnvironmentRecord | None:
        with self._lock():
            record = self._read_record(key)
            if record is None or record.state != "ready":
                return None
            leases = _active_leases(record, now)
            leases[lease_id] = expires_at
            record = record.model_copy(
                update={"leases": leases, "last_used_at": now, "marked_at": 0, "updated_at": now}
            )
            self._write_record(record)
            return record

    def renew_usage(self, key: str, lease_id: str, *, now: int, expires_at: int) -> bool:
        with self._lock():
            record = self._read_record(key)
            if record is None or record.state != "ready":
                return False
            leases = _active_leases(record, now)
            if lease_id not in leases:
                return False
            leases[lease_id] = expires_at
            self._write_record(record.model_copy(update={"leases": leases, "updated_at": now}))
            return True

    def release_usage(self, key: str, lease_id: str, *, now: int) -> None:
        with self._lock():
            record = self._read_record(key)
            if record is None:
                return
            leases = _active_leases(record, now)
            leases.pop(lease_id, None)
            self._write_record(record.model_copy(update={"leases": leases, "last_used_at": now, "updated_at": now}))

    def mark(self, key: str, *, now: int) -> bool:
        with self._lock():
            record = self._read_record(key)
            if record is None or record.state not in {"ready", "failed"} or _active_leases(record, now):
                return False
            if record.marked_at:
                return False
            self._write_record(record.model_copy(update={"leases": {}, "marked_at": now, "updated_at": now}))
            return True

    def begin_delete(self, key: str, *, now: int, grace_ms: int) -> PreparedEnvironmentRecord | None:
        with self._lock():
            record = self._read_record(key)
            if record is None or record.state not in {"ready", "failed", "deleting"}:
                return None
            leases = _active_leases(record, now)
            if leases:
                if leases != record.leases:
                    self._write_record(record.model_copy(update={"leases": leases, "updated_at": now}))
                return None
            if record.state != "deleting" and (not record.marked_at or now - record.marked_at < grace_ms):
                return None
            deleting = record.model_copy(update={"state": "deleting", "leases": {}, "updated_at": now})
            self._write_record(deleting)
            return deleting

    def deletion_failed(self, key: str, *, now: int, error: str) -> None:
        with self._lock():
            record = self._read_record(key)
            if record is None:
                return
            self._write_record(
                record.model_copy(
                    update={
                        "state": "deleting",
                        "error": error,
                        "delete_attempts": record.delete_attempts + 1,
                        "updated_at": now,
                    }
                )
            )

    def reconcile_stale_build(self, key: str, *, now: int, stale_before: int) -> bool:
        with self._lock():
            record = self._read_record(key)
            if record is None or record.state != "building" or record.updated_at > stale_before:
                return False
            self._write_record(
                record.model_copy(
                    update={"state": "failed", "error": "prepared environment build became stale", "updated_at": now}
                )
            )
            return True

    def delete_record(self, key: str) -> None:
        _validate_key(key)
        with self._lock():
            path = self.records / f"{key}.json"
            record = self._read_record(key)
            if record is not None and record.state != "deleting":
                raise PreparedEnvironmentError("refusing to delete prepared environment metadata before image deletion")
            path.unlink(missing_ok=True)

    def build_lock(self, key: str) -> FilePreparedEnvironmentBuildLock:
        _validate_key(key)
        return FilePreparedEnvironmentBuildLock(self.root / "build-locks" / f"{key}.lock")

    def gc_lock(self) -> FilePreparedEnvironmentBuildLock:
        return FilePreparedEnvironmentBuildLock(self.root / ".gc.lock")

    def _read_record(self, key: str) -> PreparedEnvironmentRecord | None:
        _validate_key(key)
        path = self.records / f"{key}.json"
        if not path.exists():
            return None
        return PreparedEnvironmentRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def _write_record(self, record: PreparedEnvironmentRecord) -> None:
        path = self.records / f"{record.key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f".{os.getpid()}.{uuid.uuid4().hex}.tmp")
        temporary.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        os.replace(temporary, path)

    def _lock(self):
        self.root.mkdir(parents=True, exist_ok=True)
        return portalocker.Lock(self.lock_file, mode="a", timeout=30)


class HttpPreparedEnvironmentBuilder:
    """Client for the deployment-owned OCI environment builder service."""

    def __init__(self, endpoint: str, *, timeout_seconds: int = 900) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def resolve_base_image(self, image: str) -> str:
        return await asyncio.to_thread(self._resolve_base_image, image)

    async def build(self, spec: PreparedEnvironmentSpec, runtime_root: Path) -> PreparedImage:
        context = await asyncio.to_thread(_runtime_tar, runtime_root)
        return await asyncio.to_thread(self._build, spec, context)

    async def delete(self, key: str, image: str) -> None:
        await asyncio.to_thread(self._delete, key, image)

    def _resolve_base_image(self, image: str) -> str:
        response = requests.post(
            f"{self.endpoint}/v1/images/resolve",
            json={"image": image},
            timeout=30,
        )
        response.raise_for_status()
        digest = str(response.json().get("image") or "")
        _validate_image_digest(digest)
        return digest

    def _build(self, spec: PreparedEnvironmentSpec, context: bytes) -> PreparedImage:
        response = requests.post(
            f"{self.endpoint}/v1/environments/build",
            data={"key": spec.key, "spec": spec.model_dump_json()},
            files={"context": ("runtime.tar", context, "application/x-tar")},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        image = str(payload.get("image") or "")
        _validate_image_digest(image)
        return PreparedImage(image=image, size_bytes=max(0, int(payload.get("size_bytes") or 0)))

    def _delete(self, key: str, image: str) -> None:
        response = requests.delete(
            f"{self.endpoint}/v1/environments/{key}",
            json={"image": image},
            timeout=300,
        )
        response.raise_for_status()


class PreparedEnvironmentManager:
    """Resolve, build once, and reuse immutable environments in one Core process."""

    def __init__(
        self,
        store: PreparedEnvironmentStore,
        builder: PreparedEnvironmentBuilder,
        *,
        builder_version: str = DEFAULT_BUILDER_VERSION,
        architecture: str | None = None,
        metrics: PreparedEnvironmentMetrics | None = None,
        gc_policy: PreparedEnvironmentGCPolicy | None = None,
    ) -> None:
        self.store = store
        self.builder = builder
        self.builder_version = builder_version
        self.architecture = _normalize_architecture(architecture or platform.machine())
        self.metrics = metrics or PreparedEnvironmentMetrics()
        self.gc_policy = gc_policy or PreparedEnvironmentGCPolicy.from_env()
        self._inflight: dict[str, asyncio.Task[PreparedEnvironmentRef]] = {}
        self._inflight_lock = asyncio.Lock()

    async def ensure_ready(self, action: ResolvedAction, runtime_root: Path) -> PreparedEnvironmentRef:
        execution_backend = action.execution_requirement.backend
        if execution_backend == "any":
            from .command.selection import active_backend_kind

            configured_backend = active_backend_kind()
            execution_backend = {"k8s": "kubernetes", "runner": "docker"}.get(
                configured_backend, configured_backend
            )
        if execution_backend not in {"docker", "kubernetes"}:
            raise PreparedEnvironmentError("prepared environments require docker or kubernetes execution")
        base_image = action.execution_requirement.image or os.getenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", "").strip()
        if not base_image:
            raise PreparedEnvironmentError("prepared environment base image is not configured")
        try:
            base_digest = await self.builder.resolve_base_image(base_image)
        except Exception as exc:
            cached_base = await asyncio.to_thread(self.store.get_base_image, base_image, self.architecture)
            if cached_base is None:
                raise PreparedEnvironmentError(f"prepared environment base image resolution failed: {exc}") from exc
            base_digest = cached_base.digest
        _validate_image_digest(base_digest)
        await asyncio.to_thread(
            self.store.put_base_image,
            BaseImageResolution(
                image=base_image,
                architecture=self.architecture,
                digest=base_digest,
                updated_at=_now_ms(),
            ),
        )
        spec = PreparedEnvironmentSpec(
            base_image_digest=base_digest,
            preparation_steps=tuple(action.preparation.steps),
            runtime_digest=runtime_content_digest(runtime_root),
            execution_os="linux",
            architecture=self.architecture,
            builder_version=self.builder_version,
        )
        ready = await asyncio.to_thread(self.store.get, spec.key)
        if ready is not None and ready.state == "ready":
            _validate_image_digest(ready.image)
            self.metrics.increment("cache_hits")
            return PreparedEnvironmentRef(key=spec.key, image=ready.image)
        async with self._inflight_lock:
            task = self._inflight.get(spec.key)
            if task is None:
                task = asyncio.create_task(self._build(spec, runtime_root))
                self._inflight[spec.key] = task
            else:
                self.metrics.increment("waits")
        try:
            return await asyncio.shield(task)
        finally:
            if task.done():
                async with self._inflight_lock:
                    if self._inflight.get(spec.key) is task:
                        self._inflight.pop(spec.key, None)

    @asynccontextmanager
    async def use(self, action: ResolvedAction, runtime_root: Path) -> AsyncIterator[PreparedEnvironmentRef]:
        environment = await self.ensure_ready(action, runtime_root)
        lease_id = uuid.uuid4().hex
        now = _now_ms()
        expires_at = now + self.gc_policy.usage_lease_seconds * 1000
        acquired = await asyncio.to_thread(
            self.store.acquire_usage,
            environment.key,
            lease_id,
            now=now,
            expires_at=expires_at,
        )
        if acquired is None:
            raise PreparedEnvironmentError("prepared environment became unavailable before execution")
        self.metrics.increment("leases_acquired")
        stop = asyncio.Event()
        renewal = asyncio.create_task(self._renew_usage(environment.key, lease_id, stop))
        try:
            yield environment
        finally:
            stop.set()
            renewal.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renewal
            await asyncio.to_thread(self.store.release_usage, environment.key, lease_id, now=_now_ms())
            self.metrics.increment("leases_released")

    async def _renew_usage(self, key: str, lease_id: str, stop: asyncio.Event) -> None:
        interval = max(1, self.gc_policy.usage_lease_seconds // 3)
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except TimeoutError:
                now = _now_ms()
                renewed = await asyncio.to_thread(
                    self.store.renew_usage,
                    key,
                    lease_id,
                    now=now,
                    expires_at=now + self.gc_policy.usage_lease_seconds * 1000,
                )
                if not renewed:
                    _LOGGER.warning("prepared_environment_lease_renewal_failed key=%s", key)
                    return

    async def run_gc_once(self, *, now: int | None = None) -> PreparedEnvironmentGCSummary:
        now = _now_ms() if now is None else now
        async with self.store.gc_lock():
            records = await asyncio.to_thread(self.store.list_records)
            active_leases = sum(len(_active_leases(record, now)) for record in records)
            expired_leases = sum(len(record.leases) - len(_active_leases(record, now)) for record in records)
            if expired_leases:
                self.metrics.increment("expired_leases", expired_leases)
            stale_builds = await self._reconcile_stale_builds(records, now)
            records = await asyncio.to_thread(self.store.list_records)
            candidates, total_bytes = self._gc_candidates(records, now)
            marked = await self._mark_candidates(candidates, now)
            records = await asyncio.to_thread(self.store.list_records)
            deleted, deletion_failures = await self._delete_candidates(records, now)

        return PreparedEnvironmentGCSummary(
            scanned=len(records),
            marked=marked,
            deleted=deleted,
            deletion_failures=deletion_failures,
            stale_builds=stale_builds,
            active_leases=active_leases,
            expired_leases=expired_leases,
            total_bytes=total_bytes,
        )

    async def _reconcile_stale_builds(self, records: list[PreparedEnvironmentRecord], now: int) -> int:
        stale_before = now - self.gc_policy.build_ttl_seconds * 1000
        reconciled = 0
        for record in records:
            if record.state != "building" or record.updated_at > stale_before:
                continue
            async with self.store.build_lock(record.key):
                changed = await asyncio.to_thread(
                    self.store.reconcile_stale_build,
                    record.key,
                    now=now,
                    stale_before=stale_before,
                )
            if changed:
                reconciled += 1
                self.metrics.increment("stale_builds")
        return reconciled

    def _gc_candidates(
        self,
        records: list[PreparedEnvironmentRecord],
        now: int,
    ) -> tuple[set[str], int]:
        candidates: set[str] = set()
        for record in records:
            age_from = record.last_used_at or record.updated_at
            if record.state == "ready" and now - age_from >= self.gc_policy.idle_ttl_seconds * 1000:
                candidates.add(record.key)
            elif record.state == "failed" and now - record.updated_at >= self.gc_policy.failed_ttl_seconds * 1000:
                candidates.add(record.key)
        ready = [record for record in records if record.state == "ready"]
        total_bytes = sum(record.image_size_bytes for record in ready)
        remaining = total_bytes
        for record in sorted(ready, key=lambda item: (item.last_used_at or item.updated_at, item.key)):
            if not self.gc_policy.quota_bytes or remaining <= self.gc_policy.quota_bytes:
                break
            if _active_leases(record, now):
                continue
            candidates.add(record.key)
            remaining -= record.image_size_bytes
        return candidates, total_bytes

    async def _mark_candidates(self, candidates: set[str], now: int) -> int:
        marked = 0
        for key in sorted(candidates):
            if await asyncio.to_thread(self.store.mark, key, now=now):
                marked += 1
                self.metrics.increment("marked")
        return marked

    async def _delete_candidates(self, records: list[PreparedEnvironmentRecord], now: int) -> tuple[int, int]:
        deleted = failures = 0
        grace_ms = self.gc_policy.delete_grace_seconds * 1000
        for record in records:
            if record.state not in {"ready", "failed", "deleting"}:
                continue
            async with self.store.build_lock(record.key):
                deleting = await asyncio.to_thread(
                    self.store.begin_delete,
                    record.key,
                    now=now,
                    grace_ms=grace_ms,
                )
                if deleting is None:
                    continue
                try:
                    await self.builder.delete(deleting.key, deleting.image)
                    await asyncio.to_thread(self.store.delete_record, deleting.key)
                except Exception as exc:
                    failures += 1
                    self.metrics.increment("deletion_failures")
                    await asyncio.to_thread(
                        self.store.deletion_failed,
                        deleting.key,
                        now=now,
                        error=str(exc),
                    )
                else:
                    deleted += 1
                    self.metrics.increment("deleted")
        return deleted, failures

    async def _build(self, spec: PreparedEnvironmentSpec, runtime_root: Path) -> PreparedEnvironmentRef:
        async with self.store.build_lock(spec.key):
            existing = await asyncio.to_thread(self.store.get, spec.key)
            if existing is not None and existing.state == "ready":
                self.metrics.increment("cache_hits")
                return PreparedEnvironmentRef(key=spec.key, image=existing.image)
            if existing is not None and existing.state == "deleting":
                raise PreparedEnvironmentError("prepared environment is being deleted; retry later")
            now = _now_ms()
            self.metrics.increment("builds")
            await asyncio.to_thread(
                self.store.put,
                PreparedEnvironmentRecord(
                    key=spec.key,
                    state="building",
                    created_at=now,
                    updated_at=now,
                ),
            )
            try:
                prepared = await self.builder.build(spec, runtime_root)
                _validate_image_digest(prepared.image)
            except Exception as exc:
                failed_at = _now_ms()
                self.metrics.increment("failures")
                self.metrics.increment("build_ms", max(0, failed_at - now))
                await asyncio.to_thread(
                    self.store.put,
                    PreparedEnvironmentRecord(
                        key=spec.key,
                        state="failed",
                        error=str(exc),
                        created_at=now,
                        updated_at=failed_at,
                    ),
                )
                raise PreparedEnvironmentError(f"prepared environment build failed: {exc}") from exc
            ready_at = _now_ms()
            self.metrics.increment("build_ms", max(0, ready_at - now))
            await asyncio.to_thread(
                self.store.put,
                PreparedEnvironmentRecord(
                    key=spec.key,
                    state="ready",
                    image=prepared.image,
                    image_size_bytes=prepared.size_bytes,
                    created_at=now,
                    updated_at=ready_at,
                    last_used_at=ready_at,
                ),
            )
            return PreparedEnvironmentRef(key=spec.key, image=prepared.image)


def default_prepared_environment_manager() -> PreparedEnvironmentManager | None:
    global _DEFAULT_MANAGER, _DEFAULT_MANAGER_CONFIG
    endpoint = os.getenv("TASK_RUNTIME_ENVIRONMENT_BUILDER_ENDPOINT", "").strip()
    root = os.getenv("TASK_RUNTIME_PREPARED_ENV_ROOT", "").strip()
    if not endpoint and not root:
        return None
    if not endpoint or not root:
        raise ValueError(
            "TASK_RUNTIME_ENVIRONMENT_BUILDER_ENDPOINT and TASK_RUNTIME_PREPARED_ENV_ROOT must be configured together"
        )
    builder_version = os.getenv("TASK_RUNTIME_ENVIRONMENT_BUILDER_VERSION", DEFAULT_BUILDER_VERSION).strip()
    builder_version = builder_version or DEFAULT_BUILDER_VERSION
    architecture = os.getenv("TASK_RUNTIME_PREPARED_ENV_ARCHITECTURE", "").strip()
    gc_policy = PreparedEnvironmentGCPolicy.from_env()
    config = (endpoint, root, builder_version, architecture, repr(gc_policy))
    if _DEFAULT_MANAGER is not None and _DEFAULT_MANAGER_CONFIG == config:
        return _DEFAULT_MANAGER
    _DEFAULT_MANAGER = PreparedEnvironmentManager(
        FilePreparedEnvironmentStore(Path(root)),
        HttpPreparedEnvironmentBuilder(endpoint),
        builder_version=builder_version,
        architecture=architecture or None,
        gc_policy=gc_policy,
    )
    _DEFAULT_MANAGER_CONFIG = config
    return _DEFAULT_MANAGER


async def run_prepared_environment_reaper(
    stop_event: asyncio.Event,
    manager: PreparedEnvironmentManager | None = None,
) -> None:
    manager = manager or default_prepared_environment_manager()
    if manager is None:
        _LOGGER.info("prepared_environment_reaper_disabled reason=not-configured")
        return
    while not stop_event.is_set():
        try:
            summary = await manager.run_gc_once()
            _LOGGER.info(
                "prepared_environment_gc scanned=%d marked=%d deleted=%d failures=%d stale_builds=%d "
                "active_leases=%d expired_leases=%d total_bytes=%d",
                summary.scanned,
                summary.marked,
                summary.deleted,
                summary.deletion_failures,
                summary.stale_builds,
                summary.active_leases,
                summary.expired_leases,
                summary.total_bytes,
            )
        except Exception:  # noqa: BLE001 - one failed sweep must not stop future reclamation.
            _LOGGER.warning("prepared_environment_gc_iteration_failed", exc_info=True)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=manager.gc_policy.interval_seconds)
        except TimeoutError:
            continue


def runtime_content_digest(runtime_root: Path) -> str:
    root = runtime_root.resolve()
    if not root.is_dir():
        raise PreparedEnvironmentError(f"skill runtime is unavailable: {runtime_root}")
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise PreparedEnvironmentError(f"skill runtime contains a symbolic link: {relative}")
        if not path.is_file():
            continue
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(str(path.stat().st_mode & 0o777).encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _runtime_tar(runtime_root: Path) -> bytes:
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w") as archive:
        for path in sorted(runtime_root.resolve().rglob("*")):
            relative = path.relative_to(runtime_root.resolve()).as_posix()
            if path.is_symlink():
                raise PreparedEnvironmentError(f"skill runtime contains a symbolic link: {relative}")
            archive.add(path, arcname=relative, recursive=False)
            if payload.tell() > DEFAULT_MAX_BUILD_CONTEXT_BYTES:
                raise PreparedEnvironmentError("prepared environment build context is too large")
    result = payload.getvalue()
    if len(result) > DEFAULT_MAX_BUILD_CONTEXT_BYTES:
        raise PreparedEnvironmentError("prepared environment build context is too large")
    return result


def _validate_key(key: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", key):
        raise ValueError("invalid prepared environment key")


def _base_resolution_key(image: str, architecture: str) -> str:
    return hashlib.sha256(f"{architecture}\0{image}".encode()).hexdigest()


def _validate_image_digest(image: str) -> None:
    if not _IMAGE_DIGEST_RE.fullmatch(image):
        raise PreparedEnvironmentError("environment builder did not return an immutable image digest")


def _normalize_architecture(value: str) -> Literal["amd64", "arm64"]:
    architecture = value.strip().lower()
    aliases = {"x86_64": "amd64", "x64": "amd64", "aarch64": "arm64"}
    normalized = aliases.get(architecture, architecture)
    if normalized not in {"amd64", "arm64"}:
        raise PreparedEnvironmentError(f"unsupported prepared environment architecture: {value}")
    return normalized  # type: ignore[return-value]


def _active_leases(record: PreparedEnvironmentRecord, now: int) -> dict[str, int]:
    return {lease_id: expires_at for lease_id, expires_at in record.leases.items() if expires_at > now}


def _nonnegative_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < 0:
        raise ValueError(f"{name} must not be negative")
    return value


def _now_ms() -> int:
    return int(time.time() * 1000)
