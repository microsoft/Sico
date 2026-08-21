import asyncio
import contextlib
import json
import os
from pathlib import Path
import sys

import pytest

from app.biz.task_runtime.execution.command import contracts as command_contracts
from app.biz.task_runtime.execution.command import kubernetes as kubernetes_backend
from app.biz.task_runtime.execution.command import selection as backend
from app.biz.task_runtime.execution.command.contracts import (
    CommandMount,
    CommandResult,
    CommandSpec,
    readonly_input_mounts,
    to_host_path,
)
from app.biz.task_runtime.execution.command.docker import DockerBackend
from app.biz.task_runtime.execution.command.kubernetes import K8sPodBackend
from app.biz.task_runtime.execution.command.limiter import limit_backend
from app.biz.task_runtime.execution.command.local import LocalBackend
from app.biz.task_runtime.execution.command.selection import select_backend
from app.biz.task_runtime.execution.resources import ResourceGate


class _AdmissionSession:
    def __init__(self, owner: "_AdmissionBackend") -> None:
        self._owner = owner

    async def run(self, spec: CommandSpec) -> CommandResult:
        return await self._owner.run(spec)

    async def aclose(self) -> None:
        self._owner.close_calls += 1


class _AdmissionBackend:
    def __init__(self, *, block: bool = False) -> None:
        self.block = block
        self.release = asyncio.Event()
        self.started = asyncio.Event()
        self.calls = 0
        self.active = 0
        self.peak = 0
        self.close_calls = 0

    async def run(self, spec: CommandSpec) -> CommandResult:
        self.calls += 1
        self.active += 1
        self.peak = max(self.peak, self.active)
        self.started.set()
        try:
            if self.block:
                await self.release.wait()
            return CommandResult(return_code=0)
        finally:
            self.active -= 1

    def open_session(self, *, pod_name: str = "", image: str = "") -> _AdmissionSession:
        return _AdmissionSession(self)


# --- physical backend admission -------------------------------------------


@pytest.mark.asyncio
async def test_limited_backend_shares_one_permit_between_direct_and_session_calls():
    inner = _AdmissionBackend(block=True)
    limited = limit_backend(inner, gate=ResourceGate(), key="k8s_pod", limit=1)
    direct = asyncio.create_task(limited.run(CommandSpec(argv=["direct"])))
    await inner.started.wait()
    session = limited.open_session(pod_name="child")
    nested = asyncio.create_task(session.run(CommandSpec(argv=["nested"])))
    await asyncio.sleep(0)

    assert inner.calls == 1
    assert inner.peak == 1

    inner.release.set()
    await asyncio.gather(direct, nested)
    await session.aclose()

    assert inner.calls == 2
    assert inner.peak == 1


@pytest.mark.asyncio
async def test_independent_backend_wrappers_share_the_same_gate():
    gate = ResourceGate()
    first_inner = _AdmissionBackend(block=True)
    second_inner = _AdmissionBackend()
    first = limit_backend(first_inner, gate=gate, key="docker", limit=1)
    second = limit_backend(second_inner, gate=gate, key="docker", limit=1)
    holding = asyncio.create_task(first.run(CommandSpec(argv=["batch-1"])))
    await first_inner.started.wait()
    waiting = asyncio.create_task(second.run(CommandSpec(argv=["batch-2"])))
    await asyncio.sleep(0)

    assert second_inner.calls == 0

    first_inner.release.set()
    await asyncio.gather(holding, waiting)

    assert second_inner.calls == 1


@pytest.mark.asyncio
async def test_limited_session_holds_permit_between_steps_until_close():
    inner = _AdmissionBackend()
    limited = limit_backend(inner, gate=ResourceGate(), key="k8s_pod", limit=1)
    session = limited.open_session(pod_name="multi-step")
    await session.run(CommandSpec(argv=["step-1"]))
    competing = asyncio.create_task(limited.run(CommandSpec(argv=["other"])))
    await asyncio.sleep(0)

    assert inner.calls == 1

    await session.aclose()
    await competing
    await session.aclose()

    assert inner.calls == 2
    assert inner.close_calls == 1
    with pytest.raises(RuntimeError, match="closed"):
        await session.run(CommandSpec(argv=["step-2"]))


