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

import os
import sys

import pytest

from app.biz.task_runtime.executors import command_backend as backend
from app.biz.task_runtime.executors.command_backend import (
    CommandSpec,
    DockerBackend,
    K8sPodBackend,
    LocalBackend,
    CommandMount,
    select_backend,
    to_host_path,
)


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


def test_sandbox_volume_mounts_default_to_hostpath(monkeypatch):
    monkeypatch.delenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", raising=False)
    monkeypatch.delenv("TASK_RUNTIME_CONTAINER_HOSTPATH_BASE", raising=False)
    monkeypatch.delenv("TASK_RUNTIME_SKILL_HOSTPATH_BASE", raising=False)
    (mount,) = backend._sandbox_volume_mounts(
        [CommandMount(name="workspace", host_path="/mnt/storage/chat/ws", mount_path="/mnt/storage/chat/ws", read_only=True)]
    )
    assert mount.host_path == "/mnt/storage/chat/ws"
    assert mount.claim_name == ""
    assert mount.sub_path == ""
    assert mount.read_only is True


def test_sandbox_volume_mounts_use_pvc_with_relative_sub_path(monkeypatch):
    # Networked storage: every mount references the shared claim, scoped to its
    # path relative to the claim mount root, so the pod sees core's bytes.
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "core-storage")
    monkeypatch.delenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", raising=False)
    mounts = backend._sandbox_volume_mounts(
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


def test_sandbox_volume_mounts_honor_custom_storage_root(monkeypatch):
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "chat-pvc")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", "/data")
    (mount,) = backend._sandbox_volume_mounts([CommandMount(name="workspace", host_path="/x", mount_path="/data/chat/ws")])
    assert mount.sub_path == "chat/ws"


def test_sandbox_volume_mounts_auto_derive_storage_root(monkeypatch):
    # No ROOT env: the claim mount root defaults to the chat root, so operators
    # only ever supply the single claim name.
    from app.storage.fs import storage_pvc_root

    assert storage_pvc_root() == "/mnt/storage/chat"
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "core-storage")
    monkeypatch.delenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", raising=False)
    (mount,) = backend._sandbox_volume_mounts(
        [CommandMount(name="skill-runtime", host_path="/y", mount_path="/mnt/storage/chat/ws/skills/42/runtime")]
    )
    assert mount.claim_name == "core-storage"
    assert mount.sub_path == "ws/skills/42/runtime"


def test_sandbox_volume_mounts_reject_path_outside_storage_root(monkeypatch):
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "core-storage")
    monkeypatch.setenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", "/mnt/storage")
    with pytest.raises(ValueError, match="not under storage root"):
        backend._sandbox_volume_mounts([CommandMount(name="x", host_path="/x", mount_path="/elsewhere/ws")])


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
    assert isinstance(session, backend._StatelessSession)
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
    script = backend._build_shell_script(
        spec,
        include_cd=False,
        env_overrides={"SICO_A": "a b; rm -rf /"},
    )
    # The whole value is a single shell token; metacharacters cannot escape.
    assert "export SICO_A='a b; rm -rf /'" in script


def test_build_shell_script_rejects_invalid_env_name():
    spec = CommandSpec(argv=["echo", "hi"], env={})
    with pytest.raises(ValueError, match="invalid environment variable name"):
        backend._build_shell_script(
            spec,
            include_cd=False,
            env_overrides={"BAD=NAME; rm -rf /": "x"},
        )
