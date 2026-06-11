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

"""Tests for the pure-function helpers in :mod:`app.storage.sandbox_pod`.

The K8s plumbing (``ensure`` / ``exec`` / ``cleanup_for_user``) is left to
integration coverage; mocking the kubernetes client at unit level is brittle
and high-noise. These tests pin down the small bits of logic that have
behavioural contracts other modules rely on:

- :func:`label_selector_for_user` is part of the public surface — external
  GC tools depend on the exact format.
- :func:`SandboxPod.from_env` is the env-driven constructor whose defaults
  must remain stable for compose / helm deployments.
- :func:`_parse_exec_exit_code` is the parser whose return code surfaces all
  the way back to the LLM; regressions here change tool semantics.
"""

from __future__ import annotations

import json
import threading
from types import SimpleNamespace
from typing import Any

import pytest

from app.storage.sandbox_pod import (
    DEFAULT_IMAGE,
    DEFAULT_NAMESPACE,
    ExecResult,
    PodResources,
    SandboxPod,
    VolumeMount,
    _parse_exec_exit_code,
    label_selector_for_user,
)


def test_label_selector_format_is_stable() -> None:
    selector = label_selector_for_user(42, "alice")
    # Comma-separated equality matches; whitespace is *not* permitted by the
    # K8s label selector syntax and a stray space would silently make this
    # selector match nothing.
    assert " " not in selector
    parts = sorted(selector.split(","))
    assert parts == sorted(
        [
            "app=run-command",
            "sico-agent-instance-id=42",
            "sico-user-id=alice",
        ]
    )


def test_from_env_uses_defaults_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "RUN_PYTHON_TOOL_SANDBOX_NAMESPACE",
        "TASK_RUNTIME_PYTHON_RUNNER_IMAGE",
        "RUN_PYTHON_TOOL_SANDBOX_CPU_REQUEST",
        "RUN_PYTHON_TOOL_SANDBOX_CPU_LIMIT",
        "RUN_PYTHON_TOOL_SANDBOX_MEMORY_REQUEST",
        "RUN_PYTHON_TOOL_SANDBOX_MEMORY_LIMIT",
    ):
        monkeypatch.delenv(name, raising=False)
    pod = SandboxPod.from_env()
    assert pod.namespace == DEFAULT_NAMESPACE
    assert pod.image == DEFAULT_IMAGE
    assert pod.resources == PodResources()


def test_from_env_overrides_namespace_image_and_resources(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_NAMESPACE", "skills-test")
    monkeypatch.setenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", "registry.example/sico/skill-sandbox:1.2")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_CPU_REQUEST", "200m")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_CPU_LIMIT", "2")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_MEMORY_REQUEST", "128Mi")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_MEMORY_LIMIT", "1Gi")
    pod = SandboxPod.from_env()
    assert pod.namespace == "skills-test"
    assert pod.image == "registry.example/sico/skill-sandbox:1.2"
    assert pod.resources == PodResources(
        cpu_request="200m",
        cpu_limit="2",
        memory_request="128Mi",
        memory_limit="1Gi",
    )


def test_from_env_treats_blank_strings_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    # Operators sometimes set "" to mean "leave default"; the helper must
    # not propagate that as the image tag or k8s will reject pod creation.
    monkeypatch.setenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", "   ")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_NAMESPACE", "")
    pod = SandboxPod.from_env()
    assert pod.image == DEFAULT_IMAGE
    assert pod.namespace == DEFAULT_NAMESPACE


class _StubExecResp:
    """Mimic the subset of the kubernetes-client exec response we read."""

    def __init__(self, channel_payload: Any) -> None:
        self._payload = channel_payload

    def read_channel(self, channel: int) -> str:
        assert channel == 3
        if self._payload is None:
            return ""
        return json.dumps(self._payload)


def test_parse_exec_exit_code_returns_zero_on_empty_envelope() -> None:
    # When the error channel is empty kubectl treats the command as
    # successful — we must match that to avoid spurious non-zero codes.
    assert _parse_exec_exit_code(_StubExecResp(None), []) == 0


def test_parse_exec_exit_code_returns_zero_on_success_status() -> None:
    assert _parse_exec_exit_code(_StubExecResp({"status": "Success"}), []) == 0


