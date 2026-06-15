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

"""Unit tests for the production sub-agent LLM adapter.

The adapter's job is purely translation: build a decision prompt from the loop
state and map the model's structured reply onto the executor's action union. The
LLM itself is stubbed, so these tests stay deterministic and never touch
llmhubs."""

from __future__ import annotations

import time
from typing import Any

import pytest
from pydantic import BaseModel

from app.biz.task_runtime.executors.sub_agent import (
    CapabilityCall,
    FinalAnswer,
    Observation,
    SubAgentState,
)
from app.biz.task_runtime.models import (
    SubAgentDispatch,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
)
from app.biz.task_runtime.sub_agent_llm import (
    HubSubAgentLLM,
    _build_prompt,
    _Decision,
    _to_action,
)


def _state(
    *,
    capabilities: tuple[str, ...] = ("echo",),
    title: str = "Rewrite and run TC-001",
    instructions: str = "Rewrite the testcase then execute it.",
    args: dict[str, Any] | None = None,
    history: list[Observation] | None = None,
    step: int = 1,
    max_steps: int = 8,
) -> SubAgentState:
    spec = TaskSpec(
        task_id="t-sub",
        title=title,
        instructions=instructions,
        args=args or {},
        dispatch=SubAgentDispatch(capabilities=list(capabilities)),
    )
    run = TaskRun(
        run_id="run-t-sub",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key=spec.task_id,
        executor="in_process",
        queued_at=int(time.time() * 1000),
    )
    return SubAgentState(
        run=run,
        capabilities=capabilities,
        step=step,
        max_steps=max_steps,
        history=history or [],
    )


class _FakeClient:
    """Records the prompt and returns a pre-baked decision payload."""

    def __init__(self, decision: _Decision) -> None:
        self._decision = decision
        self.prompt: str | None = None
        self.kwargs: dict[str, Any] = {}

    async def complete_structured(self, response_model: type[BaseModel], *, prompt: str | None = None, **kwargs: Any):
        self.prompt = prompt
        self.kwargs = kwargs
        assert response_model is _Decision
        return self._decision


# ---------------------------------------------------------------------------
# _to_action
# ---------------------------------------------------------------------------
def test_to_action_maps_final_answer() -> None:
    action = _to_action(_Decision(action="final_answer", summary="done", output="full output"))
    assert action == FinalAnswer(summary="done", output="full output")


def test_to_action_maps_capability_call_and_parses_arguments() -> None:
    decision = _Decision(action="call_capability", capability="echo", arguments_json='{"text": "hi"}')
    action = _to_action(decision)
    assert action == CapabilityCall(capability="echo", args={"text": "hi"})


def test_to_action_coerces_invalid_json_arguments_to_empty() -> None:
    decision = _Decision(action="call_capability", capability="echo", arguments_json="not json")
    assert _to_action(decision) == CapabilityCall(capability="echo", args={})


def test_to_action_coerces_non_object_arguments_to_empty() -> None:
    decision = _Decision(action="call_capability", capability="echo", arguments_json="[1, 2, 3]")
    assert _to_action(decision) == CapabilityCall(capability="echo", args={})


def test_to_action_treats_unknown_action_as_capability_call() -> None:
    # Anything that is not an explicit final_answer is a capability call; the
    # executor independently enforces the allow-list.
    decision = _Decision(action="", capability="run_command", arguments_json="{}")
    assert _to_action(decision) == CapabilityCall(capability="run_command", args={})


# ---------------------------------------------------------------------------
# _build_prompt
# ---------------------------------------------------------------------------
def test_build_prompt_includes_task_capabilities_and_budget() -> None:
    prompt = _build_prompt(_state(capabilities=("echo", "run_testcase.execute")), skill_loader=None)
    assert "Rewrite and run TC-001" in prompt
    assert "Rewrite the testcase then execute it." in prompt
    assert "- echo" in prompt
    assert "- run_testcase.execute" in prompt
    assert "Step 1 of 8." in prompt
    assert "History: none yet" in prompt


def test_build_prompt_enriches_builtin_run_command_usage() -> None:
    # Builtin tools have no skill card, but the prompt should still teach the
    # sub-agent the run_command arguments + workspace/result directory contract.
    prompt = _build_prompt(_state(capabilities=("run_command",)), skill_loader=None)
    assert "- run_command: " in prompt
    assert "args.command" in prompt
    assert "$SICO_WORKSPACE_DIR" in prompt
    assert "$SICO_RESULT_DIR" in prompt


def test_build_prompt_renders_history_with_verdicts() -> None:
    history = [
        Observation(capability="echo", ok=True, content="hello"),
        Observation(capability="run_command", ok=False, content="boom"),
    ]
    prompt = _build_prompt(_state(history=history, step=3), skill_loader=None)
    assert "[1] echo -> ok: hello" in prompt
    assert "[2] run_command -> FAILED: boom" in prompt


def test_build_prompt_empty_capabilities_states_final_only() -> None:
    prompt = _build_prompt(_state(capabilities=()), skill_loader=None)
    assert "Capabilities: none are available" in prompt


def test_build_prompt_includes_task_args_when_present() -> None:
    prompt = _build_prompt(_state(args={"testcase_id": "TC-001"}), skill_loader=None)
    assert "TC-001" in prompt


# ---------------------------------------------------------------------------
# next_action (integration with an injected client)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_next_action_returns_mapped_capability_call() -> None:
    client = _FakeClient(_Decision(action="call_capability", capability="echo", arguments_json='{"text": "hi"}'))
    llm = HubSubAgentLLM(client=client)
    action = await llm.next_action(_state())
    assert action == CapabilityCall(capability="echo", args={"text": "hi"})
    assert client.prompt is not None and "echo" in client.prompt


@pytest.mark.asyncio
async def test_next_action_returns_mapped_final_answer() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="all set"))
    llm = HubSubAgentLLM(client=client)
    assert await llm.next_action(_state()) == FinalAnswer(summary="all set", output="")


@pytest.mark.asyncio
async def test_next_action_forwards_temperature_when_set() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="ok"))
    llm = HubSubAgentLLM(client=client, temperature=0.0)
    await llm.next_action(_state())
    assert client.kwargs == {"temperature": 0.0}


@pytest.mark.asyncio
async def test_next_action_omits_temperature_by_default() -> None:
    client = _FakeClient(_Decision(action="final_answer", summary="ok"))
    llm = HubSubAgentLLM(client=client)
    await llm.next_action(_state())
    assert client.kwargs == {}
