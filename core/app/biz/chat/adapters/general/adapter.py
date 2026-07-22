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

"""Fallback "general" adapter for the TASK route.

When no domain-specific adapter (workbook, ...) fits, the chat agent can
call ``delegate`` with ``kind="general"`` and a list of natural-language *task
instructions* plus a description of the tools and skill capabilities it
expects the runtime to dispatch them to. The adapter then asks a single
planner LLM to map each instruction onto exactly one
:class:`~app.biz.chat.task_runtime.models.Dispatch` (tool / skill /
sub-agent) and returns the assembled :class:`PreparedTaskBatch` for the
``delegate`` tool wrapper to submit.

The planner is a single-round structured-output call — there is no inner
loop. If the LLM cannot produce a valid plan, the adapter raises a
:class:`GeneralAdapterError` with a stable ``code`` so the chat agent can
react (re-prompt the user, narrow the inputs, or pick a different
adapter).
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Iterable
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

import app.llmhubs
from app.llmhubs.request_builder import build_llm_request
from app.tools.common import ToolContext

from app.biz.task_runtime.models import (
    PreparedTaskBatch,
    SkillDispatch,
    SubAgentDispatch,
    TaskBatchInput,
    TaskSpec,
    ToolDispatch,
)
from app.biz.task_runtime.sandbox_types import SANDBOX_OSES, normalize_sandbox_hint
from app.biz.task_runtime.skill_loader import CapabilityCard
from app.biz.task_runtime.tool_catalog import (
    RUNTIME_TOOL_NAMES,
    RUNTIME_TOOLS,
    render_runtime_tool_catalog,
    runtime_tool_names_inline,
)
from ...types import Adapter, AdapterInput

_LOGGER = logging.getLogger(__name__)

_PLANNER_MODEL_ENV = "CHAT_GENERAL_ADAPTER_MODEL"


class GeneralAdapterError(Exception):
    """Raised when the general adapter cannot build a usable task batch."""

    def __init__(self, message: str, *, code: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


# ---------------------------------------------------------------------------
# Adapter input (LLM-supplied via ``options_json``)
# ---------------------------------------------------------------------------


class ToolDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="Direct tool name; must match a runtime-registered tool.")
    description: str = Field(default="", description="Short description of what the tool does.")


class GeneralAdapterOptions(BaseModel):
    """``adapter_input.options_json`` payload for :class:`GeneralAdapter`."""

    model_config = ConfigDict(extra="forbid")

    instructions: list[str] = Field(
        default_factory=list,
        description="Per-task natural-language instructions; one TaskSpec is produced per entry.",
    )
    direct_tools: list[ToolDescriptor] = Field(
        default_factory=list,
        description="Direct tool names + descriptions the planner may pick for ToolDispatch.",
    )
    allow_sub_agent: bool = Field(
        default=True,
        description="Whether the planner may emit a SubAgentDispatch when no direct tool / skill fits.",
    )
    default_required_sandbox: str = Field(
        default="",
        description=(
            "OS capability to stamp on tasks when the planner / capability does not specify one. "
            "Accepts '', 'android', or the matching 'sandbox.<os>' infra token."
        ),
    )

    @field_validator("default_required_sandbox", mode="before")
    @classmethod
    def _coerce_default_required_sandbox(cls, value: Any) -> str:
        return normalize_sandbox_hint(value if isinstance(value, str) else "")


# ---------------------------------------------------------------------------
# Planner LLM output schema
# ---------------------------------------------------------------------------


class PlannedTaskItem(BaseModel):
    """One planner output entry; corresponds 1-to-1 to an input instruction."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., description="Short human-readable title (<= 40 chars).")
    dispatch_type: Literal["tool", "skill", "sub_agent"] = Field(
        ...,
        description="Which dispatch kind to use for this task.",
    )
    tool_name: str = Field(default="", description="Direct tool name (required when dispatch_type='tool').")
    skill_name: str = Field(default="", description="Skill name (required when dispatch_type='skill').")
    action_name: str = Field(default="", description="Skill action name (optional, with dispatch_type='skill').")
    sub_agent_persona: str = Field(default="default", description="Sub-agent persona (dispatch_type='sub_agent').")
    sub_agent_max_steps: int | None = Field(
        default=None,
        description="Optional reasoning-loop cap for sub-agent dispatch.",
    )
    sub_agent_capabilities: list[str] = Field(
        default_factory=list,
        description="Optional allow-list of capability names granted to the sub-agent.",
    )
    required_sandbox: str = Field(
        default="",
        description=(
            "OS capability this task needs (e.g. 'android'); empty means inherit "
            "capability / default."
        ),
    )
    stage: int = Field(
        default=0,
        ge=0,
        description=(
            "Execution order within the batch. Tasks sharing a stage run in parallel; lower stages "
            "finish before higher stages start. Use 0 (default) for independent tasks. Raise it only "
            "when this task consumes another task's output (e.g. run a skill after a rewrite skill that "
            "produced the file it reads) \u2014 the shared run workspace carries the hand-off."
        ),
    )
    args_json: str = Field(
        default="",
        description=(
            "JSON-encoded object of extra arguments to attach to TaskSpec.args. "
            "Kept as a string for strict structured-output compatibility."
        ),
    )
    rationale: str = Field(default="", description="Why this dispatch was picked (logged, not surfaced).")

    @field_validator("required_sandbox", mode="before")
    @classmethod
    def _coerce_required_sandbox(cls, value: Any) -> str:
        # The value is LLM-supplied; normalize an OS name or infra token to the
        # canonical OS selector and collapse anything unrecognized to "" so a
        # stray hint never fails schema validation for the whole batch.
        return normalize_sandbox_hint(value if isinstance(value, str) else "")