def test_parse_exec_exit_code_extracts_explicit_exit_code() -> None:
    envelope = {
        "status": "Failure",
        "details": {"causes": [{"reason": "ExitCode", "message": "42"}]},
    }
    assert _parse_exec_exit_code(_StubExecResp(envelope), []) == 42


def test_parse_exec_exit_code_falls_back_when_envelope_malformed() -> None:
    class _Broken:
        def read_channel(self, channel: int) -> str:
            return "{not json"

    # No stderr written -> treat as success (0); presence of stderr -> 1.
    assert _parse_exec_exit_code(_Broken(), []) == 0
    assert _parse_exec_exit_code(_Broken(), ["oops"]) == 1


def test_parse_exec_exit_code_handles_non_integer_exit_message() -> None:
    envelope = {
        "status": "Failure",
        "details": {"causes": [{"reason": "ExitCode", "message": "not-an-int"}]},
    }
    # Should fall back to 1 rather than raise so the LLM sees a meaningful
    # return code even when k8s sends something unexpected.
    assert _parse_exec_exit_code(_StubExecResp(envelope), []) == 1


def test_exec_sync_streaming_handshake_error_is_reported_as_system_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The exec websocket handshake is performed lazily on first read, so a
    # missing/terminal pod raises ApiException *inside* the streaming loop rather
    # than at k8s_stream setup. That transport error must surface as an
    # ExecResult(return_code=-1, system_error=...) — callers map a populated
    # system_error to a retryable transient fault — instead of escaping as an
    # uncatchable exception that fails the run as an opaque INTERNAL error.
    from kubernetes.client.rest import ApiException

    from app.storage import sandbox_pod as sp

    class _HandshakeResp:
        def is_open(self) -> bool:
            raise ApiException(status=404, reason="Handshake status 404 Not Found")

        def close(self) -> None:
            pass

    pod = SandboxPod()
    # Exec runs on a per-thread, isolated client (``_exec_api``), never the cached
    # REST client, so stub that factory rather than ``_api`` -- this also keeps the
    # test off any real kube config.
    fake_exec_api = SimpleNamespace(connect_get_namespaced_pod_exec=object())
    monkeypatch.setattr(sp, "_exec_api", lambda: fake_exec_api)
    monkeypatch.setattr(sp, "k8s_stream", lambda *args, **kwargs: _HandshakeResp())

    result = pod._exec_sync("missing-pod", ["echo", "hi"], 0)

    assert isinstance(result, ExecResult)
    assert result.return_code == -1
    assert result.stdout == ""
    assert "missing-pod" in result.system_error
    assert "404" in result.system_error


def test_exec_sync_binds_to_exec_api_not_the_cached_rest_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Regression guard for the shared-client corruption incident: kubernetes'
    # ``stream()`` swaps ``ApiClient.request`` in place for the exec websocket, so
    # exec MUST run on the per-thread exec client and never the cached REST client
    # used by ensure/cleanup/the reaper -- otherwise a concurrent REST call or exec
    # picks up the websocket transport and fails the handshake (the incident that
    # failed 49/52 runs with ``Handshake status 200 OK``/``404``). Assert the bound
    # method handed to ``k8s_stream`` comes from the exec client, not the cached one.
    from app.storage import sandbox_pod as sp

    cached_api = SimpleNamespace(connect_get_namespaced_pod_exec="CACHED-do-not-use")
    monkeypatch.setattr(sp, "_core_v1_api", lambda: cached_api)
    monkeypatch.setattr(SandboxPod, "_api", lambda self: cached_api)

    exec_api = SimpleNamespace(connect_get_namespaced_pod_exec="FRESH-exec-client")
    monkeypatch.setattr(sp, "_exec_api", lambda: exec_api)

    class _ClosedResp:
        def is_open(self) -> bool:
            return False

        def peek_stdout(self) -> bool:
            return False

        def peek_stderr(self) -> bool:
            return False

        def read_channel(self, channel: int) -> str:
            return ""  # empty error envelope -> exit code 0

        def close(self) -> None:
            pass

    captured: dict[str, Any] = {}

    def _fake_stream(connect: Any, *args: Any, **kwargs: Any) -> _ClosedResp:
        captured["connect"] = connect
        return _ClosedResp()

    monkeypatch.setattr(sp, "k8s_stream", _fake_stream)

    result = SandboxPod()._exec_sync("pod-x", ["true"], 0)

    # Exec bound to the dedicated client, never the cached REST client.
    assert captured["connect"] == "FRESH-exec-client"
    assert result.return_code == 0


