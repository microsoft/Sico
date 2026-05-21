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

"""Run arbitrary shell commands in a persistent Kubernetes sandbox pod.

The pod is created on first use with ``sleep`` and reused for subsequent
commands within the same chat turn. It is cleaned up when the chat finishes
(or on service restart via :func:`cleanup_run_command_pods`).
"""

import asyncio
import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from kubernetes import client as k8s_client
from kubernetes import config as k8s_config
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream as k8s_stream
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolCall, ToolCallStatus, ToolExecutionInfo, ToolType
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context
from app.utils.sanitize import sanitize_dns_label

_LOGGER = logging.getLogger(__name__)

_MAX_OUTPUT_SIZE = 100 * 1024  # 100KB per stream
_TRUNCATED_MARKER = "\n...TRUNCATED..."

_SANDBOX_NAMESPACE = "python-sandbox"
_SANDBOX_IMAGE = "ghcr.io/astral-sh/uv:python3.14-alpine"
_SANDBOX_WORKDIR = "/app"
_SANDBOX_HOSTPATH_BASE = os.getenv("RUN_PYTHON_TOOL_SANDBOX_HOSTPATH_BASE", "").strip()
_SICO_ENDPOINT = os.getenv("SICO_ENDPOINT", "http://localhost:8081")

_IS_IN_CLUSTER = os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/token")

_POD_LABEL_APP = "run-command"
_POD_LABEL_AGENT_INSTANCE = "sico-agent-instance-id"
_POD_LABEL_USER = "sico-user-id"

_DNS_UNSAFE_RE = re.compile(r"[^a-z0-9-]")


def _pod_name(user_id: str, agent_instance_id: int, turn_id: int) -> str:
    safe_user = sanitize_dns_label(user_id, max_len=30)
    return f"run-command-{safe_user}-{agent_instance_id}-{turn_id}"


def _get_k8s_client() -> k8s_client.CoreV1Api:
    try:
        k8s_config.load_incluster_config()
    except k8s_config.ConfigException:
        k8s_config.load_kube_config()
    return k8s_client.CoreV1Api()


def _workspace_host_path(workspace_path: Path) -> str:
    if not _SANDBOX_HOSTPATH_BASE:
        return str(workspace_path)

    try:
        workspace_relative_path = workspace_path.relative_to(CHAT_FS.root)
    except ValueError:
        _LOGGER.warning(
            "Workspace path %s is not under chat root %s; using workspace path as hostPath",
            workspace_path,
            CHAT_FS.root,
        )
        return str(workspace_path)

    return str(Path(_SANDBOX_HOSTPATH_BASE) / workspace_relative_path)


def _truncate(text: str) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) > _MAX_OUTPUT_SIZE:
        return encoded[:_MAX_OUTPUT_SIZE].decode("utf-8", errors="ignore") + _TRUNCATED_MARKER
    return text


async def _run_local(
    command: str,
    workspace_path: Path,
    timeout: int,
    tool_call_id: str,
    update_message: Any,
) -> dict[str, Any]:
    """Run a command directly on the local machine in the workspace directory."""
    workspace_path.mkdir(parents=True, exist_ok=True)
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(workspace_path),
            timeout=timeout if timeout > 0 else None,
        )
        return_code, stdout, stderr = result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return_code, stdout, stderr = -1, "", f"Command timed out after {timeout}s"
    except Exception as exc:
        _LOGGER.error("Local command execution failed: %s", exc)
        await update_message("Command execution failed.")
        return {"return_code": -1, "stdout": "", "stderr": "", "system_error": str(exc)}

    message = f"Command finished with exit code {return_code}."
    await update_message(message)
    return {
        "return_code": return_code,
        "stdout": _truncate(stdout),
        "stderr": _truncate(stderr),
        "system_error": "",
        "tool_call_id": tool_call_id,
        "message": message,
    }


