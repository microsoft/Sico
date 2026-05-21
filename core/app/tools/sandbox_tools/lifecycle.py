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

"""Sandbox lifecycle tools: preview, acquire, and release.

Agent instance id is fetched from tool context.

Flow
----
1. Agent optionally calls ``sandbox_preview(type="emulator")``
    → backend returns assigned sandboxes and their current statuses without occupying one.
2. Agent calls ``sandbox_acquire(type="emulator")``
    → backend allocates a sandbox, returns connection details.
3. Agent uses the platform-aware access fields from ``sandbox_acquire``:
    - emulator: ``adb_endpoint`` for direct ADB, ``http_api_base_url`` for HTTP tools
4. Agent calls ``sandbox_release(sandbox_ids=[…])`` or ``sandbox_reset(sandbox_ids=[…])`` when done.
    when done → backend releases/resets the sandboxes. Calling whichever one depends on whether the agent
    wants to fully release the sandbox or keep the lease but just reset the environment.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass, field
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.biz.reverse_grpc.sandbox import ReverseSandboxService
from app.schemas.conversation.plan import (
    ToolDeliverable,
    ToolDeliverableAcquiredSandbox,
    ToolDeliverableType,
    ToolExecutionInfo,
    ToolType,
)
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)


class SandboxAcquireInput(BaseModel):
    type: str = Field(description="Sandbox type to acquire. Use 'emulator' for Android.")
    n: int = Field(
        default=1,
        ge=1,
        description=(
            "Desired number of sandboxes to acquire. "
            "If more are requested than currently available for this instance and type, "
            "all currently available sandboxes are returned."
        ),
    )


class SandboxPreviewInput(BaseModel):
    type: str = Field(
        default="",
        description=(
            "Optional sandbox type filter. "
            "Use 'emulator' for Android. "
            "Leave empty to list all assigned sandboxes."
        ),
    )


class SandboxReleaseInput(BaseModel):
    sandbox_ids: list[str] = Field(description="One or more sandbox IDs to release.")


class SandboxResetInput(BaseModel):
    sandbox_ids: list[str] = Field(description="One or more sandbox IDs to reset.")


_ASSIGNED_SANDBOX_STATUS = "assigned"
_PREVIEW_TOOL_NAME = "sandbox_preview"
_ACQUIRE_TOOL_NAME = "sandbox_acquire"
_RELEASE_TOOL_NAME = "sandbox_release"
_RESET_TOOL_NAME = "sandbox_reset"

_PREVIEW_TOOL_DISPLAY_NAME = "Sandbox Preview"
_ACQUIRE_TOOL_DISPLAY_NAME = "Sandbox Acquire"
_RELEASE_TOOL_DISPLAY_NAME = "Sandbox Release"
_RESET_TOOL_DISPLAY_NAME = "Sandbox Reset"


@dataclass
class SandboxSessionState:
    acquired_sandbox_ids: set[str] = field(default_factory=set)

    def track_acquire_result(self, result: dict[str, Any]) -> None:
        for sandbox in result.get("sandboxes", []):
            if sandbox.get("status") == "acquired":
                sandbox_id = str(sandbox.get("sandbox_id", "")).strip()
                if sandbox_id:
                    self.acquired_sandbox_ids.add(sandbox_id)

    def track_release_result(self, result: dict[str, Any]) -> None:
        for sandbox in result.get("sandboxes", []):
            if sandbox.get("status") == "released":
                sandbox_id = str(sandbox.get("sandbox_id", "")).strip()
                if sandbox_id:
                    self.acquired_sandbox_ids.discard(sandbox_id)

    def pending_sandbox_ids(self) -> list[str]:
        return sorted(self.acquired_sandbox_ids)


def _build_status(success_count: int, requested_count: int) -> str:
    if success_count <= 0:
        return "error"
    if success_count < requested_count:
        return "partial"
    return "success"


def _build_acquire_message(
    status: str,
    sandbox_type: str,
    requested_count: int,
    acquired_count: int,
    assigned_count: int,
) -> str:
    if status == "success":
        return f"Acquired {acquired_count} {sandbox_type} sandbox(s)."
    if status == "partial":
        return (
            f"Requested {requested_count} {sandbox_type} sandbox(s), "
            f"but only acquired {acquired_count} from {assigned_count} assigned sandbox(es)."
        )
    return f"No assigned {sandbox_type} sandbox is currently available for acquire."


def _build_release_message(status: str, requested_count: int, released_count: int) -> str:
    if status == "success":
        return f"Released {released_count} sandbox(es)."
    if status == "partial":
        return f"Released {released_count} of {requested_count} sandbox(es)."
    return "Failed to release the requested sandboxes."


def _shape_acquired_sandbox(result: Any, sandbox_type: str) -> dict[str, Any]:
    sandbox = {
        "sandbox_id": result.applied_sandbox_id,
        "type": sandbox_type,
        "status": "acquired",
        "endpoint": result.endpoint,
        "display_name": result.display_name,
        "vnc_url": result.vnc_url,
        "provider_base_url": result.provider_base_url,
        "device_id": result.device_id,
    }
    sandbox.update(_build_access_fields(sandbox_type, sandbox))
    return sandbox


def _shape_preview_sandbox(result: Any) -> dict[str, Any]:
    sandbox = {
        "sandbox_id": result.sandbox_id,
        "type": result.type,
        "status": result.status,
        "endpoint": result.endpoint,
        "display_name": result.display_name,
        "vnc_url": result.vnc_url,
        "docs_url": result.docs_url,
    }
    sandbox.update(_build_preview_access_fields(sandbox))
    return sandbox


def _build_access_fields(sandbox_type: str, sandbox: dict[str, Any]) -> dict[str, Any]:
    endpoint = str(sandbox.get("endpoint", "") or "").strip()
    provider_base_url = str(sandbox.get("provider_base_url", "") or "").strip()

    if sandbox_type == "emulator":
        http_api_base_url = provider_base_url
        return {
            "access_mode": "hybrid_adb_and_http",
            "http_api_base_url": http_api_base_url,
            "direct_endpoint": endpoint,
            "adb_endpoint": endpoint,
            "usage_hint": (
                "Use adb_endpoint for direct ADB actions like 'adb connect HOST:PORT'. "
                "Use http_api_base_url as base_url for Android emulator HTTP APIs such as apps/install-url."
            ),
        }

    if sandbox_type == "wincua":
        http_api_base_url = provider_base_url or endpoint
        return {
            "access_mode": "direct_http",
            "http_api_base_url": http_api_base_url,
            "direct_endpoint": endpoint,
            "usage_hint": (
                "Use http_api_base_url as base_url for sandbox HTTP APIs. "
                "This is typically the sandbox's direct HTTP endpoint."
            ),
        }

    http_api_base_url = endpoint or provider_base_url
    return {
        "access_mode": "backend_proxy_http",
        "http_api_base_url": http_api_base_url,
        "direct_endpoint": endpoint,
        "usage_hint": (
            "Use http_api_base_url as base_url for sandbox HTTP APIs. "
            "This sandbox access path is backend-proxied rather than direct pod access."
        ),
    }


def _build_preview_access_fields(sandbox: dict[str, Any]) -> dict[str, Any]:
    sandbox_type = str(sandbox.get("type", "") or "").strip().lower()
    endpoint = str(sandbox.get("endpoint", "") or "").strip()

    if sandbox_type == "emulator":
        return {
            "candidate_device_ip": endpoint,
            "usage_hint": (
                "For workflows that expect deviceIP, use candidate_device_ip in host:port format. "
                "Acquire the sandbox first only when you need to reserve exclusive usage or need "
                "provider-specific HTTP access fields."
            ),
        }

    if sandbox_type == "wincua":
        return {
            "candidate_base_url": endpoint,
            "usage_hint": ("Preview only. Acquire the sandbox to obtain finalized access fields before calling wincua_* tools."),
        }

    return {
        "candidate_base_url": endpoint,
        "usage_hint": (
            "Preview only. Acquire the sandbox to obtain finalized backend-proxied access fields before calling aio_* tools."
        ),
    }


def _build_preview_message(sandbox_type: str, total_count: int, available_count: int) -> str:
    type_label = sandbox_type or "sandbox"
    if total_count == 0:
        return f"No assigned {type_label} sandbox was found."
    return f"Found {total_count} assigned {type_label} sandbox(es), including {available_count} currently available for acquire."


def _normalize_ids(kwargs: dict[str, Any]) -> list[str]:
    sandbox_ids: list[str] = []

    # backward compat: accept singular sandbox_id
    sandbox_id = kwargs.get("sandbox_id")
    if sandbox_id is not None:
        value = str(sandbox_id).strip()
        if value:
            sandbox_ids.append(value)

    batch_ids = kwargs.get("sandbox_ids") or []
    for raw_id in batch_ids:
        value = str(raw_id).strip()
        if value:
            sandbox_ids.append(value)

    deduped_ids: list[str] = []
    seen_ids: set[str] = set()
    for sid in sandbox_ids:
        if sid not in seen_ids:
            seen_ids.add(sid)
            deduped_ids.append(sid)
    return deduped_ids


async def _release_sandbox_ids(instance_id: str, sandbox_ids: list[str]) -> dict[str, Any]:
    svc = ReverseSandboxService.get_instance()
    sandboxes: list[dict[str, Any]] = []
    released_count = 0
    for sandbox_id in sandbox_ids:
        try:
            await asyncio.to_thread(svc.release_sandbox, instance_id, sandbox_id)
            released_count += 1
            sandboxes.append(
                {
                    "sandbox_id": sandbox_id,
                    "status": "released",
                }
            )
        except Exception as exc:
            _LOGGER.error(
                "sandbox_release failed instance=%s sandbox_id=%s error=%s",
                instance_id,
                sandbox_id,
                exc,
            )
            sandboxes.append(
                {
                    "sandbox_id": sandbox_id,
                    "status": "failed",
                    "error_message": str(exc),
                }
            )

    status = _build_status(released_count, len(sandbox_ids))
    response = {
        "operation": "release",
        "status": status,
        "message": _build_release_message(status, len(sandbox_ids), released_count),
        "requested_count": len(sandbox_ids),
        "released_count": released_count,
        "sandboxes": sandboxes,
        "released": status == "success",
    }
    if len(sandbox_ids) == 1:
        response["sandbox_id"] = sandbox_ids[0]
    if status != "success":
        response["error_message"] = response["message"]
    return response


def wrap_tools_for_sandbox_session(
    tools: list[Any] | None,
    session_state: SandboxSessionState,
) -> list[Any] | None:
    if not tools:
        return tools

    wrapped_tools: list[Any] = []
    for tool in tools:
        if not isinstance(tool, FunctionTool) or tool.name not in {_ACQUIRE_TOOL_NAME, _RELEASE_TOOL_NAME}:
            wrapped_tools.append(tool)
            continue

        async def _wrapped_func(invocation_ctx: FunctionInvocationContext, *, _tool: FunctionTool = tool, **kwargs: Any) -> Any:
            result = _tool.func(invocation_ctx, **kwargs) if _tool.func is not None else None
            if inspect.isawaitable(result):
                result = await result
            if isinstance(result, dict):
                if _tool.name == _ACQUIRE_TOOL_NAME:
                    session_state.track_acquire_result(result)
                elif _tool.name == _RELEASE_TOOL_NAME:
                    session_state.track_release_result(result)
            return result

        wrapped_tools.append(
            FunctionTool(
                name=tool.name,
                description=tool.description,
                approval_mode=tool.approval_mode,
                max_invocations=tool.max_invocations,
                max_invocation_exceptions=tool.max_invocation_exceptions,
                additional_properties=getattr(tool, "additional_properties", None),
                func=_wrapped_func,
                input_model=tool.input_model,
            )
        )

    return wrapped_tools


async def cleanup_sandbox_session(
    agent_instance_id: int | None,
    session_state: SandboxSessionState,
) -> dict[str, Any] | None:
    if agent_instance_id is None:
        return None
    pending_ids = session_state.pending_sandbox_ids()
    if not pending_ids:
        return None

    result = await _release_sandbox_ids(str(agent_instance_id), pending_ids)
    session_state.track_release_result(result)
    return result


async def _create_sandbox_tool_call(
    ctx: ToolContext | None,
    *,
    display_name: str,
    tool_name: str,
    initial_message: str,
) -> int:
    if ctx is None:
        return 0

    return await ctx.plan_editor.create_tool_call(
        display_name,
        initial_message,
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name=tool_name,
        ),
    )


async def _update_sandbox_tool_call_message(
    ctx: ToolContext | None,
    tool_call_id: int,
    message: str,
    *,
    vnc_urls: list[str] | None = None,
) -> None:
    if ctx is None:
        return

    normalized_vnc_urls = [str(vnc_url).strip() for vnc_url in (vnc_urls or []) if str(vnc_url).strip()]
    if normalized_vnc_urls:
        if len(normalized_vnc_urls) == 1:
            message = f"{message}\nVNC URL: {normalized_vnc_urls[0]}"
        else:
            message = f"{message}\nVNC URLs:\n" + "\n".join(normalized_vnc_urls)

    await ctx.plan_editor.update_tool_call_message(tool_call_id, message)


async def _preview_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}
    instance_id = str(ctx.agent_instance_id)
    sandbox_type = str(kwargs.get("type", "") or "").strip().lower()
    tool_label = sandbox_type or "all"
    tool_call_id = await _create_sandbox_tool_call(
        ctx,
        display_name=_PREVIEW_TOOL_DISPLAY_NAME,
        tool_name=_PREVIEW_TOOL_NAME,
        initial_message=f"Previewing assigned {tool_label} sandboxes.",
    )

    svc = ReverseSandboxService.get_instance()
    try:
        assigned_sandboxes = await asyncio.to_thread(svc.get_instance_sandboxes, instance_id, sandbox_type)
    except Exception as exc:
        _LOGGER.error(
            "sandbox_preview failed instance=%s type=%s error=%s",
            instance_id,
            sandbox_type,
            exc,
        )
        await _update_sandbox_tool_call_message(
            ctx,
            tool_call_id,
            f"Failed to preview assigned {tool_label} sandboxes.",
        )
        return {"error_message": str(exc)}

    sandboxes = [_shape_preview_sandbox(sandbox) for sandbox in assigned_sandboxes]
    available_count = sum(
        1 for sandbox in sandboxes if str(sandbox.get("status", "")).strip().lower() == _ASSIGNED_SANDBOX_STATUS
    )
    message = _build_preview_message(sandbox_type, len(sandboxes), available_count)
    status = "success" if sandboxes else "error"
    response = {
        "operation": "preview",
        "status": status,
        "type": sandbox_type,
        "message": message,
        "assigned_count": len(sandboxes),
        "available_count": available_count,
        "sandboxes": sandboxes,
    }
    if len(sandboxes) == 1:
        single_sandbox = sandboxes[0]
        response["sandbox_id"] = single_sandbox["sandbox_id"]
        response["endpoint"] = single_sandbox.get("endpoint", "")
        if "candidate_device_ip" in single_sandbox:
            response["candidate_device_ip"] = single_sandbox["candidate_device_ip"]
        if "candidate_base_url" in single_sandbox:
            response["candidate_base_url"] = single_sandbox["candidate_base_url"]
    if status != "success":
        response["error_message"] = message
    await _update_sandbox_tool_call_message(ctx, tool_call_id, message)
    return response


async def _acquire_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}
    return await _perform_acquire(ctx, kwargs)


def _build_acquire_error(
    *,
    sandbox_type: str,
    message: str,
    assigned_count: int,
    requested_count: int,
    acquired_count: int,
    acquired_sandboxes: list[dict[str, Any]],
    status: str = "error",
) -> dict[str, Any]:
    return {
        "operation": "acquire",
        "status": status,
        "message": message,
        "error_message": message,
        "type": sandbox_type,
        "assigned_count": assigned_count,
        "requested_count": requested_count,
        "acquired_count": acquired_count,
        "sandboxes": acquired_sandboxes,
    }


async def _perform_acquire(ctx: ToolContext, kwargs: dict[str, Any]) -> dict[str, Any]:
    instance_id = str(ctx.agent_instance_id)
    sandbox_type = str(kwargs["type"]).strip().lower()
    requested_count = int(kwargs.get("n", 1) or 1)
    plan_editor = ctx.plan_editor
    tool_call_id = await _create_sandbox_tool_call(
        ctx,
        display_name=_ACQUIRE_TOOL_DISPLAY_NAME,
        tool_name=_ACQUIRE_TOOL_NAME,
        initial_message=(f"Acquiring up to {requested_count} {sandbox_type or 'sandbox'} sandbox(s)."),
    )
    if not sandbox_type:
        await _update_sandbox_tool_call_message(ctx, tool_call_id, "Acquire failed: type is required.")
        return {"error_message": "type is required"}

    svc = ReverseSandboxService.get_instance()
    try:
        assigned_sandboxes = await asyncio.to_thread(svc.get_instance_sandboxes, instance_id, sandbox_type)
    except Exception as exc:
        _LOGGER.error(
            "sandbox_acquire preflight failed instance=%s type=%s error=%s",
            instance_id,
            sandbox_type,
            exc,
        )
        await _update_sandbox_tool_call_message(
            ctx,
            tool_call_id,
            f"Failed to inspect assigned {sandbox_type} sandboxes before acquire.",
        )
        return {"error_message": str(exc)}

    available_sandboxes = [
        sandbox for sandbox in assigned_sandboxes if str(sandbox.status).strip().lower() == _ASSIGNED_SANDBOX_STATUS
    ]
    target_count = min(requested_count, len(available_sandboxes))
    assigned_count = len(available_sandboxes)

    if target_count == 0:
        message = _build_acquire_message("error", sandbox_type, requested_count, 0, assigned_count)
        await _update_sandbox_tool_call_message(ctx, tool_call_id, message)
        return _build_acquire_error(
            sandbox_type=sandbox_type,
            message=message,
            assigned_count=assigned_count,
            requested_count=requested_count,
            acquired_count=0,
            acquired_sandboxes=[],
        )

    acquired_sandboxes: list[dict[str, Any]] = []
    for _ in range(target_count):
        try:
            result = await asyncio.to_thread(svc.apply_sandbox, instance_id, sandbox_type)
        except Exception as exc:
            _LOGGER.error(
                "sandbox_acquire failed instance=%s type=%s error=%s",
                instance_id,
                sandbox_type,
                exc,
            )
            await _update_sandbox_tool_call_message(ctx, tool_call_id, str(exc))
            return _build_acquire_error(
                sandbox_type=sandbox_type,
                message=str(exc),
                assigned_count=assigned_count,
                requested_count=requested_count,
                acquired_count=len(acquired_sandboxes),
                acquired_sandboxes=acquired_sandboxes,
                status=_build_status(len(acquired_sandboxes), requested_count),
            )

        if not result.applied:
            break

        acquired_sandboxes.append(_shape_acquired_sandbox(result, sandbox_type))
        await plan_editor.update_tool_call_deliverable(
            tool_call_id,
            ToolDeliverable(
                type=ToolDeliverableType.ACQUIRED_SANDBOX,
                acquired_sandbox=ToolDeliverableAcquiredSandbox(
                    sandbox_id=result.applied_sandbox_id,
                    sandbox_type=sandbox_type,
                    endpoint=result.endpoint,
                    provider_base_url=result.provider_base_url,
                    device_id=result.device_id,
                    display_name=result.display_name,
                    vnc_url=result.vnc_url,
                ),
            ),
            append=True,
        )

    if not acquired_sandboxes:
        message = f"No assigned {sandbox_type} sandbox could be acquired. Assigned sandboxes may have been taken concurrently."
        await _update_sandbox_tool_call_message(ctx, tool_call_id, message)
        return _build_acquire_error(
            sandbox_type=sandbox_type,
            message=message,
            assigned_count=assigned_count,
            requested_count=requested_count,
            acquired_count=0,
            acquired_sandboxes=[],
        )

    _LOGGER.info(
        "sandbox_acquire ok instance=%s type=%s requested=%s acquired=%s",
        instance_id,
        sandbox_type,
        requested_count,
        len(acquired_sandboxes),
    )

    status = _build_status(len(acquired_sandboxes), requested_count)
    response = {
        "operation": "acquire",
        "status": status,
        "type": sandbox_type,
        "message": _build_acquire_message(
            status,
            sandbox_type,
            requested_count,
            len(acquired_sandboxes),
            assigned_count,
        ),
        "assigned_count": assigned_count,
        "requested_count": requested_count,
        "acquired_count": len(acquired_sandboxes),
        "sandboxes": acquired_sandboxes,
    }
    if status != "success":
        response["error_message"] = response["message"]

    if len(acquired_sandboxes) == 1:
        single_sandbox = acquired_sandboxes[0]
        response["sandbox_id"] = single_sandbox["sandbox_id"]
        response["endpoint"] = single_sandbox["endpoint"]
        response["provider_base_url"] = single_sandbox["provider_base_url"]
        response["device_id"] = single_sandbox["device_id"]
        response["vnc_url"] = single_sandbox.get("vnc_url", "")
        response["access_mode"] = single_sandbox.get("access_mode", "")
        response["http_api_base_url"] = single_sandbox.get("http_api_base_url", "")
        response["direct_endpoint"] = single_sandbox.get("direct_endpoint", "")
        if "adb_endpoint" in single_sandbox:
            response["adb_endpoint"] = single_sandbox["adb_endpoint"]
        response["usage_hint"] = single_sandbox.get("usage_hint", "")

    await _update_sandbox_tool_call_message(
        ctx,
        tool_call_id,
        response["message"],
        vnc_urls=[sandbox.get("vnc_url", "") for sandbox in acquired_sandboxes],
    )
    return response


async def _release_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}
    instance_id = str(ctx.agent_instance_id)
    sandbox_ids = _normalize_ids(kwargs)
    tool_call_id = await _create_sandbox_tool_call(
        ctx,
        display_name=_RELEASE_TOOL_DISPLAY_NAME,
        tool_name=_RELEASE_TOOL_NAME,
        initial_message=f"Releasing {len(sandbox_ids) or 1} sandbox(s).",
    )
    if not sandbox_ids:
        await _update_sandbox_tool_call_message(
            ctx,
            tool_call_id,
            "Release failed: sandbox_ids is required.",
        )
        return {"error_message": "sandbox_ids is required"}

    response = await _release_sandbox_ids(instance_id, sandbox_ids)
    _LOGGER.info(
        "sandbox_release finished instance=%s requested=%s released=%s status=%s",
        instance_id,
        response["requested_count"],
        response["released_count"],
        response["status"],
    )
    await _update_sandbox_tool_call_message(ctx, tool_call_id, response["message"])
    return response


async def _reset_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context"}

    instance_id = str(ctx.agent_instance_id)
    sandbox_ids = _normalize_ids(kwargs)
    tool_call_id = await _create_sandbox_tool_call(
        ctx,
        display_name=_RESET_TOOL_DISPLAY_NAME,
        tool_name=_RESET_TOOL_NAME,
        initial_message=f"Resetting {len(sandbox_ids) or 1} sandbox(s).",
    )

    if not sandbox_ids:
        await _update_sandbox_tool_call_message(ctx, tool_call_id, "Reset failed: sandbox_ids is required.")
        return {"error_message": "sandbox_ids is required"}

    svc = ReverseSandboxService.get_instance()
    sandboxes: list[dict[str, Any]] = []
    reset_count = 0
    for sandbox_id in sandbox_ids:
        try:
            await asyncio.to_thread(svc.reset_sandbox, instance_id, sandbox_id)
            reset_count += 1
            sandboxes.append({"sandbox_id": sandbox_id, "status": "reset"})
        except Exception as exc:
            _LOGGER.error("sandbox_reset failed sandbox_id=%s error=%s", sandbox_id, exc)
            sandboxes.append({"sandbox_id": sandbox_id, "status": "failed", "error_message": str(exc)})

    status = _build_status(reset_count, len(sandbox_ids))
    if status == "success":
        message = f"Reset {reset_count} sandbox(es) successfully."
    elif status == "partial":
        message = f"Reset {reset_count} of {len(sandbox_ids)} sandbox(es)."
    else:
        message = "Failed to reset the requested sandboxes."

    _LOGGER.info("sandbox_reset finished requested=%s reset=%s status=%s", len(sandbox_ids), reset_count, status)
    await _update_sandbox_tool_call_message(ctx, tool_call_id, message)

    response: dict[str, Any] = {
        "operation": "reset",
        "status": status,
        "message": message,
        "requested_count": len(sandbox_ids),
        "reset_count": reset_count,
        "sandboxes": sandboxes,
    }
    if len(sandbox_ids) == 1:
        response["sandbox_id"] = sandbox_ids[0]
    if status != "success":
        response["error_message"] = message
    return response


SANDBOX_PREVIEW_TOOL = FunctionTool(
    name="sandbox_preview",
    description=(
        "Inspect sandboxes assigned to the current agent instance without acquiring one. "
        "Use this before asking for confirmation or before deciding whether acquire is necessary. "
        "Returns assigned sandboxes, their statuses, and preview-friendly access hints. "
        "For emulator, candidate_device_ip is the host:port value suitable for workflows that expect deviceIP."
    ),
    input_model=SandboxPreviewInput,
    func=_preview_func,
)


SANDBOX_ACQUIRE_TOOL = FunctionTool(
    name="sandbox_acquire",
    description=(
        "Acquire one or more sandbox environments of the given type for the current agent instance. "
        "The tool first inspects sandboxes already assigned to the instance, then acquires up to n "
        "assigned sandboxes that are not currently in use. "
        "Returns a standardized result with status, message, counts, and sandboxes, including "
        "platform-specific access fields. "
        "For emulator, endpoint/adb_endpoint is for direct ADB while http_api_base_url is "
        "for Android emulator HTTP APIs."
    ),
    input_model=SandboxAcquireInput,
    func=_acquire_func,
)

SANDBOX_RELEASE_TOOL = FunctionTool(
    name="sandbox_release",
    description=(
        "Release one or more previously acquired sandboxes so they can be reused. "
        "Call this when you no longer need the sandbox. "
        "Provide sandbox_ids and returns a standardized batch result schema."
    ),
    input_model=SandboxReleaseInput,
    func=_release_func,
)

SANDBOX_RESET_TOOL = FunctionTool(
    name="sandbox_reset",
    description=(
        "Soft-reset one or more sandbox environments (e.g. close apps, go to home screen for emulator). "
        "The lease and assignment are preserved — only the sandbox environment is reset. "
        "Use this to return sandboxes to a clean state without releasing them."
    ),
    input_model=SandboxResetInput,
    func=_reset_func,
)

SANDBOX_LIFECYCLE_TOOLS = [SANDBOX_PREVIEW_TOOL, SANDBOX_ACQUIRE_TOOL, SANDBOX_RELEASE_TOOL, SANDBOX_RESET_TOOL]