def test_exec_api_is_thread_local_and_reused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ``_exec_api`` must hand out one dedicated client per worker thread and reuse
    # it across calls: the per-thread cache keeps the exec websocket swap thread-
    # confined (the corruption fix) while avoiding a fresh connection pool per exec.
    from app.storage import sandbox_pod as sp

    # Fresh thread-local + no-op config load so the test never touches kube config.
    monkeypatch.setattr(sp, "_EXEC_API_LOCAL", threading.local())
    monkeypatch.setattr(sp, "_core_v1_api", lambda: None)

    built: list[object] = []

    class _FakeApiClient:
        pass

    def _fake_core_v1_api(api_client: Any = None) -> SimpleNamespace:
        obj = SimpleNamespace(api_client=api_client)
        built.append(obj)
        return obj

    monkeypatch.setattr(sp.k8s_client, "ApiClient", _FakeApiClient)
    monkeypatch.setattr(sp.k8s_client, "CoreV1Api", _fake_core_v1_api)

    first = sp._exec_api()
    second = sp._exec_api()

    assert first is second  # reused within the same thread
    assert len(built) == 1  # client built exactly once per thread

    # A different worker thread gets its own dedicated client.
    other: list[object] = []
    worker = threading.Thread(target=lambda: other.append(sp._exec_api()))
    worker.start()
    worker.join()

    assert other[0] is not first
    assert len(built) == 2


def _volumes_by_name(pod: Any) -> dict[str, Any]:
    return {v.name: v for v in pod.spec.volumes}


def _mounts_by_name(pod: Any) -> dict[str, Any]:
    return {m.name: m for m in pod.spec.containers[0].volume_mounts}


def test_build_pod_spec_uses_hostpath_source_by_default() -> None:
    pod = SandboxPod()._build_pod_spec(
        "task-run-1",
        "alice",
        7,
        [VolumeMount(name="workspace", mount_path="/mnt/storage/chat/ws", host_path="/node/chat/ws", read_only=True)],
        {},
    )
    volume = _volumes_by_name(pod)["workspace"]
    assert volume.host_path is not None
    assert volume.host_path.path == "/node/chat/ws"
    assert volume.host_path.type == "DirectoryOrCreate"
    assert volume.persistent_volume_claim is None
    mount = _mounts_by_name(pod)["workspace"]
    assert mount.mount_path == "/mnt/storage/chat/ws"
    assert mount.read_only is True
    # hostPath mounts carry no sub_path.
    assert mount.sub_path is None


def test_build_pod_spec_uses_pvc_source_with_sub_path() -> None:
    # Networked storage: the sandbox references the same claim core uses and the
    # mount is scoped to a sub_path so it sees the exact bytes core wrote.
    pod = SandboxPod()._build_pod_spec(
        "task-run-1",
        "alice",
        7,
        [
            VolumeMount(
                name="skill-runtime",
                mount_path="/mnt/storage/skills/agent/42/runtime",
                claim_name="core-storage",
                sub_path="skills/agent/42/runtime",
            )
        ],
        {},
    )
    volume = _volumes_by_name(pod)["skill-runtime"]
    assert volume.persistent_volume_claim is not None
    assert volume.persistent_volume_claim.claim_name == "core-storage"
    assert volume.host_path is None
    mount = _mounts_by_name(pod)["skill-runtime"]
    assert mount.mount_path == "/mnt/storage/skills/agent/42/runtime"
    assert mount.sub_path == "skills/agent/42/runtime"