@pytest.mark.asyncio
async def test_limited_backend_releases_permit_when_call_is_cancelled():
    inner = _AdmissionBackend(block=True)
    limited = limit_backend(inner, gate=ResourceGate(), key="docker", limit=1)
    first = asyncio.create_task(limited.run(CommandSpec(argv=["first"])))
    await inner.started.wait()
    first.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await first

    inner.block = False
    second = await asyncio.wait_for(limited.run(CommandSpec(argv=["second"])), timeout=1)

    assert second.return_code == 0
    assert inner.calls == 2


def test_limit_backend_leaves_unbucketed_local_backend_unwrapped():
    inner = LocalBackend()

    assert limit_backend(inner, gate=ResourceGate(), key=None, limit=10) is inner


# --- select_backend ---------------------------------------------------------


@pytest.mark.parametrize(
    ("env_value", "expected_type"),
    [("local", LocalBackend), ("docker", DockerBackend), ("k8s", K8sPodBackend)],
)
def test_select_backend_explicit_env_wins(monkeypatch, env_value, expected_type):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", env_value)
    # is_in_cluster must never be consulted when the env is explicit.
    monkeypatch.setattr(backend, "is_in_cluster", lambda: True)
    chosen = select_backend(pod=object())  # pod only used by k8s; object() is fine since k8s won't .from_env()
    assert isinstance(chosen, expected_type)


def test_select_backend_explicit_env_is_case_insensitive(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "  Docker  ")
    assert isinstance(select_backend(), DockerBackend)


def test_select_backend_rejects_unknown_value(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "podman")
    with pytest.raises(ValueError, match="unknown TASK_RUNTIME_BACKEND"):
        select_backend()


def test_select_backend_auto_detects_k8s_in_cluster(monkeypatch):
    monkeypatch.delenv("TASK_RUNTIME_BACKEND", raising=False)
    monkeypatch.setattr(backend, "is_in_cluster", lambda: True)
    assert isinstance(select_backend(pod=object()), K8sPodBackend)


def test_select_backend_auto_detects_local_off_cluster(monkeypatch):
    monkeypatch.delenv("TASK_RUNTIME_BACKEND", raising=False)
    monkeypatch.setattr(backend, "is_in_cluster", lambda: False)
    assert isinstance(select_backend(), LocalBackend)


def test_select_backend_never_auto_selects_docker(monkeypatch):
    monkeypatch.delenv("TASK_RUNTIME_BACKEND", raising=False)
    monkeypatch.setattr(backend, "is_in_cluster", lambda: False)
    assert not isinstance(select_backend(), DockerBackend)


def test_auto_detect_falls_back_to_local_when_detection_raises(monkeypatch):
    def boom() -> bool:
        raise RuntimeError("no kube config")

    monkeypatch.setattr(backend, "is_in_cluster", boom)
    assert backend._auto_detect_backend() == "local"


# --- backend_resource_key ---------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "expected"),
    [("local", None), ("docker", "docker"), ("k8s", "k8s_pod")],
)
def test_backend_resource_key_maps_each_backend(kind, expected):
    assert backend.backend_resource_key(kind) == expected


def test_backend_resource_key_reads_active_backend(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "k8s")
    assert backend.backend_resource_key() == "k8s_pod"


def test_backend_resource_key_local_when_auto_detect_off_cluster(monkeypatch):
    monkeypatch.delenv("TASK_RUNTIME_BACKEND", raising=False)
    monkeypatch.setattr(backend, "is_in_cluster", lambda: False)
    assert backend.backend_resource_key() is None