class GeneralPlannerOutput(BaseModel):
    """Top-level planner LLM response: one :class:`PlannedTaskItem` per input instruction."""

    model_config = ConfigDict(extra="forbid")

    tasks: list[PlannedTaskItem] = Field(..., description="One entry per input instruction, in the same order.")


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

class GeneralAdapter(Adapter):
    """Fallback adapter that asks a planner LLM to map free-form instructions onto dispatches."""

    name = "general"
    description = (
        "Fallback effectful-task adapter. Use it when no domain-specific adapter fits and you want to "
        "delegate a small list of independent task instructions to the task runtime. A single-round "
        "planner LLM maps each instruction onto exactly one dispatch (`tool`, `skill`, or `sub_agent`) "
        "using the supplied descriptors, and the resulting batch is submitted as one shot \u2014 the "
        "call both *plans* and *executes*.\n"
        "Do not use this adapter to follow instruction-only Markdown skills (skills with no `action_name`). "
        "Those skills are not task-runtime capabilities; the chat agent must read their SKILL.md and carry out "
        "the documented workflow itself with chat tools such as `curl`.\n"
        "\n"
        "Important: only the `sub_agent` dispatch can interpret free-form natural language at execution "
        "time. For `tool` and `skill` dispatches the planner expects the caller to have already resolved "
        'the work into concrete, fully-specified arguments \u2014 do not pass an instruction like "figure '
        'out the right file and convert it" and rely on the runtime to guess. The only exception is when '
        "a specific tool or skill description explicitly states it accepts a free-form prompt; default "
        "behavior is strict, structured arguments.\n"
        "\n"
        "`options_json` must decode to a JSON object with the following fields:\n"
        "  - instructions (list[str], required, non-empty): per-task instructions; one TaskSpec is "
        "produced per entry. For `tool` / `skill` work the instruction should already name the tool / "
        "skill and spell out the exact arguments (paths, ids, command line, etc.). Reserve open-ended "
        "natural language for instructions you expect the planner to route to `sub_agent`.\n"
        "  - direct_tools (list[{name, description}]): direct tool names the planner may pick for "
        "ToolDispatch. The runtime's local executor only implements " + str(len(RUNTIME_TOOLS)) + " tool payloads, so "
        "`name` MUST be one of:\n" + render_runtime_tool_catalog() + "\n"
        "    Do NOT supply chat-side tool names (e.g. `read`, `grep`, `webfetch`, `curl`, `download`, "
        "`parse_document`, `search_memory`, `write_file`, `edit`, plan tools, etc.) here \u2014 those run "
        "in the chat agent, not the task runtime, and will be rejected by the planner / executor.\n"
        "  - allow_sub_agent (bool, default true): whether the planner may emit SubAgentDispatch when no "
        "direct tool / skill fits. This is the only dispatch that natively handles open-ended natural "
        "language \u2014 prefer it (over inventing a new `direct_tools` entry) when the work does not map "
        "to " + runtime_tool_names_inline() + " or an existing skill.\n"
        "  - default_required_sandbox (str, optional): OS capability to stamp on tasks when the planner / "
        "capability does not specify one. Allowed values: `android`, "
        'or leave empty (`""`) when the work does not need a dedicated sandbox \u2014 e.g. local '
        "`run_command` calls, `file_convert`, `echo`, or skills that declare no sandbox requirement."
    )

    async def build_tasks(self, context: ToolContext, adapter_input: AdapterInput) -> PreparedTaskBatch:
        options = _parse_options(adapter_input.options_json)
        skill_cards = _loader_skill_cards(context.skill_loader)
        if not options.instructions:
            raise GeneralAdapterError(
                "general adapter requires at least one instruction",
                code="general_no_instructions",
                details={},
            )

        plan = await _run_planner(options, skill_cards)
        if len(plan.tasks) != len(options.instructions):
            raise GeneralAdapterError(
                f"planner returned {len(plan.tasks)} tasks for {len(options.instructions)} instructions",
                code="general_planner_invalid_output",
                details={
                    "expected_task_count": len(options.instructions),
                    "received_task_count": len(plan.tasks),
                },
            )

        tool_index = {t.name: t for t in options.direct_tools}
        skill_index = {(card.skill_name, card.action_name): card for card in skill_cards}

        try:
            tasks = tuple(
                _build_task_spec(index, instruction, planned, options, tool_index, skill_index)
                for index, (instruction, planned) in enumerate(
                    zip(options.instructions, plan.tasks, strict=True),
                    start=1,
                )
            )
        except GeneralAdapterError:
            raise
        except ValueError as exc:
            raise GeneralAdapterError(
                str(exc),
                code="general_planner_invalid_output",
                details={"plan": [item.model_dump() for item in plan.tasks]},
            ) from exc

        return PreparedTaskBatch(
            batch=TaskBatchInput(
                tasks=tasks,
                description=_batch_description(options, tasks),
            ),
            batch_metadata={
                "general_planner": {
                    "instruction_count": len(options.instructions),
                    "tool_count": len(options.direct_tools),
                    "skill_count": len(skill_cards),
                    "allow_sub_agent": options.allow_sub_agent,
                }
            },
        )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _parse_options(options_json: str) -> GeneralAdapterOptions:
    if not options_json.strip():
        decoded: Any = {}
    else:
        try:
            decoded = json.loads(options_json)
        except json.JSONDecodeError as exc:
            raise GeneralAdapterError(
                f"general adapter options_json is not valid JSON: {exc}",
                code="general_options_invalid",
                details={"options_json": options_json},
            ) from exc
    if not isinstance(decoded, dict):
        raise GeneralAdapterError(
            "general adapter options_json must decode to a JSON object",
            code="general_options_invalid",
            details={"options_json": options_json},
        )
    try:
        options = GeneralAdapterOptions.model_validate(decoded)
    except ValidationError as exc:
        raise GeneralAdapterError(
            f"general adapter options_json failed validation: {exc.errors()}",
            code="general_options_invalid",
            details={"options_json": options_json},
        ) from exc
    _validate_direct_tools(options)
    return options


