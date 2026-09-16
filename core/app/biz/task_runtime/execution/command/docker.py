"""Throwaway Docker-container command backend."""

from __future__ import annotations

import asyncio
import os
from dataclasses import replace

from .contracts import CommandResult, CommandSession, CommandSpec, container_env, to_host_path
from .local import collect_subprocess


class DockerBackend:
    def __init__(self, *, docker_path: str = "docker") -> None:
        self.docker_path = docker_path

    async def run(self, spec: CommandSpec) -> CommandResult:
        proc = await asyncio.create_subprocess_exec(
            *self._build_docker_argv(spec),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return await collect_subprocess(proc, spec.timeout_seconds)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return _DockerSession(self, pod_name=pod_name, image=image)

    def _build_docker_argv(self, spec: CommandSpec) -> list[str]:
        argv: list[str] = [self.docker_path, "run", "--rm"]
        if spec.pod_name:
            argv += ["--name", spec.pod_name]
        if spec.cwd:
            argv += ["-w", spec.cwd]
        for mount in spec.mounts:
            mount_spec = f"{to_host_path(mount.host_path)}:{mount.mount_path}"
            if mount.read_only:
                mount_spec += ":ro"
            argv += ["-v", mount_spec]
        for key, value in container_env(spec.env).items():
            argv += ["-e", f"{key}={value}"]
        argv.append(spec.image or _default_runner_image())
        argv += list(spec.argv)
        return argv


def _default_runner_image() -> str:
    from app.storage.sandbox_pod import DEFAULT_IMAGE

    return os.getenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", DEFAULT_IMAGE).strip() or DEFAULT_IMAGE


class _DockerSession:
    def __init__(self, backend: DockerBackend, *, pod_name: str, image: str) -> None:
        self._backend = backend
        self._pod_name = pod_name
        self._image = image

    async def run(self, spec: CommandSpec) -> CommandResult:
        return await self._backend.run(
            replace(
                spec,
                pod_name=spec.pod_name or self._pod_name,
                image=spec.image or self._image,
            )
        )

    async def aclose(self) -> None:
        return None