def _ensure_pod(
    api: k8s_client.CoreV1Api,
    pod_name: str,
    *,
    user_id: str,
    agent_instance_id: int,
    workspace_host_path: str,
) -> None:
    """Create the run-command pod if it does not already exist."""
    try:
        existing = api.read_namespaced_pod(name=pod_name, namespace=_SANDBOX_NAMESPACE)
        if existing.status.phase in ("Running", "Pending"):
            _LOGGER.info("Pod %s already exists (phase=%s), reusing", pod_name, existing.status.phase)
            return
        _LOGGER.info("Pod %s in phase %s, recreating", pod_name, existing.status.phase)
        api.delete_namespaced_pod(
            name=pod_name,
            namespace=_SANDBOX_NAMESPACE,
            body=k8s_client.V1DeleteOptions(grace_period_seconds=0),
        )
    except ApiException as exc:
        if exc.status != 404:
            raise

    pod = k8s_client.V1Pod(
        metadata=k8s_client.V1ObjectMeta(
            name=pod_name,
            namespace=_SANDBOX_NAMESPACE,
            labels={
                "app": _POD_LABEL_APP,
                _POD_LABEL_AGENT_INSTANCE: str(agent_instance_id),
                _POD_LABEL_USER: sanitize_dns_label(user_id, max_len=63),
            },
        ),
        spec=k8s_client.V1PodSpec(
            restart_policy="Never",
            containers=[
                k8s_client.V1Container(
                    name="sandbox",
                    image=_SANDBOX_IMAGE,
                    command=["sh", "-c", "sleep infinity"],
                    working_dir=_SANDBOX_WORKDIR,
                    env=[
                        k8s_client.V1EnvVar(name="SICO_AGENT_INSTANCE_ID", value=str(agent_instance_id)),
                        k8s_client.V1EnvVar(name="SICO_ENDPOINT", value=_SICO_ENDPOINT),
                    ],
                    volume_mounts=[
                        k8s_client.V1VolumeMount(
                            name="workspace",
                            mount_path=_SANDBOX_WORKDIR,
                            read_only=False,
                        ),
                    ],
                    resources=k8s_client.V1ResourceRequirements(
                        limits={"cpu": "500m", "memory": "256Mi"},
                        requests={"cpu": "100m", "memory": "64Mi"},
                    ),
                ),
            ],
            volumes=[
                k8s_client.V1Volume(
                    name="workspace",
                    host_path=k8s_client.V1HostPathVolumeSource(
                        path=workspace_host_path,
                        type="DirectoryOrCreate",
                    ),
                ),
            ],
        ),
    )

    api.create_namespaced_pod(namespace=_SANDBOX_NAMESPACE, body=pod)
    _LOGGER.info("Created run-command pod %s in namespace %s", pod_name, _SANDBOX_NAMESPACE)

    for _ in range(60):
        status = api.read_namespaced_pod_status(name=pod_name, namespace=_SANDBOX_NAMESPACE)
        if status.status.phase == "Running":
            return
        if status.status.phase in ("Failed", "Succeeded"):
            raise RuntimeError(f"Pod {pod_name} entered phase {status.status.phase} unexpectedly")
        time.sleep(1)
    raise RuntimeError(f"Pod {pod_name} did not reach Running within 60s")


def _parse_exec_exit_code(resp: Any, stderr_chunks: list[str]) -> int:
    """Parse the exit code from the Kubernetes exec error channel."""
    fallback = 0 if not stderr_chunks else 1
    try:
        err_status = resp.read_channel(3)  # error channel carries exit status
        if not err_status:
            return 0
        status = json.loads(err_status)
    except Exception:  # noqa: BLE001
        return fallback

    if status.get("status") == "Success":
        return 0

    for cause in (status.get("details") or {}).get("causes", []) or []:
        if cause.get("reason") == "ExitCode":
            try:
                return int(cause.get("message", "1"))
            except (TypeError, ValueError):
                return 1
    return 1