def _validate_direct_tools(options: GeneralAdapterOptions) -> None:
    """Reject any ``direct_tools`` entry the local executor cannot run.

    ``direct_tools`` advertises which builtin tools the planner may pick; gating
    it against :data:`RUNTIME_TOOL_NAMES` here means a caller can never offer a
    name the executor would later reject, and keeps the catalogue honest as the
    single source of truth.
    """
    unknown = sorted({t.name.strip() for t in options.direct_tools if t.name.strip() not in RUNTIME_TOOL_NAMES})
    if unknown:
        raise GeneralAdapterError(
            f"general adapter direct_tools include unsupported tool name(s): {unknown}",
            code="general_options_invalid",
            details={"unknown_tools": unknown, "supported_tools": sorted(RUNTIME_TOOL_NAMES)},
        )


_PLANNER_SYSTEM_PROMPT = """\
You are a task planner for an AI agent platform. You receive a list of N
*task instructions* plus the catalogues of direct tools and skill
capabilities the runtime can dispatch to. Produce exactly N planned
tasks, in the same order as the input instructions, where each planned
task picks exactly one dispatch:

- "tool": a direct local tool. Set `tool_name` to one of the supplied
  `direct_tools[*].name` values and pack the tool's required arguments
  into `args_json` exactly as documented by the tool's description.
  Do NOT pass a free-form natural-language instruction and expect the
  tool to interpret it — tools execute literal arguments only, unless
  the tool description explicitly says it accepts a prompt-style input.
- "skill": an executable skill capability. Set `skill_name` (and
  `action_name` when supplied) to one of the supplied
    `skill_capabilities[*]` entries and pack the skill's required
    arguments into `args_json` per the selected skill capability's
    `parameters` list. `args_json` keys MUST be a subset of that exact
    parameter-name list. Include parameters marked `required: true`; omit
    optional parameters unless the instruction supplies a concrete value. Do not
    invent arguments from the instruction text when they are not listed in the
    selected capability's `parameters`. Same rule as for tools: assume strict,
    structured inputs unless the skill's description says otherwise.
- "sub_agent": delegate to a generalist sub-agent loop. Only allowed
  when `allow_sub_agent` is true; pick this when the instruction is
  open-ended natural language that no direct tool or skill can execute
  with concrete arguments. This is the only dispatch that natively
  handles free-form prompts. Optionally set `sub_agent_capabilities` to
  scope the loop's allow-list, choosing only from the supplied catalogue:
  a `direct_tools[*].name` (bare name) or a skill as `skill_name.action_name`.
  Leave it empty to grant the whole supplied catalogue; the sub-agent can
  never reach a capability outside the tools/skills provided in this batch.

For every task also write a short `title` (<= 40 chars). Pack any
structured arguments the chosen dispatch expects into `args_json` as a
JSON object string; leave it empty only when the dispatch genuinely
needs no arguments. Use `required_sandbox` only when overriding the
capability default — leave it empty when the task does not need a
dedicated sandbox (local `run_command`, `file_convert`, `echo`, or
skills that declare no sandbox requirement). Reply with JSON matching
the schema; do not wrap in markdown.

Ordering: tasks default to `stage` 0 and run in parallel. Set a higher
`stage` only when a task depends on another task's output — give the
producer the lower stage and the consumer the higher one (e.g. a
"rewrite" skill at stage 0 and the "run" skill that reads its output at
stage 1). Tasks sharing a stage still run in parallel; the runtime
finishes every stage before starting the next. When unsure, keep 0.
"""