def test_active_backend_kind_explicit_env_wins(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_BACKEND", "  Docker  ")
    assert backend.active_backend_kind() == "docker"


# --- LocalBackend -----------------------------------------------------------


@pytest.mark.asyncio
async def test_local_backend_runs_argv_and_captures_stdout(tmp_path):
    spec = CommandSpec(argv=[sys.executable, "-c", "print('hello-local')"], cwd=str(tmp_path))
    result = await LocalBackend().run(spec)
    assert result.return_code == 0
    assert "hello-local" in result.stdout
    assert result.stderr == ""
    assert result.system_error == ""


@pytest.mark.asyncio
async def test_local_backend_respects_cwd(tmp_path):
    spec = CommandSpec(argv=[sys.executable, "-c", "import os; print(os.getcwd())"], cwd=str(tmp_path))
    result = await LocalBackend().run(spec)
    assert os.path.realpath(result.stdout.strip()) == os.path.realpath(str(tmp_path))


@pytest.mark.asyncio
async def test_local_backend_merges_env(tmp_path):
    spec = CommandSpec(
        argv=[sys.executable, "-c", "import os; print(os.environ['SICO_TEST_VAR'])"],
        cwd=str(tmp_path),
        env={"SICO_TEST_VAR": "from-spec"},
    )
    result = await LocalBackend().run(spec)
    assert result.stdout.strip() == "from-spec"


@pytest.mark.asyncio
async def test_local_backend_does_not_inherit_host_python_environment(monkeypatch, tmp_path):
    host_venv = tmp_path / "core-venv"
    host_venv_bin = host_venv / ("Scripts" if sys.platform == "win32" else "bin")
    safe_bin = tmp_path / "system-bin"
    monkeypatch.setenv("VIRTUAL_ENV", str(host_venv))
    monkeypatch.setenv("UV_PROJECT_ENVIRONMENT", str(host_venv))
    monkeypatch.setenv("PATH", os.pathsep.join((str(host_venv_bin), str(safe_bin))))
    script = (
        "import json, os; "
        "print(json.dumps({key: os.environ.get(key) for key in "
        "('VIRTUAL_ENV', 'UV_PROJECT_ENVIRONMENT', 'PATH')}))"
    )

    result = await LocalBackend().run(CommandSpec(argv=[sys.executable, "-c", script], cwd=str(tmp_path)))

    child_env = json.loads(result.stdout)
    assert child_env["VIRTUAL_ENV"] is None
    assert child_env["UV_PROJECT_ENVIRONMENT"] is None
    assert child_env["PATH"].split(os.pathsep) == [str(safe_bin)]


@pytest.mark.asyncio
async def test_local_backend_uses_first_mount_when_cwd_unset(tmp_path):
    spec = CommandSpec(
        argv=[sys.executable, "-c", "import os; print(os.getcwd())"],
        mounts=[CommandMount(name="workspace", host_path=str(tmp_path), mount_path="/workspace")],
    )
    result = await LocalBackend().run(spec)
    assert os.path.realpath(result.stdout.strip()) == os.path.realpath(str(tmp_path))


@pytest.mark.asyncio
async def test_local_backend_reports_nonzero_return_code(tmp_path):
    spec = CommandSpec(argv=[sys.executable, "-c", "import sys; sys.exit(3)"], cwd=str(tmp_path))
    result = await LocalBackend().run(spec)
    assert result.return_code == 3


@pytest.mark.asyncio
async def test_local_backend_times_out(tmp_path):
    spec = CommandSpec(
        argv=[sys.executable, "-c", "import time; time.sleep(5)"],
        cwd=str(tmp_path),
        timeout_seconds=1,
    )
    result = await LocalBackend().run(spec)
    assert result.return_code == -1
    assert "timed out" in result.system_error


# --- DockerBackend (argv assembly only; no docker daemon required) ----------


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX host paths get a drive prefix when resolved on Windows")
def test_docker_backend_builds_argv_with_mounts_env_and_image():
    spec = CommandSpec(
        argv=["python", "main.py"],
        image="python:3.13-slim",
        cwd="/workspace",
        env={"FOO": "bar"},
        mounts=[
            CommandMount(name="workspace", host_path="/host/ws", mount_path="/workspace"),
            CommandMount(name="skill", host_path="/host/skill", mount_path="/skill", read_only=True),
        ],
        pod_name="run-123",
    )
    argv = DockerBackend()._build_docker_argv(spec)
    assert argv == [
        "docker",
        "run",
        "--rm",
        "--name",
        "run-123",
        "-w",
        "/workspace",
        "-v",
        "/host/ws:/workspace",
        "-v",
        "/host/skill:/skill:ro",
        "-e",
        "FOO=bar",
        "python:3.13-slim",
        "python",
        "main.py",
    ]


def test_authorized_source_mount_uses_isolated_object_directory() -> None:
    source = Path("/storage/chat/.source-repository/workspace/objects/deadbeef/source.csv")

    mounts = readonly_input_mounts((source, source))

    assert mounts == [
        CommandMount(
            name="source-input-0",
            host_path=str(source.parent),
            mount_path=str(source.parent),
            read_only=True,
        )
    ]


def test_docker_backend_defaults_to_k8s_sandbox_image_when_unset(monkeypatch):
    from app.storage.sandbox_pod import DEFAULT_IMAGE

    monkeypatch.delenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", raising=False)
    spec = CommandSpec(argv=["echo", "hi"])
    argv = DockerBackend()._build_docker_argv(spec)
    assert DEFAULT_IMAGE in argv


def test_docker_backend_uses_k8s_sandbox_image_env_override(monkeypatch):
    monkeypatch.setenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", "example.com/sico/task-runner:test")
    spec = CommandSpec(argv=["echo", "hi"])
    argv = DockerBackend()._build_docker_argv(spec)
    assert "example.com/sico/task-runner:test" in argv


def test_container_env_forwards_configured_python_index_only(monkeypatch):
    monkeypatch.delenv("UV_DEFAULT_INDEX", raising=False)
    assert command_contracts.container_env({"A": "b"}) == {"A": "b"}

    monkeypatch.setenv("UV_DEFAULT_INDEX", "https://example.test/pypi/simple")
    assert command_contracts.container_env({"A": "b"}) == {
        "A": "b",
        "UV_DEFAULT_INDEX": "https://example.test/pypi/simple",
    }


# --- to_host_path -----------------------------------------------------------


def test_to_host_path_is_identity_without_env(monkeypatch, tmp_path):
    monkeypatch.delenv("TASK_RUNTIME_CONTAINER_HOSTPATH_BASE", raising=False)
    monkeypatch.delenv("TASK_RUNTIME_SKILL_HOSTPATH_BASE", raising=False)
    assert to_host_path(str(tmp_path)) == str(tmp_path.resolve())


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX host-path prefix assertion uses forward-slash semantics")
def test_to_host_path_maps_chat_root_prefix(monkeypatch):
    from app.storage.fs import CHAT_FS

    monkeypatch.setenv("TASK_RUNTIME_CONTAINER_HOSTPATH_BASE", "/node/chat")
    inside = CHAT_FS.root.resolve() / "agent" / "ws"
    assert to_host_path(inside) == os.path.join("/node/chat", "agent", "ws")


# --- _sandbox_volume_mounts (hostPath vs PVC storage source) ----------------


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX host-path prefix assertion uses forward-slash semantics")
def test_sandbox_volume_mounts_default_to_hostpath(monkeypatch):
    monkeypatch.delenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", raising=False)
    monkeypatch.delenv("TASK_RUNTIME_CONTAINER_HOSTPATH_BASE", raising=False)
    monkeypatch.delenv("TASK_RUNTIME_SKILL_HOSTPATH_BASE", raising=False)
    (mount,) = kubernetes_backend._sandbox_volume_mounts(
        [CommandMount(name="workspace", host_path="/mnt/storage/chat/ws", mount_path="/mnt/storage/chat/ws", read_only=True)]
    )
    assert mount.host_path == "/mnt/storage/chat/ws"
    assert mount.claim_name == ""
    assert mount.sub_path == ""
    assert mount.read_only is True


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX host-path prefix assertion uses forward-slash semantics")
def test_sandbox_volume_mounts_use_pvc_with_relative_sub_path(monkeypatch):
    # Networked storage: every mount references the shared claim, scoped to its
    # path relative to the claim mount root, so the pod sees core's bytes.
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "core-storage")
    monkeypatch.delenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", raising=False)
    mounts = kubernetes_backend._sandbox_volume_mounts(
        [
            CommandMount(name="workspace", host_path="/x", mount_path="/mnt/storage/chat/ws", read_only=True),
            CommandMount(name="skill-runtime", host_path="/y", mount_path="/mnt/storage/chat/ws/skills/42/runtime"),
        ]
    )
    workspace, runtime = mounts
    assert workspace.claim_name == "core-storage"
    assert workspace.sub_path == "ws"
    assert workspace.read_only is True
    assert runtime.claim_name == "core-storage"
    assert runtime.sub_path == "ws/skills/42/runtime"


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX host-path prefix assertion uses forward-slash semantics")
def test_sandbox_volume_mounts_honor_custom_storage_root(monkeypatch):
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "chat-pvc")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", "/data")
    (mount,) = kubernetes_backend._sandbox_volume_mounts(
        [CommandMount(name="workspace", host_path="/x", mount_path="/data/chat/ws")]
    )
    assert mount.sub_path == "chat/ws"


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX host-path prefix assertion uses forward-slash semantics")
def test_sandbox_volume_mounts_auto_derive_storage_root(monkeypatch):
    # No ROOT env: the claim mount root defaults to the chat root, so operators
    # only ever supply the single claim name.
    from app.storage.fs import storage_pvc_root

    assert storage_pvc_root() == "/mnt/storage/chat"
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "core-storage")
    monkeypatch.delenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", raising=False)
    (mount,) = kubernetes_backend._sandbox_volume_mounts(
        [CommandMount(name="skill-runtime", host_path="/y", mount_path="/mnt/storage/chat/ws/skills/42/runtime")]
    )
    assert mount.claim_name == "core-storage"
    assert mount.sub_path == "ws/skills/42/runtime"


