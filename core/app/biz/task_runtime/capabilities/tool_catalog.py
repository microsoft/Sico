"""Single source of truth for the runtime's builtin ``tool`` payloads.

The builtin :class:`~app.biz.task_runtime.capabilities.builtin.BuiltinCapabilityProvider`
implements a fixed, closed set of payloads. Centralising their canonical names,
planner-facing usage docs *and* descriptor metadata here keeps every consumer in
lock-step:

* the provider projects these entries into ``CapabilityDescriptor``s (catalogue
  + execution policy), and
* task preparation renders the same set into planner metadata and validates
    decisions against :data:`RUNTIME_TOOL_NAMES`.

Adding a builtin tool is therefore a single edit here plus its handler in the
provider — planner metadata, the catalogue and allow-list validation follow
automatically.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

ECHO_TOOL_NAME = "echo"
FILE_CONVERT_TOOL_NAME = "file_convert"
RUN_COMMAND_TOOL_NAME = "run_command"


@dataclass(frozen=True, slots=True)
class RuntimeTool:
    """A builtin tool payload implemented by the builtin capability provider.

    ``effect`` and ``workspace_access`` are declared here rather than inferred
    downstream: an invocation policy can only be fail-closed if every payload is
    forced to state whether it changes external state.
    """

    name: str
    usage: str  # planner-facing one-liner: what it does + required ``args.*``.
    parameter_schema: dict[str, Any]
    effect: Literal["read", "mutate"]
    workspace_access: Literal["none", "read_only", "read_write"]


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
        parameter_schema={
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Exact shell command line to execute."},
                "image": {"type": "string", "description": "Optional container image for container backends."},
                "timeout": {"type": "integer", "minimum": 0, "description": "Optional timeout override in seconds."},
            },
            "required": ["command"],
        },
        effect="mutate",
        # The shared workspace is mounted read-only; durable output goes to the
        # per-run result directory.
        workspace_access="read_only",
    ),
    RuntimeTool(
        name=FILE_CONVERT_TOOL_NAME,
        usage=(
            "convert workspace-relative Excel `.xlsx`/`.xlsm` inputs to CSV; pass `args.input_paths` "
            "(or `input_path`), optional `args.sheet`, `args.output_dir` (default `output/csv`), and "
            "`args.target_format='csv'`. All paths must be workspace-relative and explicit."
        ),
        parameter_schema={
            "type": "object",
            "properties": {
                "input_paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Workspace-relative Excel paths to convert.",
                },
                "input_path": {"type": "string", "description": "Single workspace-relative Excel path."},
                "sheet": {"type": "string", "description": "Optional worksheet name; defaults to the first sheet."},
                "output_dir": {"type": "string", "description": "Result-relative output directory."},
                "target_format": {"type": "string", "enum": ["csv"], "description": "Only `csv` is supported."},
            },
        },
        effect="mutate",
        workspace_access="read_only",
    ),
    RuntimeTool(
        name=ECHO_TOOL_NAME,
        usage=(
            "emit a literal message back as the task output; pass `args.message`. Useful for smoke-tests "
            "and placeholder steps only."
        ),
        parameter_schema={
            "type": "object",
            "properties": {"message": {"type": "string", "description": "Literal text to echo back."}},
        },
        effect="read",
        workspace_access="none",
    ),
)

# Membership set used by both the provider and the adapter's allow-list checks.
RUNTIME_TOOL_NAMES: frozenset[str] = frozenset(tool.name for tool in RUNTIME_TOOLS)


def is_runtime_tool(name: str) -> bool:
    """Return whether ``name`` is a builtin tool the runtime implements."""
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