def _model_name(env_key: str) -> str | None:
    value = os.getenv(env_key)
    if not value:
        return None
    return value.strip() or None


_JSON_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)


def _strip_json_fence(text: str) -> str:
    payload = text.strip()
    match = _JSON_FENCE_PATTERN.match(payload)
    if match:
        return match.group(1).strip()
    return payload


async def _run_planner(options: GeneralAdapterOptions, skill_cards: list[CapabilityCard]) -> GeneralPlannerOutput:
    user_payload = {
        "instructions": list(options.instructions),
        "direct_tools": [t.model_dump() for t in options.direct_tools],
        "skill_capabilities": [_skill_capability_payload(card) for card in skill_cards],
        "allow_sub_agent": options.allow_sub_agent,
        "default_required_sandbox": options.default_required_sandbox,
    }
    messages = [
        {"role": "system", "content": _PLANNER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [{"type": "text", "text": json.dumps(user_payload, ensure_ascii=False, indent=2)}],
        },
    ]
    request = build_llm_request(
        messages,
        model=_model_name(_PLANNER_MODEL_ENV),
        response_format=GeneralPlannerOutput,
    )
    try:
        response = await app.llmhubs.generate(request=request)
    except Exception as exc:  # noqa: BLE001
        raise GeneralAdapterError(
            f"planner LLM call failed: {exc}",
            code="general_planner_llm_failed",
            details={},
        ) from exc
    if response.code != 0:
        raise GeneralAdapterError(
            f"planner LLM returned non-zero code: {response.msg}",
            code="general_planner_llm_failed",
            details={"code": response.code, "msg": response.msg},
        )

    structured: Any = None
    if response.outputs:
        for output in response.outputs:
            if getattr(output, "json", None) is not None:
                structured = output.json
                break
    if structured is None:
        text = ""
        if response.outputs:
            text = response.outputs[0].text or ""
        text = text or getattr(response, "text", "") or ""
        if not text:
            raise GeneralAdapterError(
                "planner LLM returned an empty response",
                code="general_planner_invalid_output",
                details={},
            )
        try:
            structured = json.loads(_strip_json_fence(text))
        except json.JSONDecodeError as exc:
            raise GeneralAdapterError(
                f"planner LLM response is not valid JSON: {exc}",
                code="general_planner_invalid_output",
                details={"raw_preview": text[:200]},
            ) from exc

    try:
        return GeneralPlannerOutput.model_validate(structured)
    except ValidationError as exc:
        raise GeneralAdapterError(
            f"planner LLM response failed schema validation: {exc.errors()}",
            code="general_planner_invalid_output",
            details={"raw": structured},
        ) from exc


