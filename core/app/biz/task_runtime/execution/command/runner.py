"""HTTP command backend served by the isolated environment-runner service."""

from __future__ import annotations

import asyncio
from dataclasses import replace

import requests

from .contracts import CommandBackend, CommandResult, CommandSession, CommandSpec, container_env


class EnvironmentRunnerBackend:
    def __init__(self, endpoint: str, *, timeout_seconds: int = 900) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def run(self, spec: CommandSpec) -> CommandResult:
        return await asyncio.to_thread(self._run, spec)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return _EnvironmentRunnerSession(self, pod_name=pod_name, image=image)

    def _run(self, spec: CommandSpec) -> CommandResult:
        response = requests.post(
            f"{self.endpoint}/v1/commands/run",
            json={
                "argv": spec.argv,
                "image": spec.image,
                "cwd": spec.cwd,
                "env": container_env(spec.env),
                "mounts": [
                    {"mount_path": mount.mount_path, "read_only": mount.read_only} for mount in spec.mounts
                ],
                "timeout_seconds": spec.timeout_seconds,
                "name": spec.pod_name,
            },
            timeout=(spec.timeout_seconds + 30) if spec.timeout_seconds else self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        return CommandResult(
            return_code=int(payload.get("return_code", -1)),
            stdout=str(payload.get("stdout") or ""),
            stderr=str(payload.get("stderr") or ""),
            system_error=str(payload.get("system_error") or ""),
        )


class _EnvironmentRunnerSession:
    def __init__(self, backend: CommandBackend, *, pod_name: str, image: str) -> None:
        self._backend = backend
        self._pod_name = pod_name
        self._image = image

    async def run(self, spec: CommandSpec) -> CommandResult:
        return await self._backend.run(
            replace(spec, pod_name=spec.pod_name or self._pod_name, image=spec.image or self._image)
        )

    async def aclose(self) -> None:
        return None
