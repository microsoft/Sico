"""Lease-bound capabilities for an acquired Linux Workstation sandbox."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from app.biz.reverse_grpc.sandbox import LinuxWorkstationSandboxHttpResult, ReverseSandboxService

from ..domain.models import ErrorClass, SandboxLeaseRef, TaskResult, TaskStatus
from ..domain.results import build_user_input_result, failed_result, timed_out_result
from ..domain.time import now_ms as _now_ms
from ..sandbox.types import SandboxType
from ..storage.artifact_store import ArtifactStore
from .descriptors import CapabilityBinding, CapabilityContext, CapabilityDescriptor, CatalogueQuery, ResolveContext
from .ids import LINUX_WORKSTATION_PROVIDER_ID, normalize_capability_id

_LINUX_WORKSTATION_ROOT = PurePosixPath("/home/gem")
_LINUX_WORKSTATION_RUN_ROOT = _LINUX_WORKSTATION_ROOT / ".sico" / "runs"
_TRANSFER_CHUNK_BYTES = 512 * 1024
_MAX_FILE_BYTES = 256 * 1024
_KEY_ALIASES = {
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "arrowup": "up",
    "cmd": "command",
    "control": "ctrl",
    "ctl": "ctrl",
    "pagedn": "pagedown",
    "pageup": "pageup",
    "spacebar": "space",
    "super": "win",
    "windows": "win",
}


@dataclass(frozen=True, slots=True)
class _Operation:
    name: str
    path: str
    schema: dict[str, Any]
    effect: str
    description: str
    when_to_use: str = ""

    @property
    def descriptor(self) -> CapabilityDescriptor:
        return CapabilityDescriptor(
            capability_id=f"{LINUX_WORKSTATION_PROVIDER_ID}:{self.name}",
            parameter_schema=self.schema,
            required_sandbox=(SandboxType.LINUX_WORKSTATION,),
            workspace_access="none",
            effect=self.effect,  # type: ignore[arg-type]
            description=self.description,
            when_to_use=self.when_to_use,
        )


def _object_schema(properties: dict[str, Any], required: tuple[str, ...] = ()) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = list(required)
    return schema


_OPERATIONS = (
    _Operation(
        "shell:exec",
        "/v1/shell/exec",
        _object_schema(
            {
                "command": {"type": "string", "minLength": 1, "maxLength": 32_768},
                "working_dir": {"type": "string", "default": "/home/gem"},
                "timeout_seconds": {"type": "number", "minimum": 0.1, "maximum": 25, "default": 25},
            },
            ("command",),
        ),
        "mutate",
        "Run one shell command in the currently leased Linux Workstation. The default working directory `/home/gem` "
        "is writable and persists across calls in that workstation lease. Files under `$SICO_RESULT_DIR` are returned "
        "as artifacts.",
        "Prefer this over builtin:run_command when the request targets the Linux sandbox/workstation, needs a writable "
        "current directory, or has commands sharing filesystem state.",
    ),
    _Operation(
        "mouse:click",
        "/v1/browser/actions",
        _object_schema(
            {
                "x": {"type": "number", "minimum": 0},
                "y": {"type": "number", "minimum": 0},
                "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
                "clicks": {"type": "integer", "enum": [1, 2, 3], "default": 1},
            },
            ("x", "y"),
        ),
        "mutate",
        "Click at desktop coordinates in the currently leased Linux Workstation.",
    ),
    _Operation(
        "mouse:move",
        "/v1/browser/actions",
        _object_schema({"x": {"type": "number", "minimum": 0}, "y": {"type": "number", "minimum": 0}}, ("x", "y")),
        "mutate",
        "Move the pointer in the currently leased Linux Workstation.",
    ),
    _Operation(
        "mouse:scroll",
        "/v1/browser/actions",
        _object_schema({"dx": {"type": "integer", "default": 0}, "dy": {"type": "integer", "default": 0}}),
        "mutate",
        "Scroll the currently leased Linux Workstation.",
    ),
    _Operation(
        "keyboard:type",
        "/v1/browser/actions",
        _object_schema(
            {
                "text": {"type": "string", "minLength": 1, "maxLength": 10_000, "sensitive": True},
                "use_clipboard": {"type": "boolean", "default": True},
            },
            ("text",),
        ),
        "mutate",
        "Type text into the focused control in the currently leased Linux Workstation.",
    ),
    _Operation(
        "keyboard:press",
        "/v1/browser/actions",
        _object_schema(
            {"keys": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1, "maxItems": 8}},
            ("keys",),
        ),
        "mutate",
        "Press one key or a key combination in the currently leased Linux Workstation.",
    ),
    _Operation(
        "browser:open_url",
        "/v1/browser/open_url",
        _object_schema(
            {
                "url": {"type": "string", "minLength": 1, "maxLength": 4096},
                "new_tab": {"type": "boolean", "default": False},
                "wait_seconds": {"type": "number", "minimum": 0, "maximum": 10, "default": 0.75},
            },
            ("url",),
        ),
        "mutate",
        "Open a URL in the browser on the currently leased Linux Workstation.",
    ),
    _Operation(
        "browser:screenshot",
        "/v1/browser/screenshot",
        _object_schema({}),
        "read",
        "Capture the currently leased Linux Workstation as a screenshot artifact.",
    ),
    _Operation(
        "file:export",
        "/v1/file/download",
        _object_schema(
            {"path": {"type": "string", "minLength": 1}},
            ("path",),
        ),
        "read",
        "Export one existing file under /home/gem from the currently leased Linux Workstation as an artifact.",
    ),
    _Operation(
        "file:read",
        "/v1/file/read",
        _object_schema(
            {
                "path": {"type": "string", "minLength": 1},
                "start_line": {"type": "integer", "minimum": 0},
                "end_line": {"type": "integer", "minimum": 1},
            },
            ("path",),
        ),
        "read",
        "Read a bounded text file under /home/gem in the currently leased Linux Workstation.",
    ),
    _Operation(
        "file:write",
        "/v1/file/write",
        _object_schema(
            {
                "path": {"type": "string", "minLength": 1},
                "content": {"type": "string", "maxLength": _MAX_FILE_BYTES},
                "append": {"type": "boolean", "default": False},
            },
            ("path", "content"),
        ),
        "mutate",
        "Write a bounded text file under /home/gem in the currently leased Linux Workstation.",
    ),
    _Operation(
        "file:list",
        "/v1/file/list",
        _object_schema(
            {
                "path": {"type": "string", "default": "/home/gem"},
                "recursive": {"type": "boolean", "default": False},
                "max_depth": {"type": "integer", "minimum": 1, "maximum": 8, "default": 2},
            }
        ),
        "read",
        "List a bounded directory tree under /home/gem in the currently leased Linux Workstation.",
    ),
)
_OPERATION_BY_ID = {f"{LINUX_WORKSTATION_PROVIDER_ID}:{operation.name}": operation for operation in _OPERATIONS}


def linux_workstation_descriptors() -> tuple[CapabilityDescriptor, ...]:
    return tuple(operation.descriptor for operation in _OPERATIONS)


class LinuxWorkstationCapabilityProvider:
    provider_id = LINUX_WORKSTATION_PROVIDER_ID

    def __init__(
        self,
        *,
        artifact_store: ArtifactStore,
        service: ReverseSandboxService | None = None,
    ) -> None:
        self.artifact_store = artifact_store
        self.service = service or ReverseSandboxService.get_instance()

    async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
        lease = _compatible_lease(query.caller)
        if lease is None:
            return ()
        return tuple(descriptor for descriptor in linux_workstation_descriptors() if query.matches(descriptor))

    async def resolve(self, capability_id: str, context: ResolveContext) -> CapabilityBinding | None:
        operation = _OPERATION_BY_ID.get(normalize_capability_id(capability_id))
        lease = _compatible_lease(context)
        if operation is None or lease is None:
            return None
        return CapabilityBinding(operation.descriptor, _LinuxWorkstationHandler(self, operation, lease.sandbox_id))


class _LinuxWorkstationHandler:
    def __init__(self, provider: LinuxWorkstationCapabilityProvider, operation: _Operation, sandbox_id: str) -> None:
        self._provider = provider
        self._operation = operation
        self._sandbox_id = sandbox_id

    async def execute(self, context: CapabilityContext) -> TaskResult:  # noqa: PLR0911
        lease = _live_lease(context, self._sandbox_id)
        if isinstance(lease, str):
            return failed_result(context.run, lease, ErrorClass.POLICY_DENY)
        if self._operation.name == "file:export":
            try:
                return await self._export_file(context, _linux_workstation_path(context.arguments.get("path")))
            except ValueError as exc:
                return build_user_input_result(context.run, str(exc))
            except Exception as exc:  # noqa: BLE001
                return failed_result(context.run, f"Linux Workstation file export failed: {exc}", ErrorClass.TRANSIENT)
        remote_result_dir = _remote_result_dir(context.run.run_id) if self._operation.name == "shell:exec" else ""
        try:
            body = _request_body(self._operation.name, context.arguments, result_dir=remote_result_dir)
        except ValueError as exc:
            return build_user_input_result(context.run, str(exc))
        try:
            if remote_result_dir:
                await self._prepare_result_dir(context, remote_result_dir)
            response = await asyncio.to_thread(
                self._provider.service.proxy_linux_workstation_http,
                agent_instance_id=str(context.run.agent_instance_id),
                proxy_base_path=lease.endpoint,
                method="GET" if self._operation.name == "browser:screenshot" else "POST",
                path=self._operation.path,
                json_body=None if self._operation.name == "browser:screenshot" else body,
            )
        except Exception as exc:
            return failed_result(context.run, f"Linux Workstation request failed: {exc}", ErrorClass.TRANSIENT)
        result = self._result(context, response)
        if remote_result_dir and result.status == TaskStatus.COMPLETED:
            try:
                artifacts = await self._collect_remote_files(context, remote_result_dir)
            except Exception as exc:  # noqa: BLE001
                return failed_result(context.run, f"Linux Workstation result collection failed: {exc}", ErrorClass.TRANSIENT)
            result.primary_artifact = artifacts[0] if artifacts else None
            result.artifacts = artifacts
        return result

    async def _prepare_result_dir(self, context: CapabilityContext, remote_result_dir: str) -> None:
        response = await asyncio.to_thread(
            self._provider.service.proxy_linux_workstation_http,
            agent_instance_id=str(context.run.agent_instance_id),
            proxy_base_path=context.run.sandbox.endpoint,
            method="POST",
            path="/v1/shell/exec",
            json_body={
                "argv": ["mkdir", "-p", remote_result_dir],
                "exec_dir": str(_LINUX_WORKSTATION_ROOT),
                "timeout": 25,
            },
        )
        _require_success(response, "create Linux Workstation result directory")

    async def _export_file(self, context: CapabilityContext, remote_path: str) -> TaskResult:
        target = context.result_dir / PurePosixPath(remote_path).name
        await self._download_file(context, remote_path, target, root=str(_LINUX_WORKSTATION_ROOT))
        artifact = self._provider.artifact_store.put(
            context.run.run_id,
            target.name,
            target,
            artifact_type="file",
            role="primary",
        )
        artifact.filepath = target.relative_to(context.workspace).as_posix()
        return _completed_result(context, f"Exported Linux Workstation file {remote_path}.", artifacts=[artifact])

    async def _collect_remote_files(self, context: CapabilityContext, remote_root: str) -> list:
        response = await asyncio.to_thread(
            self._provider.service.proxy_linux_workstation_http,
            agent_instance_id=str(context.run.agent_instance_id),
            proxy_base_path=context.run.sandbox.endpoint,
            method="POST",
            path="/v1/file/list",
            json_body={"path": remote_root, "recursive": True, "max_depth": 64},
        )
        _require_success(response, "list Linux Workstation result directory")
        payload = _json_payload(response)
        data = payload.get("data") if isinstance(payload, dict) else None
        files = data.get("files") if isinstance(data, dict) else None
        if not isinstance(files, list):
            raise RuntimeError("Linux Workstation result listing returned an invalid payload")
        artifacts = []
        for item in files:
            if not isinstance(item, dict) or item.get("is_directory"):
                continue
            if item.get("is_symlink"):
                raise RuntimeError("Linux Workstation result files must not be symlinks")
            remote_path = str(item.get("path") or "")
            relative = _remote_relative_path(remote_root, remote_path)
            target = (context.result_dir / Path(*relative.parts)).resolve()
            result_root = context.result_dir.resolve()
            if target == result_root or result_root not in target.parents:
                raise RuntimeError("Linux Workstation result path escaped the local result directory")
            await self._download_file(context, remote_path, target, root=remote_root)
            artifact = self._provider.artifact_store.put(
                context.run.run_id,
                target.name,
                target,
                artifact_type="file",
                role="primary",
            )
            artifact.filepath = target.relative_to(context.workspace).as_posix()
            artifacts.append(artifact)
        return artifacts

    async def _download_file(self, context: CapabilityContext, remote_path: str, target: Path, *, root: str) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        offset = 0
        with target.open("wb") as file:
            while True:
                response = await asyncio.to_thread(
                    self._provider.service.proxy_linux_workstation_http,
                    agent_instance_id=str(context.run.agent_instance_id),
                    proxy_base_path=context.run.sandbox.endpoint,
                    method="GET",
                    path="/v1/file/download",
                    query={"path": remote_path, "root": root, "offset": offset, "limit": _TRANSFER_CHUNK_BYTES},
                )
                _require_success(response, f"download Linux Workstation file {remote_path}")
                chunk = response.body_bytes
                file.write(chunk)
                offset += len(chunk)
                if len(chunk) < _TRANSFER_CHUNK_BYTES:
                    return

    def _result(self, context: CapabilityContext, response: LinuxWorkstationSandboxHttpResult) -> TaskResult:  # noqa: PLR0911
        if not 200 <= response.status_code < 300:
            message = f"Linux Workstation request returned HTTP {response.status_code}: {response.body_text[:2000]}"
            error_class = ErrorClass.USER_INPUT if response.status_code < 500 else ErrorClass.TRANSIENT
            return failed_result(context.run, message, error_class)
        if self._operation.name == "browser:screenshot":
            if not response.body_bytes:
                return failed_result(context.run, "Linux Workstation screenshot response was empty", ErrorClass.TRANSIENT)
            path = context.result_dir / "linux-workstation-screenshot.png"
            path.write_bytes(response.body_bytes)
            artifact = self._provider.artifact_store.put(
                context.run.run_id,
                path.name,
                path,
                artifact_type="screenshot",
                role="primary",
            )
            artifact.filepath = path.relative_to(context.workspace).as_posix()
            return _completed_result(context, "Captured Linux Workstation screenshot.", artifacts=[artifact])

        payload = _response_data(response)
        if self._operation.name == "shell:exec" and isinstance(payload, dict):
            stdout = str(payload.get("stdout") or "")
            stderr = str(payload.get("stderr") or "")
            combined = str(payload.get("output") or "")
            if not stdout and not stderr and combined:
                stdout = combined
            status = str(payload.get("status") or "")
            exit_code = payload.get("exit_code")
            shell_output = json.dumps(
                {
                    "command": str(payload.get("command") or context.arguments.get("command") or ""),
                    "status": status,
                    "exit_code": exit_code,
                    "stdout": stdout,
                    "stderr": stderr,
                },
                ensure_ascii=False,
            )
            if status == "hard_timeout":
                result = timed_out_result(context.run, "Linux Workstation shell command timed out")
                return result.model_copy(update={"output": shell_output})
            if isinstance(exit_code, int) and exit_code != 0:
                result = failed_result(
                    context.run,
                    f"Linux Workstation shell command exited with {exit_code}",
                    ErrorClass.SKILL_RUNTIME,
                )
                return result.model_copy(update={"output": shell_output})
            return _completed_result(
                context,
                f"Linux Workstation shell command exited with {exit_code if isinstance(exit_code, int) else 0}.",
                output=shell_output,
            )
        output = response.body_text
        if self._operation.name == "file:read" and len(output.encode("utf-8")) > _MAX_FILE_BYTES:
            return failed_result(
                context.run,
                f"Linux Workstation file response exceeds {_MAX_FILE_BYTES} bytes",
                ErrorClass.USER_INPUT,
            )
        return _completed_result(context, f"{self._operation.name} completed.", output=output)


def _compatible_lease(context: ResolveContext) -> SandboxLeaseRef | None:
    lease = context.sandbox
    if lease is None or lease.type != SandboxType.LINUX_WORKSTATION.value:
        return None
    if lease.expires_at is not None and lease.expires_at <= _now_ms():
        return None
    return lease


def _live_lease(context: CapabilityContext, sandbox_id: str) -> SandboxLeaseRef | str:
    lease = context.run.sandbox
    if context.run.sandbox_released or lease is None:
        return "Linux Workstation capability requires an active sandbox lease"
    if lease.sandbox_id != sandbox_id:
        return "Linux Workstation sandbox lease changed after capability resolution"
    if lease.type != SandboxType.LINUX_WORKSTATION.value:
        return "Linux Workstation capability requires a Linux Workstation sandbox lease"
    if lease.expires_at is not None and lease.expires_at <= _now_ms():
        return "Linux Workstation sandbox lease has expired"
    return lease


def _linux_workstation_path(value: Any) -> str:
    path = PurePosixPath(str(value or "/home/gem"))
    if not path.is_absolute() or path != _LINUX_WORKSTATION_ROOT and _LINUX_WORKSTATION_ROOT not in path.parents:
        raise ValueError("Linux Workstation file paths must stay under /home/gem")
    if ".." in path.parts:
        raise ValueError("Linux Workstation file paths must not contain '..'")
    return str(path)


def _request_body(name: str, arguments: Any, *, result_dir: str = "") -> dict[str, Any]:  # noqa: PLR0911
    args = dict(arguments)
    if name == "shell:exec":
        return _shell_request_body(args, result_dir)
    if name == "mouse:click":
        return {
            "action_type": "CLICK",
            "x": args["x"],
            "y": args["y"],
            "button": args.get("button", "left"),
            "num_clicks": args.get("clicks", 1),
        }
    if name == "mouse:move":
        return {"action_type": "MOVE_TO", "x": args["x"], "y": args["y"]}
    if name == "mouse:scroll":
        dx, dy = int(args.get("dx", 0)), int(args.get("dy", 0))
        if dx == 0 and dy == 0:
            raise ValueError("mouse_scroll requires a non-zero dx or dy")
        return {"action_type": "SCROLL", "dx": dx, "dy": dy}
    if name == "keyboard:type":
        return {"action_type": "TYPING", "text": args["text"], "use_clipboard": args.get("use_clipboard", True)}
    if name == "keyboard:press":
        keys = [_canonical_key(key) for key in args["keys"]]
        return {"action_type": "PRESS", "key": keys[0]} if len(keys) == 1 else {"action_type": "HOTKEY", "keys": keys}
    if name == "browser:open_url":
        return {
            "url": args["url"],
            "new_tab": args.get("new_tab", False),
            "wait_seconds": args.get("wait_seconds", 0.75),
        }
    if name == "file:read":
        body = {"file": _linux_workstation_path(args["path"])}
        if "start_line" in args:
            body["start_line"] = args["start_line"]
        if "end_line" in args:
            body["end_line"] = args["end_line"]
        return body
    if name == "file:write":
        content = str(args["content"])
        if len(content.encode("utf-8")) > _MAX_FILE_BYTES:
            raise ValueError(f"Linux Workstation file content exceeds {_MAX_FILE_BYTES} bytes")
        return {"file": _linux_workstation_path(args["path"]), "content": content, "append": args.get("append", False)}
    if name == "file:list":
        return {
            "path": _linux_workstation_path(args.get("path")),
            "recursive": args.get("recursive", False),
            "max_depth": args.get("max_depth", 2),
        }
    return {}


def _shell_request_body(args: dict[str, Any], result_dir: str) -> dict[str, Any]:
    body = {
        "command": args["command"],
        "exec_dir": _linux_workstation_path(args.get("working_dir")),
        "timeout": args.get("timeout_seconds", 25),
    }
    if result_dir:
        body["env"] = {"SICO_RESULT_DIR": result_dir}
    return body


def _canonical_key(value: Any) -> str:
    key = str(value).strip()
    if not key:
        raise ValueError("keyboard keys must not be empty")
    if len(key) == 1:
        return key.lower()
    normalized = "".join(character for character in key.casefold() if character not in {" ", "_", "-"})
    return _KEY_ALIASES.get(normalized, normalized)


def _json_payload(response: LinuxWorkstationSandboxHttpResult) -> Any:
    try:
        return json.loads(response.body_text)
    except (TypeError, json.JSONDecodeError):
        return None


def _response_data(response: LinuxWorkstationSandboxHttpResult) -> Any:
    """Unwrap the backend standard response and upstream success envelopes."""
    payload = _json_payload(response)
    while isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        if "code" in payload or "success" in payload:
            payload = payload["data"]
            continue
        break
    return payload


def _remote_result_dir(run_id: str) -> str:
    digest = hashlib.sha256(run_id.encode()).hexdigest()[:20]
    return str(_LINUX_WORKSTATION_RUN_ROOT / digest / "results")


def _remote_relative_path(root: str, path: str) -> PurePosixPath:
    try:
        relative = PurePosixPath(path).relative_to(PurePosixPath(root))
    except ValueError as exc:
        raise RuntimeError("Linux Workstation result path escaped the remote result directory") from exc
    if not relative.parts or ".." in relative.parts:
        raise RuntimeError("Linux Workstation result path is invalid")
    return relative


def _require_success(response: LinuxWorkstationSandboxHttpResult, action: str) -> None:
    if not 200 <= response.status_code < 300:
        raise RuntimeError(f"failed to {action}: HTTP {response.status_code}: {response.body_text[:2000]}")


def _completed_result(
    context: CapabilityContext,
    summary: str,
    *,
    output: str = "",
    artifacts: list | None = None,
) -> TaskResult:
    ended_at = _now_ms()
    artifact_list = artifacts or []
    return TaskResult(
        run_id=context.run.run_id,
        task_id=context.run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=context.run.spec.title,
        summary=summary,
        output=output,
        primary_artifact=artifact_list[0] if artifact_list else None,
        artifacts=artifact_list,
        sandbox=context.run.sandbox,
        started_at=context.started_at,
        ended_at=ended_at,
        duration_ms=max(0, ended_at - context.started_at),
    )