def _build_task_spec(
    index: int,
    instruction: str,
    planned: PlannedTaskItem,
    options: GeneralAdapterOptions,
    tool_index: dict[str, ToolDescriptor],
    skill_index: dict[tuple[str, str], CapabilityCard],
) -> TaskSpec:
    title = (planned.title or instruction[:40] or f"task-{index}").strip()[:80]
    task_id = f"general-{index:03d}"
    # ``args`` carries the skill / tool parameters supplied by the planner. They are
    # forwarded verbatim as the dispatch's user input, and strict-schema skills (e.g.
    # android-tester) reject unknown keys. Do not inject adapter bookkeeping such as a
    # positional index here; task ordering/correlation already uses ``task_id``/``stage``.
    args = _decode_args(planned.args_json)

    dispatch: Any
    required_sandbox = planned.required_sandbox or ""

    if planned.dispatch_type == "tool":
        tool_name = planned.tool_name.strip()
        if not tool_name:
            raise GeneralAdapterError(
                f"planned task #{index} dispatch_type='tool' requires tool_name",
                code="general_planner_invalid_output",
                details={"planned": planned.model_dump()},
            )
        if tool_name not in RUNTIME_TOOL_NAMES:
            raise GeneralAdapterError(
                f"planned task #{index} references tool_name={tool_name!r} that the runtime does not implement",
                code="general_planner_invalid_output",
                details={
                    "planned": planned.model_dump(),
                    "supported_tools": sorted(RUNTIME_TOOL_NAMES),
                },
            )
        if tool_index and tool_name not in tool_index:
            raise GeneralAdapterError(
                f"planned task #{index} references unknown tool_name={tool_name!r}",
                code="general_planner_invalid_output",
                details={
                    "planned": planned.model_dump(),
                    "available_tools": list(tool_index.keys()),
                },
            )
        dispatch = ToolDispatch(tool_name=tool_name)
    elif planned.dispatch_type == "skill":
        skill_name = planned.skill_name.strip()
        action_name = planned.action_name.strip()
        if not skill_name:
            raise GeneralAdapterError(
                f"planned task #{index} dispatch_type='skill' requires skill_name",
                code="general_planner_invalid_output",
                details={"planned": planned.model_dump()},
            )
        descriptor = skill_index.get((skill_name, action_name)) or skill_index.get((skill_name, ""))
        if skill_index and descriptor is None:
            raise GeneralAdapterError(
                f"planned task #{index} references unknown skill={skill_name!r} action={action_name!r}",
                code="general_planner_invalid_output",
                details={
                    "planned": planned.model_dump(),
                    "available_skills": [
                        {"skill_name": card.skill_name, "action_name": card.action_name} for card in skill_index.values()
                    ],
                },
            )
        if descriptor is not None:
            _validate_skill_args(index, planned, descriptor, args)
        dispatch = SkillDispatch(skill_name=skill_name, action_name=action_name)
    elif planned.dispatch_type == "sub_agent":
        if not options.allow_sub_agent:
            raise GeneralAdapterError(
                f"planned task #{index} used dispatch_type='sub_agent' but allow_sub_agent=false",
                code="general_planner_disallowed_dispatch",
                details={"planned": planned.model_dump()},
            )
        # The sub-agent loop may only reach capabilities the chat layer granted in
        # this batch. An explicit planner allow-list wins but must stay within the
        # supplied catalogue; otherwise we inherit the full supplied catalogue
        # (never the global skill registry) so the sub-agent's reach stays bounded
        # by the contract the caller declared.
        catalogue = _catalogue_capability_names(options, skill_index.values())
        explicit = [name.strip() for name in planned.sub_agent_capabilities if name.strip()]
        if explicit:
            allowed = set(catalogue)
            unknown = sorted({name for name in explicit if name not in allowed})
            if unknown:
                raise GeneralAdapterError(
                    f"planned task #{index} sub_agent_capabilities reference name(s) outside the supplied catalogue: {unknown}",
                    code="general_planner_invalid_output",
                    details={
                        "planned": planned.model_dump(),
                        "unknown_capabilities": unknown,
                        "supported_capabilities": catalogue,
                    },
                )
            capabilities = explicit
        else:
            capabilities = catalogue
        dispatch = SubAgentDispatch(
            persona=planned.sub_agent_persona or "default",
            max_steps=planned.sub_agent_max_steps,
            capabilities=capabilities,
        )
    else:  # pragma: no cover - guarded by Literal validation
        raise GeneralAdapterError(
            f"planned task #{index} has unsupported dispatch_type={planned.dispatch_type!r}",
            code="general_planner_invalid_output",
            details={"planned": planned.model_dump()},
        )

    if not required_sandbox:
        required_sandbox = options.default_required_sandbox or ""
    sandbox_value = required_sandbox if required_sandbox in SANDBOX_OSES else None

    return TaskSpec(
        task_id=task_id,
        title=title,
        instructions=instruction,
        dispatch=dispatch,
        stage=planned.stage,
        args=args,
        metadata={
            "general_planner": {
                "dispatch_type": planned.dispatch_type,
                "rationale": planned.rationale,
            }
        },
        required_sandbox=sandbox_value,  # type: ignore[arg-type]
    )


