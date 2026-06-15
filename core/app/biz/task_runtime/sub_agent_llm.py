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

"""Production :class:`SubAgentLLM` backed by the llmhubs structured-output layer.

The sub-agent executor (:mod:`.executors.sub_agent`) owns the control loop,
budget and allow-list *enforcement*; the one thing it cannot do deterministically
is *decide the next action*. That decision is this module's sole job: turn the
current :class:`SubAgentState` into one structured choice: call a capability or
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
from typing import TYPE_CHECKING, Any, Protocol, TypeVar

from pydantic import BaseModel, Field

from .executors.sub_agent import CapabilityCall, FinalAnswer, SubAgentAction, SubAgentState
from .tool_catalog import runtime_tool_usage

if TYPE_CHECKING:
    from .skill_loader import SkillLoader

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

    async def complete_structured(
        self,
        response_model: type[_T],
        *,
        prompt: str | None = ...,
        **kwargs: Any,
    ) -> _T: ...


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
    """Concrete :class:`SubAgentLLM` over the llmhubs structured-output client.

    Parameters
    ----------
    model:
        Optional llmhubs model key. ``None`` defers to the client's default model.
    skill_loader:
        Optional skill loader used to enrich the capability allow-list with human
        descriptions/parameters in the prompt. Lookups are best-effort: builtin
        tools (bare names) and unknown skills simply render as their name.
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
        skill_loader: SkillLoader | None = None,
        client: StructuredLLM | None = None,
        temperature: float | None = None,
    ) -> None:
        self._model = model
        self._skill_loader = skill_loader
        self._temperature = temperature
        self._client = client

    async def next_action(self, state: SubAgentState) -> SubAgentAction:
        client = self._ensure_client()
        prompt = _build_prompt(state, self._skill_loader)
        kwargs: dict[str, Any] = {}
        if self._temperature is not None:
            kwargs["temperature"] = self._temperature
        decision = await client.complete_structured(_Decision, prompt=prompt, **kwargs)
        return _to_action(decision)

    def _ensure_client(self) -> StructuredLLM:
        if self._client is None:
            from app.llmhubs.structured import HubLLMClient

            self._client = HubLLMClient() if self._model is None else HubLLMClient(model=self._model)
        return self._client


def _to_action(decision: _Decision) -> SubAgentAction:
    """Map a validated :class:`_Decision` onto the executor's action union.

    Anything that is not an explicit ``final_answer`` is treated as a capability
    call: the executor independently enforces the allow-list, so a malformed or
    empty capability deterministically fails the run rather than being trusted.
    """
    if decision.action.strip().lower() == "final_answer":
        return FinalAnswer(summary=decision.summary.strip(), output=decision.output)
    return CapabilityCall(capability=decision.capability.strip(), args=_parse_arguments(decision.arguments_json))


def _parse_arguments(arguments_json: str) -> dict[str, object]:
    """Parse the JSON-string arguments leniently.

    A malformed or non-object payload yields ``{}``; the capability invocation
    then surfaces the missing arguments as a normal failed observation, which is
    more useful to the loop than raising here.
    """
    text = (arguments_json or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        logger.warning("sub-agent returned non-JSON arguments_json; coercing to {}")
        return {}
    if not isinstance(parsed, dict):
        logger.warning("sub-agent arguments_json was not a JSON object; coercing to {}")
        return {}
    return parsed


def _build_prompt(state: SubAgentState, skill_loader: SkillLoader | None) -> str:
    """Render the full decision prompt from the current loop state (pure)."""
    spec = state.run.spec
    sections = [
        _SYSTEM_PREAMBLE,
        f"Task: {spec.title}",
    ]
    instructions = spec.instructions.strip()
    if instructions:
        sections.append(f"Instructions:\n{instructions}")
    if spec.args:
        sections.append(f"Task arguments (JSON):\n{json.dumps(spec.args, ensure_ascii=False)}")
    sections.append(_render_capabilities(state.capabilities, skill_loader))
    sections.append(_render_history(state.history))
    sections.append(f"Step {state.step} of {state.max_steps}.")
    sections.append(_DECISION_INSTRUCTIONS)
    return "\n\n".join(section for section in sections if section)


def _render_capabilities(capabilities: tuple[str, ...], skill_loader: SkillLoader | None) -> str:
    if not capabilities:
        return (
            "Capabilities: none are available to call. You can only report a final_answer describing why the task cannot proceed."
        )
    lines = ["Capabilities (call ONLY these, by exact name):"]
    for name in capabilities:
        lines.append(_render_one_capability(name, skill_loader))
    return "\n".join(lines)


def _render_one_capability(name: str, skill_loader: SkillLoader | None) -> str:
    card = None
    if skill_loader is not None:
        try:
            card = skill_loader.resolve(name)
        except Exception:  # noqa: BLE001 - description enrichment must never break the loop
            logger.debug("capability card lookup failed for %r", name, exc_info=True)
    if card is None:
        # Builtin tools (bare names) have no skill card; fall back to their
        # catalogue usage so the sub-agent learns the args + directory contract.
        usage = runtime_tool_usage(name)
        return f"- {name}: {usage}" if usage else f"- {name}"
    description = (card.action_description or card.description or "").strip()
    parts = [f"- {name}"]
    if description:
        parts.append(f": {description}")
    if card.parameters:
        parts.append(f" (parameters: {json.dumps(card.parameters, ensure_ascii=False)})")
    return "".join(parts)


def _render_history(history: list) -> str:
    if not history:
        return "History: none yet; this is the first step."
    recent = history[-_MAX_HISTORY:]
    lines = ["History (most recent last):"]
    start = len(history) - len(recent) + 1
    for offset, observation in enumerate(recent):
        verdict = "ok" if observation.ok else "FAILED"
        content = _truncate(observation.content)
        lines.append(f"[{start + offset}] {observation.capability} -> {verdict}: {content}")
    return "\n".join(lines)


def _truncate(text: str) -> str:
    text = text or ""
    if len(text) <= _MAX_CONTENT_CHARS:
        return text
    return text[:_MAX_CONTENT_CHARS] + "...(truncated)"
