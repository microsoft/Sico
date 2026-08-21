"""Per-run Kubernetes pod command backend."""

from __future__ import annotations

import contextlib
import os
import re
import shlex
from typing import TYPE_CHECKING

from .contracts import CommandMount, CommandResult, CommandSession, CommandSpec, container_env, to_host_path

if TYPE_CHECKING:
    from app.storage.sandbox_pod import ExecResult, SandboxPod, VolumeMount

_VALID_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _sandbox_volume_mounts(mounts: list[CommandMount]) -> list["VolumeMount"]:
    from app.storage.sandbox_pod import VolumeMount

    claim = os.getenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "").strip()
    if not claim:
        return [
            VolumeMount(
                name=mount.name,
                mount_path=mount.mount_path,
                read_only=mount.read_only,
                host_path=to_host_path(mount.host_path),
            )
            for mount in mounts
        ]

    root_override = os.getenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", "").strip()
    if root_override:
        root = root_override.rstrip("/") or "/"
    else:
        from app.storage.fs import storage_pvc_root

        root = storage_pvc_root()
    volume_mounts: list[VolumeMount] = []
    for mount in mounts:
        sub_path = os.path.relpath(mount.mount_path, root)
        if sub_path == ".." or sub_path.startswith(".." + os.sep):
            raise ValueError(
                f"sandbox mount {mount.mount_path!r} is not under storage root {root!r}; "
                "set RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT to the PVC mount root"
            )
        volume_mounts.append(
            VolumeMount(
                name=mount.name,
                mount_path=mount.mount_path,
                read_only=mount.read_only,
                claim_name=claim,
                sub_path=sub_path,
            )
        )
    return volume_mounts


def _quote_argv(argv: list[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in argv)


def _build_shell_script(spec: CommandSpec, *, include_cd: bool, env_overrides: dict[str, str] | None = None) -> str:
    lines: list[str] = []
    for key, value in (env_overrides or {}).items():
        if not _VALID_ENV_NAME_RE.match(key):
            raise ValueError(f"refusing to export invalid environment variable name: {key!r}")
        lines.append(f"export {key}={shlex.quote(value)}")
    if include_cd and spec.cwd:
        lines.append(f"cd {shlex.quote(spec.cwd)}")
    lines.append(f"exec {_quote_argv(spec.argv)}")
    return "\n".join(lines)


class K8sPodBackend:
    """Run commands in a fresh sandbox pod, with optional per-run reuse."""

    def __init__(self, pod: SandboxPod | None = None) -> None:
        if pod is None:
            from app.storage.sandbox_pod import SandboxPod

            pod = SandboxPod.from_env()
        self.pod = pod

    async def run(self, spec: CommandSpec) -> CommandResult:
        pod = self._runner_pod(spec.image)
        pod_name = spec.pod_name or "task-runner"
        command = ["sh", "-lc", _build_shell_script(spec, include_cd=True)]
        try:
            await pod.ensure(
                pod_name,
                user_id=spec.metadata.get("user_label", "task-runner"),
                agent_instance_id=int(spec.metadata.get("agent_instance_id") or 0),
                mounts=_sandbox_volume_mounts(spec.mounts),
                env=container_env(spec.env),
            )
            result = await pod.exec(pod_name, command, timeout=spec.timeout_seconds)
            return _from_exec_result(result)
        finally:
            with contextlib.suppress(Exception):
                await pod.delete(pod_name)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return _K8sPodSession(self, pod_name=pod_name or "task-runner", default_image=image)

    def _runner_pod(self, image: str) -> SandboxPod:
        from app.storage.sandbox_pod import SandboxPod

        return SandboxPod(
            namespace=self.pod.namespace,
            image=image or self.pod.image,
            workdir=self.pod.workdir,
            resources=self.pod.resources,
            app_label_value="task-runner",
        )


def _from_exec_result(result: ExecResult) -> CommandResult:
    return CommandResult(
        return_code=result.return_code,
        stdout=result.stdout,
        stderr=result.stderr,
        system_error=result.system_error,
    )


class _K8sPodSession:
    def __init__(self, backend: K8sPodBackend, *, pod_name: str, default_image: str = "") -> None:
        self._backend = backend
        self._pod_name = pod_name
        self._default_image = default_image
        self._pod: SandboxPod | None = None
        self._ensured_env: dict[str, str] = {}

    async def run(self, spec: CommandSpec) -> CommandResult:
        env = container_env(spec.env)
        env_overrides: dict[str, str] = {}
        if self._pod is None:
            self._pod = self._backend._runner_pod(spec.image or self._default_image)
            await self._pod.ensure(
                self._pod_name,
                user_id=spec.metadata.get("user_label", "task-runner"),
                agent_instance_id=int(spec.metadata.get("agent_instance_id") or 0),
                mounts=_sandbox_volume_mounts(spec.mounts),
                env=env,
            )
            self._ensured_env = env
        else:
            env_overrides = {key: value for key, value in env.items() if self._ensured_env.get(key) != value}
        command = ["sh", "-lc", _build_shell_script(spec, include_cd=True, env_overrides=env_overrides)]
        result = await self._pod.exec(self._pod_name, command, timeout=spec.timeout_seconds)
        return _from_exec_result(result)

    async def aclose(self) -> None:
        if self._pod is None:
            return
        pod, self._pod = self._pod, None
        with contextlib.suppress(Exception):
            await pod.delete(self._pod_name)
