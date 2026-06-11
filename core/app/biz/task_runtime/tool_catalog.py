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

"""Single source of truth for the runtime's builtin ``tool`` payloads.

The local :class:`~app.biz.task_runtime.executors.tool_executor.ToolExecutor`
implements a fixed, closed set of builtin tool payloads. Centralising their
canonical names *and* planner-facing usage docs here keeps the two consumers in
lock-step:

* the executor (dispatch side) matches incoming ``tool_name`` against these
  constants, and
* the chat-side general adapter (planning side) renders the same set into its
  tool documentation and validates planner output against
  :data:`RUNTIME_TOOL_NAMES`.

Adding a builtin tool is therefore a single edit here plus its handler in the
executor — the adapter docs and allow-list validation follow automatically.
"""

from __future__ import annotations

from dataclasses import dataclass

ECHO_TOOL_NAME = "echo"
FILE_CONVERT_TOOL_NAME = "file_convert"
RUN_COMMAND_TOOL_NAME = "run_command"


@dataclass(frozen=True, slots=True)
class RuntimeTool:
    """A builtin tool payload implemented by the local ToolExecutor."""

    name: str
    usage: str  # planner-facing one-liner: what it does + required ``args.*``.


# Order matters only for rendering the planner-facing catalogue.
RUNTIME_TOOLS: tuple[RuntimeTool, ...] = (
    RuntimeTool(
        name=RUN_COMMAND_TOOL_NAME,
        usage=(
            "execute a shell command via the configured sandbox/command backend; pass the command line "
            "in `args.command` (optionally `args.image`, `args.timeout`). Provide the exact command \u2014 "
            "the executor does not interpret natural-language descriptions. The command starts with cwd "
            "set to the shared workspace (`$SICO_WORKSPACE_DIR`), which is mounted read-only by "
            "container backends; write all generated files under `$SICO_RESULT_DIR`."
        ),
    ),
    RuntimeTool(
        name=FILE_CONVERT_TOOL_NAME,
        usage=(
            "convert workspace-relative Excel `.xlsx`/`.xlsm` inputs to CSV; pass `args.input_paths` "
            "(or `input_path`), optional `args.sheet`, `args.output_dir` (default `output/csv`), and "
            "`args.target_format='csv'`. All paths must be workspace-relative and explicit."
        ),
    ),
    RuntimeTool(
        name=ECHO_TOOL_NAME,
        usage=(
            "emit a literal message back as the task output; pass `args.message`. Useful for smoke-tests "
            "and placeholder steps only."
        ),
    ),
)

# Membership set used by both the executor and the adapter's allow-list checks.
RUNTIME_TOOL_NAMES: frozenset[str] = frozenset(tool.name for tool in RUNTIME_TOOLS)


def is_runtime_tool(name: str) -> bool:
    """Return whether ``name`` is a builtin tool the local executor implements."""
    return name in RUNTIME_TOOL_NAMES


def runtime_tool_usage(name: str) -> str | None:
    """Return the planner-facing usage doc for a builtin tool, or ``None``."""
    for tool in RUNTIME_TOOLS:
        if tool.name == name:
            return tool.usage
    return None


def render_runtime_tool_catalog(indent: str = "      * ") -> str:
    """Render the planner-facing bullet list of builtin tools (no trailing newline)."""
    return "\n".join(f"{indent}`{tool.name}` \u2014 {tool.usage}" for tool in RUNTIME_TOOLS)


def runtime_tool_names_inline(sep: str = " / ") -> str:
    """Render the builtin tool names as an inline, back-ticked, ``sep``-joined list."""
    return sep.join(f"`{tool.name}`" for tool in RUNTIME_TOOLS)