def _exec_in_pod(
    api: k8s_client.CoreV1Api,
    pod_name: str,
    command: str,
    *,
    timeout: int,
) -> tuple[int, str, str]:
    """Execute a command inside an existing pod via the Kubernetes exec API."""
    try:
        resp = k8s_stream(
            api.connect_get_namespaced_pod_exec,
            pod_name,
            _SANDBOX_NAMESPACE,
            command=["sh", "-c", command],
            stderr=True,
            stdin=False,
            stdout=True,
            tty=False,
            _preload_content=False,
        )
    except ApiException as exc:
        return -1, "", f"Failed to exec in pod: {exc}"

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []
    deadline = time.monotonic() + timeout if timeout > 0 else None
    timed_out = False

    try:
        while resp.is_open():
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                resp.update(timeout=min(1, remaining))
            else:
                resp.update(timeout=1)
            if resp.peek_stdout():
                stdout_chunks.append(resp.read_stdout())
            if resp.peek_stderr():
                stderr_chunks.append(resp.read_stderr())

        if timed_out:
            resp.close()
            return -1, "".join(stdout_chunks), f"Command timed out after {timeout}s"

        # Drain any remaining buffered output after the channel closed.
        if resp.peek_stdout():
            stdout_chunks.append(resp.read_stdout())
        if resp.peek_stderr():
            stderr_chunks.append(resp.read_stderr())

        return_code = _parse_exec_exit_code(resp, stderr_chunks)
    finally:
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass

    return return_code, "".join(stdout_chunks), "".join(stderr_chunks)


async def cleanup_run_command_pods(agent_instance_id: int, username: str) -> None:
    """Delete all run-command pods for a given agent instance and user."""
    if not _IS_IN_CLUSTER:
        _LOGGER.info("Not running in cluster, skipping run-command pod cleanup")
        return
    try:
        api = _get_k8s_client()
        safe_user = sanitize_dns_label(username, max_len=63)
        label_selector = (
            f"app={_POD_LABEL_APP},"
            f"{_POD_LABEL_AGENT_INSTANCE}={agent_instance_id},"
            f"{_POD_LABEL_USER}={safe_user}"
        )
        pods = api.list_namespaced_pod(namespace=_SANDBOX_NAMESPACE, label_selector=label_selector)
        for pod in pods.items:
            try:
                api.delete_namespaced_pod(
                    name=pod.metadata.name,
                    namespace=_SANDBOX_NAMESPACE,
                    body=k8s_client.V1DeleteOptions(grace_period_seconds=0),
                )
                _LOGGER.info("Cleaned up run-command pod %s", pod.metadata.name)
            except ApiException as exc:
                if exc.status != 404:
                    _LOGGER.warning("Failed to delete pod %s: %s", pod.metadata.name, exc)
    except Exception:
        _LOGGER.exception("Failed to clean up run-command pods for agent_instance=%s user=%s", agent_instance_id, username)


class RunCommandInput(BaseModel):
    command: str = Field(
        description=(
            "The shell command to run (e.g. 'python script.py', 'ls -la', "
            "'node script.js', 'uv run script.py')."
        ),
    )
    timeout: int = Field(
        default=0,
        description="Maximum time in seconds to allow the command to run. 0 means no timeout.",
    )
    is_retry: bool = Field(
        default=False,
        description="Set to true when retrying a previously failed command or web-testing run.",
    )


def _command_result_failed(result: dict[str, Any]) -> bool:
    return result.get("return_code") != 0 or bool(result.get("system_error"))