def test_build_pod_spec_dedupes_one_volume_per_shared_claim() -> None:
    # The workspace and a skill runtime both live on the one chat PVC. They must
    # collapse to a single V1Volume (referencing the same claim twice deadlocks
    # the kubelet mount on NFS/CSI), with each mount scoped by its own sub_path.
    pod = SandboxPod()._build_pod_spec(
        "task-run-1",
        "alice",
        7,
        [
            VolumeMount(
                name="workspace",
                mount_path="/mnt/storage/chat/ws",
                claim_name="core-storage",
                sub_path="ws",
            ),
            VolumeMount(
                name="skill-runtime",
                mount_path="/mnt/storage/chat/ws/skills/42/runtime",
                claim_name="core-storage",
                sub_path="ws/skills/42/runtime",
            ),
        ],
        {},
    )
    # Exactly one volume for the shared claim...
    assert len(pod.spec.volumes) == 1
    (volume,) = pod.spec.volumes
    assert volume.persistent_volume_claim.claim_name == "core-storage"
    # ...but both mounts are present, each scoped by its own sub_path and both
    # referencing the single shared volume.
    mounts = pod.spec.containers[0].volume_mounts
    assert len(mounts) == 2
    assert all(m.name == volume.name for m in mounts)
    sub_paths = {m.mount_path: m.sub_path for m in mounts}
    assert sub_paths == {
        "/mnt/storage/chat/ws": "ws",
        "/mnt/storage/chat/ws/skills/42/runtime": "ws/skills/42/runtime",
    }


def test_build_pod_spec_rejects_mount_without_a_source() -> None:
    # The dataclass defaults make a sourceless mount constructible; an empty
    # hostPath would silently bind the node CWD, so spec assembly must refuse it.
    with pytest.raises(ValueError, match="neither host_path nor claim_name"):
        SandboxPod()._build_pod_spec(
            "task-run-1",
            "alice",
            7,
            [VolumeMount(name="workspace", mount_path="/mnt/storage/chat/ws")],
            {},
        )


# ---------------------------------------------------------------------------
# Orphan pod reclamation (activeDeadlineSeconds + reaper + shutdown cleanup)
# ---------------------------------------------------------------------------


def _hostpath_mount() -> VolumeMount:
    return VolumeMount(name="workspace", mount_path="/ws", host_path="/node/ws", read_only=True)


def _build_spec_with_default_mount() -> Any:
    return SandboxPod()._build_pod_spec("task-run-1", "alice", 7, [_hostpath_mount()], {})


def test_build_pod_spec_applies_default_active_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    # The platform backstop: every pod is born with a deadline so a leaked
    # ``sleep infinity`` pod self-terminates even if its core driver is gone.
    from app.storage import sandbox_pod as sp

    monkeypatch.delenv("TASK_RUNTIME_POD_ACTIVE_DEADLINE_SECONDS", raising=False)
    spec = _build_spec_with_default_mount()
    assert spec.spec.active_deadline_seconds == sp._DEFAULT_POD_ACTIVE_DEADLINE_SECONDS


def test_build_pod_spec_active_deadline_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_POD_ACTIVE_DEADLINE_SECONDS", "1234")
    spec = _build_spec_with_default_mount()
    assert spec.spec.active_deadline_seconds == 1234


def test_build_pod_spec_active_deadline_zero_omits_field(monkeypatch: pytest.MonkeyPatch) -> None:
    # ``0`` is the explicit "no deadline" escape hatch; k8s must see the field
    # omitted (None) rather than a literal 0 (which it would reject).
    monkeypatch.setenv("TASK_RUNTIME_POD_ACTIVE_DEADLINE_SECONDS", "0")
    spec = _build_spec_with_default_mount()
    assert spec.spec.active_deadline_seconds is None


def _fake_pod(name: str, phase: str, *, age_seconds: float = 0.0) -> Any:
    from datetime import datetime, timedelta, timezone

    created = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
    return SimpleNamespace(
        metadata=SimpleNamespace(name=name, creation_timestamp=created),
        status=SimpleNamespace(phase=phase),
    )


class _RecordingApi:
    def __init__(self, pods: list[Any]) -> None:
        self._pods = pods
        self.deleted: list[str] = []

    def list_namespaced_pod(self, namespace: str, label_selector: str) -> Any:
        # The reaper must use a set-based selector spanning every app label it
        # provisions; a stray equality selector would miss task-runner pods.
        assert "in (" in label_selector
        return SimpleNamespace(items=self._pods)

    def delete_namespaced_pod(self, name: str, namespace: str, body: Any) -> None:
        self.deleted.append(name)