def _catalogue_capability_names(options: GeneralAdapterOptions, skill_cards: Iterable[CapabilityCard]) -> list[str]:
    """Capability allow-list a sub-agent inherits when the planner names none.

    Bounded strictly to the tools/skills the chat layer supplied in this batch —
    never the global skill registry — so the sub-agent's reach stays within the
    contract the caller declared. Tool capabilities are bare names; skill
    capabilities are ``skill.action`` (action-less descriptors are skipped since
    the skill executor cannot run an action-less skill).
    """
    names: list[str] = [t.name.strip() for t in options.direct_tools if t.name.strip()]
    for card in skill_cards:
        skill_name = card.skill_name.strip()
        action_name = card.action_name.strip()
        if skill_name and action_name:
            names.append(f"{skill_name}.{action_name}")
    seen: set[str] = set()
    unique: list[str] = []
    for name in names:
        if name not in seen:
            seen.add(name)
            unique.append(name)
    return unique


def _loader_skill_cards(loader: Any | None) -> list[CapabilityCard]:
    if loader is None:
        return []
    try:
        cards = loader.list_cards()
    except Exception:
        _LOGGER.warning("general_adapter_skill_loader_failed", exc_info=True)
        return []
    return [card for card in cards if card.action_name]


def _skill_capability_payload(card: CapabilityCard) -> dict[str, Any]:
    return {
        "skill_name": card.skill_name,
        "action_name": card.action_name,
        "description": card.action_description or card.description,
        "parameters": list(card.parameters),
        "infra_requirements": list(card.infra_requirements),
    }


