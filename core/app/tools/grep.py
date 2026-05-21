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
import os
import subprocess
from pathlib import Path
from typing import Any

from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel, Field

from app.schemas.conversation.plan import ToolExecutionInfo, ToolType
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context

_LOGGER = logging.getLogger(__name__)

_RIPGREP_PATH = os.getenv("RIPGREP_PATH", "rg")
_MAX_MATCHES = 100
_MAX_LINE_LENGTH = 2000



class GrepInput(BaseModel):
    pattern: str = Field(description="The regex pattern to search for in workspace files.")


async def _grep_func(invocation_ctx: FunctionInvocationContext, **kwargs: Any) -> dict[str, Any]:
    pattern = str(kwargs.get("pattern", "")).strip()
    if not pattern:
        _LOGGER.info("Grep tool called with empty pattern")
        return {"error_message": "pattern is required", "matches": 0, "output": ""}

    ctx: ToolContext | None = get_tool_context(invocation_ctx)
    if ctx is None:
        return {"error_message": "missing tool context", "matches": 0, "output": ""}

    _LOGGER.info("Grep tool start pattern=%s agent_instance_id=%s", pattern, ctx.agent_instance_id)

    plan_editor = ctx.plan_editor
    tool_call_id = await plan_editor.create_tool_call(
        "Grep", f"Searching for pattern: {pattern}",
        ToolExecutionInfo(
            tool_type=ToolType.BUILTIN,
            builtin_tool_name="grep",
        )
    )

    try:
        result = await asyncio.to_thread(_run_grep, ctx, pattern)
        await plan_editor.update_tool_call_message(tool_call_id, f"Found {result['matches']} matches.")
        return {"error_message": "", **result}
    except Exception as exc:
        _LOGGER.error("Grep tool failed pattern=%s error=%s", pattern, exc)
        await plan_editor.update_tool_call_message(tool_call_id, "Grep tool execution failed.")
        return {"error_message": str(exc), "matches": 0, "output": ""}


def _run_ripgrep(workspace: Path, pattern: str) -> tuple[int, str, str] | dict[str, Any]:
    args = [
        _RIPGREP_PATH,
        "-nH",
        "--no-messages",
        "--field-match-separator=|",
        "--regexp",
        pattern,
        str(workspace),
    ]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=30, encoding="utf-8")
    except FileNotFoundError:
        return {"matches": 0, "output": f"ripgrep not found at {_RIPGREP_PATH}"}
    except subprocess.TimeoutExpired:
        return {"matches": 0, "output": "Search timed out"}
    return result.returncode, result.stdout, result.stderr


def _parse_ripgrep_matches(stdout: str, workspace: Path) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for line in stdout.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|", 2)
        if len(parts) < 3:
            continue
        file_path_str, line_num_str, line_text = parts
        try:
            line_num = int(line_num_str)
        except ValueError:
            continue
        file_path = Path(file_path_str)
        try:
            rel_path = file_path.relative_to(workspace).as_posix()
        except ValueError:
            rel_path = file_path.name
        matches.append({"file": rel_path, "line": line_num, "text": line_text})
    matches.sort(key=lambda m: (m.get("file", ""), m.get("line", 0)))
    return matches


def _format_grep_output(
    final_matches: list[dict[str, Any]],
    truncated: bool,
    has_errors: bool,
) -> str:
    output_lines = [f"Found {len(final_matches)} matches"]
    current_file = None
    for match in final_matches:
        if current_file != match["file"]:
            if current_file is not None:
                output_lines.append("")
            current_file = match["file"]
            output_lines.append(f"{match['file']}:")
        text = match["text"]
        if len(text) > _MAX_LINE_LENGTH:
            text = text[:_MAX_LINE_LENGTH] + "..."
        output_lines.append(f"  Line {match['line']}: {text}")
    if truncated:
        output_lines.append("")
        output_lines.append("(Results truncated. Consider using a more specific pattern.)")
    if has_errors:
        output_lines.append("")
        output_lines.append("(Some paths were inaccessible and skipped)")
    return "\n".join(output_lines)


def _run_grep(ctx: ToolContext, pattern: str) -> dict[str, Any]:
    workspace = CHAT_FS.get_workspace_path(ctx.agent_instance_id, ctx.username)
    if not workspace.exists():
        return {"matches": 0, "output": "Workspace is empty"}

    rg_result = _run_ripgrep(workspace, pattern)
    if isinstance(rg_result, dict):
        return rg_result
    returncode, stdout, stderr = rg_result

    if returncode == 1 or (returncode == 2 and not stdout.strip()):
        return {"matches": 0, "output": "No matches found"}
    if returncode not in (0, 2):
        return {"matches": 0, "output": f"ripgrep error: {stderr.strip()}"}

    has_errors = returncode == 2
    matches = _parse_ripgrep_matches(stdout, workspace)
    truncated = len(matches) > _MAX_MATCHES
    final_matches = matches[:_MAX_MATCHES]

    if not final_matches:
        _LOGGER.info("Grep tool parsed zero matches after processing")
        return {"matches": 0, "output": "No matches found"}

    output = _format_grep_output(final_matches, truncated, has_errors)
    _LOGGER.info(
        "Grep tool success pattern=%s raw_matches=%s returned_matches=%s truncated=%s has_errors=%s",
        pattern,
        len(matches),
        len(final_matches),
        truncated,
        has_errors,
    )
    return {"matches": len(final_matches), "truncated": truncated, "output": output}


GREP_TOOL = FunctionTool(
    name="grep",
    description=(
        "Search for a regex pattern across all files in the workspace directory. "
        "Returns matching lines with file paths and line numbers. "
        "Use this to find relevant content before reading specific files."
    ),
    input_model=GrepInput,
    func=_grep_func,
)