def test_sandbox_volume_mounts_reject_path_outside_storage_root(monkeypatch):
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "core-storage")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", "/mnt/storage")
    with pytest.raises(ValueError, match="not under storage root"):
        kubernetes_backend._sandbox_volume_mounts(
            [CommandMount(name="x", host_path="/x", mount_path="/elsewhere/ws")]
        )


# --- CommandSession (per-run handle) ----------------------------------------


@pytest.mark.asyncio
async def test_local_session_runs_each_spec_independently(tmp_path):
    session = LocalBackend().open_session()
    try:
        first = await session.run(CommandSpec(argv=[sys.executable, "-c", "print('a')"], cwd=str(tmp_path)))
        second = await session.run(CommandSpec(argv=[sys.executable, "-c", "print('b')"], cwd=str(tmp_path)))
    finally:
        await session.aclose()
    assert first.stdout.strip() == "a"
    assert second.stdout.strip() == "b"


@pytest.mark.asyncio
async def test_docker_session_is_stateless_passthrough():
    session = DockerBackend().open_session()
    assert isinstance(session, command_contracts.StatelessSession)
    await session.aclose()  # no daemon required; teardown is a no-op


class _FakePod:
    """Records the pod lifecycle so the session can be tested without a cluster."""

    def __init__(self) -> None:
        self.ensure_calls = 0
        self.exec_calls = 0
        self.delete_calls = 0
        self.exec_commands: list[list[str]] = []

    async def ensure(self, pod_name, *, user_id, agent_instance_id, mounts, env):  # noqa: ANN001
        self.ensure_calls += 1

    async def exec(self, pod_name, command, *, timeout):  # noqa: ANN001
        self.exec_calls += 1
        self.exec_commands.append(command)
        from types import SimpleNamespace

        return SimpleNamespace(return_code=0, stdout=f"out-{self.exec_calls}", stderr="", system_error="")

    async def delete(self, pod_name):  # noqa: ANN001
        self.delete_calls += 1


