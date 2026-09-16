"""Lease-bound command execution inside a Linux Workstation sandbox."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any

from app.biz.reverse_grpc.sandbox import LinuxWorkstationSandboxHttpResult, ReverseSandboxService

from ...domain.models import SandboxLeaseRef, TaskRun
from ...domain.time import now_ms
from ...sandbox.types import SandboxType
from .contracts import CommandBackend, CommandMount, CommandResult, CommandSession, CommandSpec

_REMOTE_RUN_ROOT = PurePosixPath("/home/gem/.sico/runs")
_TRANSFER_CHUNK_BYTES = 512 * 1024
_POLL_SECONDS = 0.1


class LinuxWorkstationCommandError(RuntimeError):
    """A Linux Workstation transport or staging operation failed."""


class LinuxWorkstationCommandBackend(CommandBackend):
    def __init__(self, run: TaskRun, service: ReverseSandboxService | None = None) -> None:
        self._run = run
        self._service = service or ReverseSandboxService.get_instance()

    @classmethod
    def from_run(cls, run: TaskRun) -> LinuxWorkstationCommandBackend:
        return cls(run)

    async def run(self, spec: CommandSpec) -> CommandResult:
        session = self.open_session()
        try:
            return await session.run(spec)
        finally:
            await session.aclose()

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        del pod_name, image
        return LinuxWorkstationCommandSession(self._run, self._service)


class LinuxWorkstationCommandSession(CommandSession):
    def __init__(self, run: TaskRun, service: ReverseSandboxService) -> None:
        lease = _require_live_linux_workstation_lease(run)
        digest = hashlib.sha256(run.run_id.encode()).hexdigest()[:20]
        self._run = run
        self._service = service
        self._sandbox_id = lease.sandbox_id
        self._remote_root = _REMOTE_RUN_ROOT / digest
        self._session_id = f"sico-{digest}"
        self._mount_paths: dict[str, str] = {}
        self._result_mount: CommandMount | None = None
        self._writable_workspace_mount: CommandMount | None = None
        self._staged_workspace_files: set[PurePosixPath] = set()
        self._staged = False
        self._closed = False

    async def run(self, spec: CommandSpec) -> CommandResult:
        try:
            await self._ensure_staged(spec)
            return await self._execute(
                argv=[self._map_value(value) for value in spec.argv],
                cwd=self._map_value(spec.cwd),
                env={key: self._map_value(value) for key, value in spec.env.items()},
                timeout_seconds=spec.timeout_seconds,
            )
        except asyncio.CancelledError:
            await self._best_effort_kill()
            raise
        except LinuxWorkstationCommandError as exc:
            return CommandResult(return_code=-1, system_error=str(exc))
        except Exception as exc:  # noqa: BLE001
            return CommandResult(return_code=-1, system_error=f"Linux Workstation command failed: {exc}")

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        error: Exception | None = None
        await self._best_effort_kill()
        try:
            if self._staged and self._result_mount is not None:
                await self._retrieve_results(self._result_mount)
            if self._staged and self._writable_workspace_mount is not None:
                await self._sync_workspace(self._writable_workspace_mount)
        except Exception as exc:  # noqa: BLE001
            error = exc
        finally:
            await self._best_effort_remove_remote_root()
            await self._best_effort_request("DELETE", f"/v1/shell/sessions/{self._session_id}")
        if error is not None:
            raise LinuxWorkstationCommandError(f"failed to retrieve Linux Workstation results: {error}") from error

    async def _ensure_staged(self, spec: CommandSpec) -> None:
        if self._staged:
            return
        self._mount_paths = self._remote_mount_paths(spec.mounts)
        remote_directories = [str(self._remote_root)]
        for mount in spec.mounts:
            destination = PurePosixPath(self._mount_paths[mount.mount_path.rstrip("/\\")])
            remote_directories.append(str(destination.parent if Path(mount.host_path).is_file() else destination))
        if spec.metadata.get("workspace_access") == "none":
            local_workspace = spec.metadata.get("workspace_path", "").rstrip("/\\")
            if local_workspace:
                remote_workspace = str(self._remote_root / "workspace")
                self._mount_paths[local_workspace] = remote_workspace
                remote_directories.append(remote_workspace)
        result_mounts = [mount for mount in spec.mounts if mount.name == "skill-result"]
        self._result_mount = result_mounts[0] if result_mounts else None
        workspace_mounts = [mount for mount in spec.mounts if mount.name == "workspace"]
        if spec.metadata.get("workspace_access") == "read_write" and workspace_mounts:
            self._writable_workspace_mount = workspace_mounts[0]
        mkdir_result = await self._execute(
            argv=["mkdir", "-p", *remote_directories],
            cwd="/home/gem",
            env={},
            timeout_seconds=30,
            stage=False,
        )
        if mkdir_result.return_code != 0:
            raise LinuxWorkstationCommandError(
                mkdir_result.stderr or mkdir_result.stdout or "failed to create Linux Workstation run directories"
            )
        for mount in spec.mounts:
            if mount.name == "skill-result":
                continue
            if mount.name == "workspace" and spec.metadata.get("workspace_access") == "none":
                continue
            staged_files = await self._stage_mount(mount, self._mount_paths[mount.mount_path], all_mounts=spec.mounts)
            if mount is self._writable_workspace_mount:
                self._staged_workspace_files = staged_files
        self._staged = True

    def _remote_mount_paths(self, mounts: list[CommandMount]) -> dict[str, str]:
        result: dict[str, str] = {}
        for mount in mounts:
            if mount.name == "workspace":
                destination = self._remote_root / "workspace"
            elif mount.name == "skill-runtime":
                destination = self._remote_root / "runtime"
            elif mount.name == "skill-result":
                destination = self._remote_root / "results"
            else:
                destination = self._remote_root / "inputs" / _safe_component(mount.name)
            if Path(mount.host_path).is_file():
                destination /= Path(mount.host_path).name
            result[mount.mount_path.rstrip("/\\")] = str(destination)
        return result

    async def _stage_mount(
        self,
        mount: CommandMount,
        remote_root: str,
        *,
        all_mounts: list[CommandMount],
    ) -> set[PurePosixPath]:
        source = Path(mount.host_path)
        if source.is_symlink():
            raise LinuxWorkstationCommandError(f"Linux Workstation staging does not accept symlink mounts: {source}")
        if source.is_file():
            await self._upload_file(source, remote_root)
            return {PurePosixPath(source.name)}
        if not source.is_dir():
            raise LinuxWorkstationCommandError(f"Linux Workstation staging source does not exist: {source}")
        nested_roots = {
            Path(other.host_path).resolve()
            for other in all_mounts
            if other is not mount and _is_relative_to(Path(other.host_path).resolve(), source.resolve())
        }
        staged_files: set[PurePosixPath] = set()
        for path in sorted(source.rglob("*")):
            resolved = path.resolve()
            if any(resolved == nested or nested in resolved.parents for nested in nested_roots):
                continue
            if path.is_symlink():
                raise LinuxWorkstationCommandError(f"Linux Workstation staging does not accept symlinks: {path}")
            if path.is_file():
                relative = path.relative_to(source).as_posix()
                await self._upload_file(path, str(PurePosixPath(remote_root) / relative))
                staged_files.add(PurePosixPath(relative))
        return staged_files

    async def _upload_file(self, source: Path, destination: str) -> None:
        first = True
        with source.open("rb") as file:
            while True:
                chunk = file.read(_TRANSFER_CHUNK_BYTES)
                if not chunk and not first:
                    break
                await self._request(
                    "POST",
                    "/v1/file/write",
                    json_body={
                        "file": destination,
                        "content": base64.b64encode(chunk).decode("ascii"),
                        "encoding": "base64",
                        "append": not first,
                    },
                )
                first = False
                if not chunk:
                    break

    async def _execute(
        self,
        *,
        argv: list[str],
        cwd: str,
        env: dict[str, str],
        timeout_seconds: int,
        stage: bool = True,
    ) -> CommandResult:
        if stage and not self._staged:
            raise LinuxWorkstationCommandError("Linux Workstation command session is not staged")
        await self._request(
            "POST",
            "/v1/shell/exec",
            json_body={
                "id": self._session_id,
                "argv": argv,
                "exec_dir": cwd or str(self._remote_root),
                "env": env,
                "async_mode": True,
            },
        )
        try:
            if timeout_seconds > 0:
                async with asyncio.timeout(timeout_seconds):
                    return await self._wait_for_command()
            return await self._wait_for_command()
        except TimeoutError:
            await self._best_effort_kill()
            return CommandResult(return_code=-1, system_error=f"command timed out after {timeout_seconds}s")

    async def _wait_for_command(self) -> CommandResult:
        while True:
            response = await self._request("POST", "/v1/shell/view", json_body={"id": self._session_id})
            data = _response_data(response)
            status = str(data.get("status") or "")
            if status != "running":
                exit_code = data.get("exit_code")
                stdout = data.get("stdout") if "stdout" in data else data.get("output")
                return CommandResult(
                    return_code=exit_code if isinstance(exit_code, int) else -1,
                    stdout=str(stdout or ""),
                    stderr=str(data.get("stderr") or ""),
                    system_error=(
                        ""
                        if isinstance(exit_code, int)
                        else f"Linux Workstation shell session ended with status {status or 'unknown'}"
                    ),
                )
            await asyncio.sleep(_POLL_SECONDS)

    async def _retrieve_results(self, mount: CommandMount) -> None:
        remote_root = self._mount_paths[mount.mount_path.rstrip("/\\")]
        response = await self._request(
            "POST",
            "/v1/file/list",
            json_body={"path": remote_root, "recursive": True, "max_depth": 64},
            allow_statuses={404},
        )
        if response.status_code == 404:
            return
        files = _response_data(response).get("files")
        if not isinstance(files, list):
            raise LinuxWorkstationCommandError("Linux Workstation result listing returned an invalid payload")
        local_root_path = Path(mount.host_path)
        if local_root_path.is_symlink():
            raise LinuxWorkstationCommandError("Linux Workstation local result directory must not be a symlink")
        local_root = local_root_path.resolve()
        local_root.mkdir(parents=True, exist_ok=True)
        for item in files:
            if not isinstance(item, dict) or item.get("is_directory"):
                continue
            if item.get("is_symlink"):
                raise LinuxWorkstationCommandError("Linux Workstation result files must not be symlinks")
            remote_path = str(item.get("path") or "")
            relative = _remote_relative_path(remote_root, remote_path)
            destination = (local_root / Path(*relative.parts)).resolve()
            if local_root != destination and local_root not in destination.parents:
                raise LinuxWorkstationCommandError("Linux Workstation result path escaped the local result directory")
            destination.parent.mkdir(parents=True, exist_ok=True)
            await self._download_file(remote_path, destination, root=remote_root)

    async def _sync_workspace(self, mount: CommandMount) -> None:
        remote_root = self._mount_paths[mount.mount_path.rstrip("/\\")]
        response = await self._request(
            "POST",
            "/v1/file/list",
            json_body={"path": remote_root, "recursive": True, "max_depth": 64},
        )
        files = _response_data(response).get("files")
        if not isinstance(files, list):
            raise LinuxWorkstationCommandError("Linux Workstation workspace listing returned an invalid payload")
        local_root_path = Path(mount.host_path)
        if local_root_path.is_symlink():
            raise LinuxWorkstationCommandError("Linux Workstation local workspace directory must not be a symlink")
        local_root = local_root_path.resolve()
        remote_files: set[PurePosixPath] = set()
        for item in files:
            if not isinstance(item, dict) or item.get("is_directory"):
                continue
            if item.get("is_symlink"):
                raise LinuxWorkstationCommandError("Linux Workstation workspace files must not be symlinks")
            remote_path = str(item.get("path") or "")
            relative = _remote_relative_path(remote_root, remote_path)
            remote_files.add(relative)
            destination = (local_root / Path(*relative.parts)).resolve()
            if local_root != destination and local_root not in destination.parents:
                raise LinuxWorkstationCommandError("Linux Workstation workspace path escaped the local workspace directory")
            if destination.is_symlink():
                raise LinuxWorkstationCommandError("Linux Workstation local workspace files must not be symlinks")
            destination.parent.mkdir(parents=True, exist_ok=True)
            await self._download_file(remote_path, destination, root=remote_root)
        for relative in self._staged_workspace_files - remote_files:
            destination = (local_root / Path(*relative.parts)).resolve()
            if local_root not in destination.parents:
                raise LinuxWorkstationCommandError(
                    "Linux Workstation deleted workspace path escaped the local workspace directory"
                )
            if destination.is_symlink():
                raise LinuxWorkstationCommandError("Linux Workstation local workspace files must not be symlinks")
            if destination.is_file():
                destination.unlink()

    async def _download_file(self, remote_path: str, destination: Path, *, root: str) -> None:
        offset = 0
        with destination.open("wb") as file:
            while True:
                response = await self._request(
                    "GET",
                    "/v1/file/download",
                    query={
                        "path": remote_path,
                        "root": root,
                        "offset": offset,
                        "limit": _TRANSFER_CHUNK_BYTES,
                    },
                )
                chunk = response.body_bytes
                file.write(chunk)
                offset += len(chunk)
                if len(chunk) < _TRANSFER_CHUNK_BYTES:
                    return

    async def _request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        allow_statuses: set[int] | None = None,
    ) -> LinuxWorkstationSandboxHttpResult:
        lease = _require_live_linux_workstation_lease(self._run, expected_sandbox_id=self._sandbox_id)
        response = await asyncio.to_thread(
            self._service.proxy_linux_workstation_http,
            agent_instance_id=str(self._run.agent_instance_id),
            proxy_base_path=lease.endpoint,
            method=method,
            path=path,
            query=query,
            json_body=json_body,
        )
        allowed = allow_statuses or set()
        if not 200 <= response.status_code < 300 and response.status_code not in allowed:
            message = (
                f"Linux Workstation request {method} {path} returned HTTP {response.status_code}: {response.body_text[:2000]}"
            )
            raise LinuxWorkstationCommandError(message)
        return response

    async def _best_effort_kill(self) -> None:
        await self._best_effort_request("POST", "/v1/shell/kill", json_body={"id": self._session_id})

    async def _best_effort_remove_remote_root(self) -> None:
        await self._best_effort_request(
            "POST",
            "/v1/shell/exec",
            json_body={
                "id": self._session_id,
                "argv": ["rm", "-rf", str(self._remote_root)],
                "exec_dir": "/home/gem",
                "timeout": 30,
            },
        )

    async def _best_effort_request(self, method: str, path: str, *, json_body: dict[str, Any] | None = None) -> None:
        try:
            await self._request(method, path, json_body=json_body, allow_statuses={404})
        except Exception:  # noqa: BLE001
            return

    def _map_value(self, value: str) -> str:
        original = str(value)
        normalized = original.replace("\\", "/")
        for local, remote in sorted(self._mount_paths.items(), key=lambda item: len(item[0]), reverse=True):
            normalized_local = local.replace("\\", "/").rstrip("/")
            if normalized == normalized_local:
                return remote
            prefix = normalized_local + "/"
            if not normalized.startswith(prefix):
                continue
            suffix = PurePosixPath(normalized.removeprefix(prefix))
            if ".." in suffix.parts:
                raise LinuxWorkstationCommandError("Linux Workstation staged path contains traversal")
            return str(PurePosixPath(remote).joinpath(*suffix.parts))
        return original


def _require_live_linux_workstation_lease(run: TaskRun, *, expected_sandbox_id: str = "") -> SandboxLeaseRef:
    lease = run.sandbox
    if run.sandbox_released or lease is None:
        raise LinuxWorkstationCommandError("Linux Workstation command execution requires an active sandbox lease")
    if lease.type != SandboxType.LINUX_WORKSTATION.value:
        raise LinuxWorkstationCommandError(
            f"Linux Workstation command execution requires lease type 'linux_workstation', got {lease.type!r}"
        )
    if expected_sandbox_id and lease.sandbox_id != expected_sandbox_id:
        raise LinuxWorkstationCommandError("Linux Workstation sandbox lease changed after command session creation")
    if lease.expires_at is not None and lease.expires_at <= now_ms():
        raise LinuxWorkstationCommandError("Linux Workstation sandbox lease has expired")
    return lease


def _safe_component(value: str) -> str:
    normalized = "".join(character if character.isalnum() or character in {"-", "_"} else "-" for character in value)
    return normalized.strip("-") or "mount"


def _is_relative_to(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _response_data(response: LinuxWorkstationSandboxHttpResult) -> dict[str, Any]:
    try:
        payload = json.loads(response.body_text)
    except (TypeError, json.JSONDecodeError) as exc:
        raise LinuxWorkstationCommandError("Linux Workstation response was not valid JSON") from exc
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise LinuxWorkstationCommandError("Linux Workstation response did not contain an object data field")
    return data


def _remote_relative_path(root: str, path: str) -> PurePosixPath:
    root_path = PurePosixPath(root)
    path_value = PurePosixPath(path)
    try:
        relative = path_value.relative_to(root_path)
    except ValueError as exc:
        raise LinuxWorkstationCommandError("Linux Workstation result path escaped the remote result directory") from exc
    if not relative.parts or ".." in relative.parts:
        raise LinuxWorkstationCommandError("Linux Workstation result path is invalid")
    return relative
