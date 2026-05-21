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

import asyncio
import logging
import shlex
import subprocess
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolExecutionInfo, ToolType
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 30  # seconds
_MAX_TIMEOUT = 120  # seconds
_MAX_OUTPUT_SIZE = 100 * 1024  # 100KB per stream
_TRUNCATED_MARKER = "\n...TRUNCATED..."


class CurlInput(BaseModel):
    command: str = Field(
        description=(
            'The full curl command to execute. Must start with "curl".\n'
            "Examples:\n"
            '  - curl https://api.example.com/data\n'
            '  - curl -X POST -H "Content-Type: application/json" -d \'{"key": "value"}\' https://api.example.com/data\n'
            '  - curl -s -o /dev/null -w "%{http_code}" https://example.com\n'
            '  - curl -I https://example.com\n'
            '  - curl -u user:pass https://api.example.com/protected'
        ),
    )
    timeout: int | None = Field(
        default=None,
        description=f"Optional timeout in seconds (max {_MAX_TIMEOUT}). Defaults to {_DEFAULT_TIMEOUT}s.",
    )


async def _curl_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context", "return_code": -1, "stdout": "", "stderr": ""}

    command = str(kwargs.get("command", "")).strip()
    timeout_raw = kwargs.get("timeout")

    if not command:
        return {"error_message": "command is required", "return_code": -1, "stdout": "", "stderr": ""}

    # Validate command starts with "curl"
    if not command.startswith("curl"):
        return {
            "error_message": 'Command must start with "curl"',
            "return_code": -1,
            "stdout": "",
            "stderr": "",
        }

    timeout = min(int(timeout_raw) if timeout_raw is not None else _DEFAULT_TIMEOUT, _MAX_TIMEOUT)
    timeout = max(1, timeout)

    _LOGGER.info("Curl tool start command=%s timeout=%s", command, timeout)

    plan_editor = ctx.plan_editor
    tool_call_id = await plan_editor.create_tool_call(
        "cURL", "Using cURL tool to execute HTTP request",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="curl",
        )
    )

    def _impl() -> dict[str, Any]:
        try:
            args = shlex.split(command)
        except ValueError as exc:
            return {
                "error_message": f"Failed to parse command: {exc}",
                "return_code": -1,
                "stdout": "",
                "stderr": "",
            }

        # Ensure the executable is actually curl
        if args[0] != "curl":
            return {
                "error_message": 'Command must start with "curl"',
                "return_code": -1,
                "stdout": "",
                "stderr": "",
            }

        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
            )
        except FileNotFoundError:
            return {
                "error_message": "curl executable not found",
                "return_code": -1,
                "stdout": "",
                "stderr": "",
            }
        except subprocess.TimeoutExpired:
            return {
                "error_message": f"Command timed out after {timeout}s",
                "return_code": -1,
                "stdout": "",
                "stderr": "",
            }

        stdout = result.stdout
        stderr = result.stderr

        # Truncate large outputs
        if len(stdout.encode("utf-8")) > _MAX_OUTPUT_SIZE:
            stdout = stdout.encode("utf-8")[:_MAX_OUTPUT_SIZE].decode("utf-8", errors="ignore") + _TRUNCATED_MARKER
        if len(stderr.encode("utf-8")) > _MAX_OUTPUT_SIZE:
            stderr = stderr.encode("utf-8")[:_MAX_OUTPUT_SIZE].decode("utf-8", errors="ignore") + _TRUNCATED_MARKER

        return {
            "error_message": "",
            "return_code": result.returncode,
            "stdout": stdout,
            "stderr": stderr,
        }

    try:

        result = await asyncio.to_thread(_impl)
        message = f"cURL command executed with return code {result['return_code']}."
        await plan_editor.update_tool_call_message(tool_call_id, message)
        result["tool_call_id"] = tool_call_id
        result["message"] = message
        return result

    except Exception as exc:
        _LOGGER.error("Curl tool failed command=%s error=%s", command, exc)
        message = "cURL command execution failed."
        await plan_editor.update_tool_call_message(tool_call_id, message)
        result = {
            "error_message": str(exc),
            "return_code": -1,
            "stdout": "",
            "stderr": "",
            "tool_call_id": tool_call_id,
            "message": message
        }
        return result


CURL_TOOL = FunctionTool(
    name="curl",
    description=(
        "Run a curl command and return the output.\n"
        "Takes a curl command string as input, runs it, and returns the return code, stdout, and stderr.\n\n"
        "Usage notes:\n"
        '- The command must start with "curl"\n'
        "- Supports all standard curl options (headers, methods, data payloads, etc.)\n"
        f"- Default timeout: {_DEFAULT_TIMEOUT}s, maximum: {_MAX_TIMEOUT}s\n"
        "- Output is truncated if it exceeds 100KB\n\n"
        "Examples:\n"
        "  curl https://api.example.com/data\n"
        '  curl -X POST -H "Content-Type: application/json" -d \'{"key":"value"}\' https://api.example.com/data\n'
        '  curl -s -o /dev/null -w "%{http_code}" https://example.com\n'
        "  curl -I https://example.com"
    ),
    input_model=CurlInput,
    func=_curl_func,
)
