"""Host subprocess command backend."""

from __future__ import annotations

import asyncio
import contextlib
import os

from .contracts import CommandResult, CommandSession, CommandSpec, StatelessSession


class LocalBackend:
    """Run commands directly on the host without filesystem isolation."""

    async def run(self, spec: CommandSpec) -> CommandResult:
        cwd = spec.cwd or _first_mount_host_path(spec) or os.getcwd()
        env = _local_subprocess_env(spec.env)
        proc = await asyncio.create_subprocess_exec(
            *spec.argv,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return await collect_subprocess(proc, spec.timeout_seconds)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return StatelessSession(self)


def _local_subprocess_env(overrides: dict[str, str]) -> dict[str, str]:
    env = dict(os.environ)
    inherited_venv_roots = {
        value
        for name in ("VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT")
        if (value := env.pop(name, ""))
    }
    if path := env.get("PATH"):
        inherited_executable_dirs = {
            os.path.normcase(os.path.realpath(os.path.join(root, directory)))
            for root in inherited_venv_roots
            for directory in ("bin", "Scripts")
        }
        env["PATH"] = os.pathsep.join(
            entry
            for entry in path.split(os.pathsep)
            if os.path.normcase(os.path.realpath(entry)) not in inherited_executable_dirs
        )
    env.update(overrides)
    return env


def _first_mount_host_path(spec: CommandSpec) -> str:
    for mount in spec.mounts:
        if mount.host_path:
            return mount.host_path
    return ""


async def collect_subprocess(proc: asyncio.subprocess.Process, timeout_seconds: int) -> CommandResult:
    try:
        if timeout_seconds and timeout_seconds > 0:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        else:
            stdout_bytes, stderr_bytes = await proc.communicate()
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        with contextlib.suppress(Exception):
            await proc.wait()
        return CommandResult(return_code=-1, system_error=f"command timed out after {timeout_seconds}s")
    return CommandResult(
        return_code=proc.returncode if proc.returncode is not None else -1,
        stdout=stdout_bytes.decode(errors="replace"),
        stderr=stderr_bytes.decode(errors="replace"),
    )