def test_reap_removes_terminal_and_aged_running_only(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.storage import sandbox_pod as sp

    pods = [
        _fake_pod("done", "Succeeded"),
        _fake_pod("crashed", "Failed"),
        _fake_pod("young-running", "Running", age_seconds=60),
        _fake_pod("old-orphan", "Running", age_seconds=100_000),
        _fake_pod("young-pending", "Pending", age_seconds=5),
    ]
    api = _RecordingApi(pods)
    monkeypatch.setattr(sp, "_core_v1_api", lambda: api)

    reaped = sp._reap_orphan_pods_sync("python-sandbox", ceiling_seconds=10_800)

    # Terminal pods go immediately; only the aged Running pod is reaped, never
    # the young ones (a healthy long run must survive).
    assert set(api.deleted) == {"done", "crashed", "old-orphan"}
    assert reaped == 3


def test_reap_age_rule_disabled_keeps_running_pods(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.storage import sandbox_pod as sp

    pods = [
        _fake_pod("old-orphan", "Running", age_seconds=100_000),
        _fake_pod("crashed", "Failed"),
    ]
    api = _RecordingApi(pods)
    monkeypatch.setattr(sp, "_core_v1_api", lambda: api)

    # ceiling=0 disables the age rule; terminal pods are still reaped.
    reaped = sp._reap_orphan_pods_sync("python-sandbox", ceiling_seconds=0)

    assert api.deleted == ["crashed"]
    assert reaped == 1


def test_reap_swallows_list_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    from kubernetes.client.rest import ApiException

    from app.storage import sandbox_pod as sp

    class _BoomApi:
        def list_namespaced_pod(self, namespace: str, label_selector: str) -> Any:
            raise ApiException(status=500, reason="boom")

    monkeypatch.setattr(sp, "_core_v1_api", lambda: _BoomApi())
    # A transient API failure must not crash the reaper loop.
    assert sp._reap_orphan_pods_sync("python-sandbox", ceiling_seconds=10_800) == 0


def test_delete_pods_sync_counts_only_real_deletes(monkeypatch: pytest.MonkeyPatch) -> None:
    from kubernetes.client.rest import ApiException

    from app.storage import sandbox_pod as sp

    class _Api:
        def __init__(self) -> None:
            self.calls: list[str] = []

        def delete_namespaced_pod(self, name: str, namespace: str, body: Any) -> None:
            self.calls.append(name)
            if name == "already-gone":
                raise ApiException(status=404, reason="not found")

    api = _Api()
    monkeypatch.setattr(sp, "_core_v1_api", lambda: api)

    deleted = sp._delete_pods_sync([("ns", "already-gone"), ("ns", "live")])

    # Both attempted; the suppressed 404 is not counted as a real delete.
    assert api.calls == ["already-gone", "live"]
    assert deleted == 1


def test_delete_tracked_sandbox_pods_drains_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio as _asyncio

    from app.storage import sandbox_pod as sp

    class _Api:
        def __init__(self) -> None:
            self.deleted: list[tuple[str, str]] = []

        def delete_namespaced_pod(self, name: str, namespace: str, body: Any) -> None:
            self.deleted.append((namespace, name))

    api = _Api()
    monkeypatch.setattr(sp, "_core_v1_api", lambda: api)
    sp._LIVE_PODS.clear()
    sp._LIVE_PODS.add(("python-sandbox", "task-run-aaa"))
    sp._LIVE_PODS.add(("python-sandbox", "task-run-bbb"))

    deleted = _asyncio.run(sp.delete_tracked_sandbox_pods())

    assert deleted == 2
    assert set(api.deleted) == {
        ("python-sandbox", "task-run-aaa"),
        ("python-sandbox", "task-run-bbb"),
    }
    # The registry is drained so a later sweep / second shutdown is a no-op.
    assert sp._LIVE_PODS == set()


def test_delete_tracked_sandbox_pods_noop_when_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio as _asyncio

    from app.storage import sandbox_pod as sp

    sp._LIVE_PODS.clear()
    assert _asyncio.run(sp.delete_tracked_sandbox_pods()) == 0


def test_reap_interval_is_floored(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.storage import sandbox_pod as sp

    # A too-aggressive interval is clamped up so a typo cannot busy-loop the API.
    monkeypatch.setenv("TASK_RUNTIME_POD_REAP_INTERVAL_SECONDS", "1")
    assert sp._pod_reap_interval_seconds() == 10

    monkeypatch.setenv("TASK_RUNTIME_POD_REAP_INTERVAL_SECONDS", "not-a-number")
    assert sp._pod_reap_interval_seconds() == sp._DEFAULT_POD_REAP_INTERVAL_SECONDS