@pytest.mark.asyncio
async def test_k8s_session_reuses_one_pod_across_steps_and_deletes_on_close():
    fake = _FakePod()
    be = K8sPodBackend(pod=object())
    be._runner_pod = lambda image: fake  # type: ignore[method-assign]

    session = be.open_session(pod_name="run-xyz")
    spec = CommandSpec(
        argv=["echo", "hi"],
        image="img:1",
        mounts=[CommandMount(name="ws", host_path="/h/ws", mount_path="/ws")],
        env={"A": "b"},
    )
    try:
        r1 = await session.run(spec)
        r2 = await session.run(spec)
    finally:
        await session.aclose()

    assert fake.ensure_calls == 1  # one pod for the whole run
    assert fake.exec_calls == 2  # one exec per step
    assert fake.delete_calls == 1  # pod deleted exactly once
    assert r1.return_code == 0
    assert r2.stdout == "out-2"


@pytest.mark.asyncio
async def test_k8s_session_aclose_without_run_does_not_touch_pod():
    fake = _FakePod()
    be = K8sPodBackend(pod=object())
    be._runner_pod = lambda image: fake  # type: ignore[method-assign]

    session = be.open_session(pod_name="run-empty")
    await session.aclose()

    assert fake.ensure_calls == 0
    assert fake.delete_calls == 0


