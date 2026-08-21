"""Production :class:`AgentModel` backed by the llmhubs structured-output layer.

The sub-agent executor (:mod:`.executor`) owns the control loop,
budget and allow-list *enforcement*; the one thing it cannot do deterministically
is *decide the next action*. That decision is this module's sole job: turn the
current :class:`AgentModelState` into one structured choice: call a capability or
declare a final answer.

Design notes
------------
- **Reuse, don't reinvent.** We lean on
  :meth:`app.llmhubs.structured.HubLLMClient.complete_structured`, which already
  drives a single LLM completion through llmhubs and validates the reply against
  a Pydantic schema. The full agent_framework streaming tool-loop is deliberately
  *not* reused here: the sub-agent already has its own loop and capability
  allow-list, so layering a second tool-calling loop underneath would duplicate
  control flow and bypass the executor's security checks.
- **Decoupling.** The adapter depends only on a tiny structural
  :class:`StructuredLLM` protocol, so the runtime package stays free of a hard
  top-level ``app.*`` import and the LLM is trivially stubbable in tests. The
  concrete :class:`HubLLMClient` is imported lazily and only when no client is
  injected.
- **Strict-schema friendliness.** llmhubs renders the response model through
  ``to_strict_json_schema`` (every property required, ``additionalProperties:
  false``). A free-form ``dict`` argument field would therefore collapse to "no
  properties allowed", so capability arguments travel as a JSON *string*
  (``arguments_json``) that we parse back into a dict.
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel, Field

from .loop import (
    AgentAction,
    AgentContent,
    AgentModelState,
    AgentModelTurn,
    AgentToolDescriptor,
    CapabilityCall,
    Observation,
    FinalAnswer,
    InvalidAction,
    TokenUsage,
)
from ..capabilities.ids import normalize_capability_id

logger = logging.getLogger(__name__)

_T = TypeVar("_T", bound=BaseModel)

# Keep rendered observations from ballooning the prompt; the loop only needs the
# gist of each prior step to choose the next one.
_MAX_HISTORY = 12
_MAX_CONTENT_CHARS = 600

_SYSTEM_PREAMBLE = (
    "You are a focused sub-agent. You accomplish ONE task by calling a fixed "
    "allow-list of capabilities, at most one per step, and then reporting a "
    "final answer. You may ONLY call capabilities listed under 'Capabilities'; "
    "never invent or guess a capability name. Prefer the fewest steps and finish "
    "as soon as the task is satisfied or cannot make further progress."
)

_DECISION_INSTRUCTIONS = (
    "Decide the single next action and reply with the structured schema:\n"
    '- To call a capability: set action="call_capability", capability to an '
    "EXACT name from the allow-list, and arguments_json to a JSON object string "
    'of its arguments (use "{}" when there are none). Leave summary and output '
    "empty.\n"
    '- To finish: set action="final_answer", summary to a concise result for '
    "the caller, and optionally output to the full detailed result. Leave "
    'capability empty and arguments_json as "{}".'
)


class StructuredLLM(Protocol):
    """Minimal structural view of a structured-output LLM client.

    Implemented by :class:`app.llmhubs.structured.HubLLMClient`; declared locally so
    the runtime never imports the concrete client at module load and tests can
    inject a deterministic stub.
    """

    async def complete_structured_result(
        self,
        response_model: type[_T],
        *,
        prompt: str | None = ...,
        content_blocks: list[dict[str, Any]] | None = ...,
        **kwargs: Any,
    ) -> Any: ...


class _Decision(BaseModel):
    """Strict-schema-friendly projection of one sub-agent decision.

    Flat by necessity: llmhubs marks every property required and forbids
    additional properties, so a discriminated union or a free-form ``dict`` arg
    cannot survive ``to_strict_json_schema``. Unused fields are filled with empty
    sentinels (``""`` / ``"{}"``) per the action.
    """

    action: str = Field(description='Either "call_capability" or "final_answer".')
    capability: str = Field(default="", description="Exact allow-listed capability name to call.")
    arguments_json: str = Field(default="{}", description="JSON object string of capability arguments.")
    summary: str = Field(default="", description="Concise final result (final_answer only).")
    output: str = Field(default="", description="Optional detailed final output (final_answer only).")


class HubSubAgentLLM:
    """Concrete :class:`AgentModel` over the llmhubs structured-output client.

    Parameters
    ----------
    model:
        Optional llmhubs model key. ``None`` defers to the client's default model.
    client:
        Optional injected structured-output client (primarily for tests). When
        omitted a :class:`app.llmhubs.structured.HubLLMClient` is built lazily.
    temperature:
        Optional sampling temperature forwarded to the client when set.
    """

    def __init__(
        self,
        *,
        model: str | None = None,
        client: StructuredLLM | None = None,
        temperature: float | None = None,
    ) -> None:
        self._model = model
        self._temperature = temperature
        self._client = client

    async def complete_turn(self, state: AgentModelState) -> AgentModelTurn:
        client = self._ensure_client()
        prompt = _build_prompt(state)
        kwargs: dict[str, Any] = {}
        if self._temperature is not None:
            kwargs["temperature"] = self._temperature
        content_blocks = _multimodal_content(state, prompt)
        completion = await client.complete_structured_result(
            _Decision,
            **({"content_blocks": content_blocks} if len(content_blocks) > 1 else {"prompt": prompt}),
            **kwargs,
        )
        usage = completion.usage
        trace = completion.trace
        action = _to_action(completion.value)
        if isinstance(action, CapabilityCall):
            action = replace(action, capability=normalize_capability_id(action.capability))
        return AgentModelTurn(
            action=action,
            usage=TokenUsage(
                input_tokens=usage.prompt_tokens,
                output_tokens=usage.completion_tokens,
                total_tokens=usage.total_tokens,
            ),
            model=trace.model or self._model or "",
            latency_ms=trace.latency_ms,
        )

    async def next_action(self, state: AgentModelState) -> AgentAction:
        """Compatibility shim for callers migrating to :meth:`complete_turn`."""
        return (await self.complete_turn(state)).action

    def _ensure_client(self) -> StructuredLLM:
        if self._client is None:
            from app.llmhubs.structured import HubLLMClient

            self._client = HubLLMClient() if self._model is None else HubLLMClient(model=self._model)
        return self._client


class _ArgumentsDecodeError(ValueError):
    """``arguments_json`` was neither valid JSON nor a JSON object."""


def _to_action(decision: _Decision) -> AgentAction:
    """Map a validated :class:`_Decision` onto the executor's action union.

    Only the two documented verbs are honoured. Treating an unrecognised one as
    a call would let a garbled reply trigger a side effect the model never asked
    for — the allow-list bounds *which* capability runs, not *whether* one
    should have.
    """
    action = decision.action.strip().lower()
    if action == "final_answer":
        return FinalAnswer(summary=decision.summary.strip(), output=decision.output)
    capability = decision.capability.strip()
    if action != "call_capability":
        return InvalidAction(
            reason=f'action must be "call_capability" or "final_answer", got {decision.action!r}',
            capability=capability,
        )
    try:
        args = _parse_arguments(decision.arguments_json)
    except _ArgumentsDecodeError as exc:
        return InvalidAction(reason=str(exc), capability=capability)
    return CapabilityCall(capability=capability, args=args)


def _parse_arguments(arguments_json: str) -> dict[str, object]:
    """Parse the JSON-string arguments, raising on anything that is not an object.

    Coercing a malformed payload to ``{}`` used to hide the mistake: the model
    saw a normal (if unhelpful) capability failure and happily repeated the same
    broken reply. Raising here lets the caller feed the *decoding* error back.
    """
    text = (arguments_json or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError) as exc:
        logger.warning("sub-agent returned non-JSON arguments_json")
        raise _ArgumentsDecodeError(f"arguments_json is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        logger.warning("sub-agent arguments_json was not a JSON object")
        raise _ArgumentsDecodeError(
            f"arguments_json must be a JSON object, got {type(parsed).__name__}",
        )
    return parsed


def _build_prompt(state: AgentModelState) -> str:
    """Render the full decision prompt from the current loop state (pure)."""
    preamble = state.system_prompt if state.system_prompt else _SYSTEM_PREAMBLE
    sections = [
        preamble,
        f"Task: {state.task.title}",
    ]
    instructions = state.task.instructions.strip()
    if instructions:
        sections.append(f"Instructions:\n{instructions}")
    if state.task.arguments:
        sections.append(f"Task arguments (JSON):\n{json.dumps(state.task.arguments, ensure_ascii=False)}")
    if state.context:
        sections.append(_render_context(state))
    sections.append(_render_capabilities(state.tools))
    sections.append(_render_history(list(state.history)))
    sections.append(f"Step {state.turn} of {state.max_model_turns}.")
    sections.append(_DECISION_INSTRUCTIONS)
    return "\n\n".join(section for section in sections if section)


def _render_context(state: AgentModelState) -> str:
    sections = ["Additional context:"]
    for block in state.context:
        label = f" [{block.title}]" if block.title else ""
        sections.append(f"<{block.source}{label}>\n{block.content}\n</{block.source}>")
        sections.extend(_render_content_reference(content) for content in block.contents if content.type != "image")
    return "\n".join(sections)


def _render_content_reference(content: AgentContent) -> str:
    if content.type == "text":
        return content.text
    if content.type == "json":
        return content.text
    return f"[{content.type}: {content.uri}]"


def _multimodal_content(state: AgentModelState, prompt: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    media = [content for block in state.context for content in block.contents]
    media.extend(content for observation in state.history for content in observation.contents)
    for content in media:
        if content.type == "image" and content.uri:
            blocks.append({"type": "image_url", "image_url": {"url": content.uri}})
    return blocks


def _render_capabilities(tools: tuple[AgentToolDescriptor, ...]) -> str:
    if not tools:
        return (
            "Capabilities: none are available to call. You can only report a final_answer describing why the task cannot proceed."
        )
    lines = ["Capabilities (call ONLY these, by exact name):"]
    for tool in tools:
        lines.append(_render_one_capability(tool))
    return "\n".join(lines)


def _render_one_capability(tool: AgentToolDescriptor) -> str:
    parts = [f"- {tool.tool_id}"]
    if tool.description.strip():
        parts.append(f": {tool.description.strip()}")
    if tool.parameter_schema:
        parts.append(f" (parameters: {json.dumps(tool.parameter_schema, ensure_ascii=False, sort_keys=True)})")
    return "".join(parts)


def _render_history(history: list[Observation]) -> str:
    if not history:
        return "History: none yet; this is the first step."
    recent = history[-_MAX_HISTORY:]
    lines = ["History (most recent last):"]
    start = len(history) - len(recent) + 1
    for offset, observation in enumerate(recent):
        lines.extend(_render_observation(start + offset, observation))
    return "\n".join(lines)


def _render_observation(index: int, observation: Observation) -> list[str]:
    """Render one observation as a headline plus optional structured detail lines.

    Values the next step may need (error class, artifact paths) are kept as their
    own labelled lines instead of being folded into prose, so the model can hand
    them off verbatim.
    """
    verdict = "ok" if observation.ok else f"FAILED[{observation.status or 'unknown'}]"
    lines = [f"[{index}] {observation.capability or '(no capability)'} -> {verdict}: {_truncate(observation.content)}"]
    if not observation.ok and observation.error_class:
        lines.append(f"      error_class: {observation.error_class}")
    if not observation.ok and observation.error_message and observation.error_message != observation.content:
        lines.append(f"      error: {_truncate(observation.error_message)}")
    if observation.artifacts:
        lines.append(f"      artifacts: {', '.join(observation.artifacts)}")
    return lines


def _truncate(text: str) -> str:
    text = text or ""
    if len(text) <= _MAX_CONTENT_CHARS:
        return text
    return text[:_MAX_CONTENT_CHARS] + "...(truncated)"