async def _run_command_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"return_code": -1, "stdout": "", "stderr": "", "system_error": "missing tool context"}

    command = str(kwargs.get("command", "")).strip()
    timeout_raw = kwargs.get("timeout", 0)
    is_retry = kwargs.get("is_retry", False)
    if not isinstance(is_retry, bool):
        is_retry = False

    if not command:
        return {"return_code": -1, "stdout": "", "stderr": "", "system_error": "command is required"}

    timeout = max(0, int(timeout_raw) if timeout_raw else 0)

    agent_instance_id = ctx.agent_instance_id
    username = ctx.username
    turn_id = ctx.turn_id

    _LOGGER.info(
        "RunCommand tool start command=%r agent_instance_id=%s turn_id=%s timeout=%s is_retry=%s",
        command,
        agent_instance_id,
        turn_id,
        timeout,
        is_retry,
    )

    action_label = "Retrying" if is_retry else "Running"
    running_status = ToolCallStatus.RETRY_RUNNING if is_retry else ToolCallStatus.RUNNING
    failed_status = ToolCallStatus.RETRY_FAILED if is_retry else ToolCallStatus.FAILED_ANALYZING
    successful_status = ToolCallStatus.RETRY_SUCCESSFUL if is_retry else ToolCallStatus.SUCCESSFUL

    tool_call_id = await ctx.plan_editor.create_tool_call(
        "Run Command",
        f"{action_label}: {command[:80]}",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="run_command",
        ),
        tool_call_status=running_status,
    )

    async def update_message(msg: str) -> ToolCall | None:
        return await ctx.plan_editor.update_tool_call_message(tool_call_id, msg)

    async def update_status(status: ToolCallStatus) -> ToolCall | None:
        return await ctx.plan_editor.update_tool_call_status(tool_call_id, status)

    async def finalize_status(result: dict[str, Any]) -> None:
        await update_status(failed_status if _command_result_failed(result) else successful_status)

    workspace_path = CHAT_FS.get_workspace_path(agent_instance_id, username)

    if not _IS_IN_CLUSTER:
        result = await _run_local(command, workspace_path, timeout, tool_call_id, update_message)
        await finalize_status(result)
        return result

    workspace_host_path = _workspace_host_path(workspace_path)
    pod_name = _pod_name(username, agent_instance_id, turn_id)

    try:
        api = _get_k8s_client()
    except Exception as exc:
        _LOGGER.error("RunCommand failed to create k8s client: %s", exc)
        await update_message("Failed to connect to Kubernetes.")
        await update_status(failed_status)
        return {"return_code": -1, "stdout": "", "stderr": "", "system_error": f"Failed to connect to Kubernetes: {exc}"}

    try:
        await asyncio.to_thread(
            _ensure_pod,
            api,
            pod_name,
            user_id=username,
            agent_instance_id=agent_instance_id,
            workspace_host_path=workspace_host_path,
        )

        return_code, stdout, stderr = await asyncio.to_thread(
            _exec_in_pod,
            api,
            pod_name,
            command,
            timeout=timeout,
        )

        message = f"Command finished with exit code {return_code}."
        await update_message(message)
        result = {
            "return_code": return_code,
            "stdout": _truncate(stdout),
            "stderr": _truncate(stderr),
            "system_error": "",
            "tool_call_id": tool_call_id,
            "message": message,
        }
        await finalize_status(result)

        return result

    except Exception as exc:
        _LOGGER.error("RunCommand execution failed: %s", exc)
        await update_message("Command execution failed.")
        await update_status(failed_status)
        return {"return_code": -1, "stdout": "", "stderr": "", "system_error": str(exc)}


RUN_COMMAND_TOOL = FunctionTool(
    name="run_command",
    description=(
        "Run a shell command in a sandboxed environment and return the output.\n\n"
        "The sandbox runs Alpine Linux with Python 3 and uv pre-installed.\n"
        "If you need other tools, you can install them, e.g., use `apk add --no-cache make` to install GNU Make.\n"
        "The sandbox is persistent during the conversation, and will be cleaned up after the conversation ends.\n"
        "You can run any shell command, python scripts, etc.\n\n"
        "Examples:\n"
        "  - python script.py\n"
        "  - uv run --python 3.14 script.py\n"
        "  - cd skills/xxx && make install\n\n"
        "The working directory is mounted to the same workspace that 'context' tool shows.\n"
        "Relative files must first be written to the workspace using the 'write' tool.\n"
        "The sandbox has network access and limited resources (0.5 CPU, 256MB RAM).\n"
        "Set timeout=0 (default) for no timeout.\n"
        "Set is_retry=true when retrying a failed command or web-testing run.\n"
        "Returns return_code, stdout, stderr, and system_error."
    ),
    input_model=RunCommandInput,
    func=_run_command_func,
)