def _validate_skill_args(index: int, planned: PlannedTaskItem, card: CapabilityCard, args: dict[str, Any]) -> None:
    known = {str(parameter.get("name") or "").strip() for parameter in card.parameters if isinstance(parameter, dict)}
    known.discard("")
    unknown = sorted(arg for arg in args if arg not in known)
    if unknown:
        raise GeneralAdapterError(
            f"planned task #{index} args_json includes unknown skill argument(s): {unknown}",
            code="general_planner_invalid_output",
            details={
                "planned": planned.model_dump(),
                "skill_name": card.skill_name,
                "action_name": card.action_name,
                "unknown_args": unknown,
                "allowed_args": sorted(known),
            },
        )
    required = sorted(
        str(parameter.get("name") or "").strip()
        for parameter in card.parameters
        if isinstance(parameter, dict) and parameter.get("required") is True and str(parameter.get("name") or "").strip()
    )
    missing = [name for name in required if name not in args]
    if missing:
        raise GeneralAdapterError(
            f"planned task #{index} args_json is missing required skill argument(s): {missing}",
            code="general_planner_invalid_output",
            details={
                "planned": planned.model_dump(),
                "skill_name": card.skill_name,
                "action_name": card.action_name,
                "missing_args": missing,
                "allowed_args": sorted(known),
            },
        )


def _decode_args(args_json: str) -> dict[str, Any]:
    if not args_json or not args_json.strip():
        return {}
    try:
        decoded = json.loads(args_json)
    except json.JSONDecodeError:
        _LOGGER.warning("general_planner_args_json_invalid preview=%s", args_json[:200])
        return {}
    if not isinstance(decoded, dict):
        _LOGGER.warning("general_planner_args_json_not_object type=%s", type(decoded).__name__)
        return {}
    return decoded


def _batch_description(options: GeneralAdapterOptions, tasks: tuple[TaskSpec, ...]) -> str:
    summary = f"general adapter: {len(tasks)} task(s) planned from {len(options.instructions)} instruction(s)"
    kinds: dict[str, int] = {}
    for task in tasks:
        kinds[task.kind] = kinds.get(task.kind, 0) + 1
    if kinds:
        summary += " (" + ", ".join(f"{k}:{v}" for k, v in sorted(kinds.items())) + ")"
    return summary


__all__ = [
    "GeneralAdapter",
    "GeneralAdapterError",
    "GeneralAdapterOptions",
    "GeneralPlannerOutput",
    "PlannedTaskItem",
    "ToolDescriptor",
]