@pytest.mark.asyncio
async def test_k8s_session_injects_per_step_env_overrides():
    fake = _FakePod()
    be = K8sPodBackend(pod=object())
    be._runner_pod = lambda image: fake  # type: ignore[method-assign]

    session = be.open_session(pod_name="run-env")
    first = CommandSpec(argv=["echo", "1"], env={"A": "1", "B": "keep"})
    # B unchanged, A changed, C is new -> only A and C are exported on step 2.
    second = CommandSpec(argv=["echo", "2"], env={"A": "2", "B": "keep", "C": "new val"})
    try:
        await session.run(first)
        await session.run(second)
    finally:
        await session.aclose()

    # First step: pod env set at ensure time, no export lines in the script.
    first_script = fake.exec_commands[0][2]
    assert "export A=" not in first_script
    # Second step: only diverging keys exported, with shell quoting for spaces.
    second_script = fake.exec_commands[1][2]
    assert "export A=2" in second_script
    assert "export C='new val'" in second_script
    assert "export B=" not in second_script  # unchanged key not re-exported


def test_build_shell_script_quotes_env_values():
    spec = CommandSpec(argv=["echo", "hi"], env={})
    script = kubernetes_backend._build_shell_script(
        spec,
        include_cd=False,
        env_overrides={"SICO_A": "a b; rm -rf /"},
    )
    # The whole value is a single shell token; metacharacters cannot escape.
    assert "export SICO_A='a b; rm -rf /'" in script


def test_build_shell_script_rejects_invalid_env_name():
    spec = CommandSpec(argv=["echo", "hi"], env={})
    with pytest.raises(ValueError, match="invalid environment variable name"):
        kubernetes_backend._build_shell_script(
            spec,
            include_cd=False,
            env_overrides={"BAD=NAME; rm -rf /": "x"},
        )
