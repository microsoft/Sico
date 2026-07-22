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

"""End-to-end rendering contract for ``ExperienceRunner.learn_from_trajectory``.

Given a fixed ``TrajectoryData``, capture what the Reflector and Curator
actually receive. Each assertion pins one input slot of the prompt pipeline.
A change to ``TrajectoryData`` rendering, the runner's argument wiring, or
the Curator's question-context string will fail this test and name the slot
that moved.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.experiences.playbook import DeltaBatch, Playbook
from app.experiences.runner import ExperienceRunner, TrajectoryData, TrajectoryStep


def _make_trajectory() -> TrajectoryData:
    return TrajectoryData(
        task="log into the app",
        success=True,
        total_steps=2,
        chronological_steps=[
            TrajectoryStep(
                step_number=1,
                thought={
                    "thinking": "tap the login button",
                    "next_goal": "enter password",
                },
                actions=[
                    {
                        "action_type": "tap",
                        "parameters": {"x": 100, "y": 200},
                        "conclusion": "expect login dialog",
                    }
                ],
                results=[{"outcome": "success", "what_happened": "login dialog appeared"}],
                state={"progress": "1 of 2 steps complete"},
            ),
            TrajectoryStep(
                step_number=2,
                thought={"thinking": "type the password"},
                actions=[{"action_type": "type", "parameters": {"text": "secret"}}],
                results=[{"outcome": "success", "what_happened": "password entered"}],
                state={"progress": "done"},
            ),
        ],
        final_output="all steps succeeded",
        error=None,
        duration_seconds=12.5,
        agent_type="android-tester",
        metadata={"skill_name": "android-tester", "attempt": 1},
    )


def _build_runner() -> tuple[ExperienceRunner, dict[str, Any]]:
    """Return a runner whose Reflector / Curator capture their call args.

    ``captured`` accumulates the kwargs each role was invoked with. The runner
    uses a real ``Playbook`` so ``apply_delta`` runs against a normal state
    container; no network or LLM calls happen.
    """
    captured: dict[str, Any] = {"reflect": None, "curate": None, "apply_delta_called": 0}

    # ExperienceRunner falls back to ``HubLLMClient()`` when ``llm`` is None,
    # which would try to construct a real LLM client. A bare object is enough
    # because the Reflector / Curator methods are monkey-patched below.
    runner = ExperienceRunner(llm=object(), playbook=Playbook())

    async def fake_reflect(**kwargs: Any) -> Any:
        captured["reflect"] = kwargs
        return SimpleNamespace(reasoning="fake reflection", reflection="ok")

    async def fake_curate(**kwargs: Any) -> Any:
        captured["curate"] = kwargs
        return SimpleNamespace(delta=DeltaBatch(reasoning="fake curator", operations=[]))

    original_apply = runner.playbook.apply_delta

    def counting_apply(delta: DeltaBatch) -> None:
        captured["apply_delta_called"] += 1
        original_apply(delta)

    runner.reflector.reflect = fake_reflect  # type: ignore[method-assign]
    runner.curator.curate = fake_curate  # type: ignore[method-assign]
    runner.playbook.apply_delta = counting_apply  # type: ignore[method-assign]

    return runner, captured


@pytest.mark.asyncio
async def test_rendering_contract_pins_each_input_slot() -> None:
    trajectory = _make_trajectory()
    runner, captured = _build_runner()

    await runner.learn_from_trajectory(trajectory)

    reflect_kwargs = captured["reflect"]
    curate_kwargs = captured["curate"]
    assert reflect_kwargs is not None, "reflector.reflect was not called"
    assert curate_kwargs is not None, "curator.curate was not called"

    # ── reflector.reflect ────────────────────────────────────────────────
    # task arrives via ``question`` (not embedded in reasoning).
    assert reflect_kwargs["question"] == trajectory.task

    gen = reflect_kwargs["generator_output"]
    # reasoning carries the full Markdown trace from build_feedback_string().
    # Field-presence style: pin the structural markers, not the wording.
    assert "succeeded" in gen.reasoning
    assert "Duration: 12.5s" in gen.reasoning
    assert "Final output: all steps succeeded" in gen.reasoning
    assert "### Step 1" in gen.reasoning
    assert "### Step 2" in gen.reasoning
    assert "#### Action Agent" in gen.reasoning
    assert "#### Reflection Agent" in gen.reasoning
    # Operator info must always reach the Reflector: thought + action name +
    # parameters + conclusion. Parameters are part of the Action line;
    # conclusion/description stays on the Description line.
    assert "tap the login button" in gen.reasoning  # operator.thought
    assert "type the password" in gen.reasoning  # operator.thought
    assert "**Action**: tap {'x': 100, 'y': 200}" in gen.reasoning
    assert "**Action**: type {'text': 'secret'}" in gen.reasoning
    assert "**Description**: expect login dialog" in gen.reasoning

    # Reflector info must reach the Reflector too: outcome + what_happened
    # + progress + next_goal.
    assert "**Outcome**: success" in gen.reasoning  # reflector.outcome
    assert "login dialog appeared" in gen.reasoning  # reflector.what_happened
    assert "password entered" in gen.reasoning  # reflector.what_happened
    assert "1 of 2 steps complete" in gen.reasoning  # state.progress
    assert "done" in gen.reasoning  # state.progress
    assert "enter password" in gen.reasoning  # thought.next_goal

    # final_answer is the model prediction text (no judge_result → final_output).
    assert gen.final_answer == trajectory.final_output

    # raw["trace"] is the framework-debug dump (TrajectoryData.to_dict()).
    assert gen.raw["trace"]["task"] == trajectory.task
    assert gen.raw["trace"]["total_steps"] == trajectory.total_steps
    assert gen.raw["success"] is True
    assert gen.raw["metadata"] == trajectory.metadata

    # ``feedback`` slot carries the concise environment summary; distinct
    # from ``reasoning`` even though both encode the success/step/duration.
    assert "succeeded" in reflect_kwargs["feedback"]
    assert "2 steps" in reflect_kwargs["feedback"]

    # Screenshots are empty when use_screenshots is False.
    assert reflect_kwargs["screenshots"] == []

    # ── curator.curate ───────────────────────────────────────────────────
    # question_context is a flattened key/value string of trajectory fields.
    ctx = curate_kwargs["question_context"]
    assert "task:" in ctx
    assert trajectory.task in ctx
    assert "feedback:" in ctx
    assert "success:" in ctx
    assert "steps:" in ctx
    assert "duration:" in ctx
    assert "12.5" in ctx

    # ── playbook ─────────────────────────────────────────────────────────
    assert captured["apply_delta_called"] == 1


@pytest.mark.asyncio
async def test_missing_reflector_renders_none_fields() -> None:
    """When a step has no reflector data, the reflection slots render as
    ``None`` — not a fabricated FAILED label.

    Some DW configurations skip the reflector pass; the parser then emits a
    step with ``results=[]`` and no ``state["progress"]`` / no
    ``thought["next_goal"]``. The renderer's per-slot ``_display_text`` turns
    empty strings into the literal ``None`` so the Reflector reads a clear
    "no data" rather than an incorrect outcome.
    """
    trajectory = TrajectoryData(
        task="single-step probe",
        success=False,
        total_steps=1,
        chronological_steps=[
            TrajectoryStep(
                step_number=1,
                thought={"thinking": "tap something"},
                actions=[{"action_type": "tap", "parameters": {"x": 1, "y": 1}}],
                results=[],
                state={},
            ),
        ],
        final_output="",
        error=None,
        duration_seconds=0.0,
        agent_type="android-tester",
        metadata={"skill_name": "android-tester", "attempt": 1},
    )
    runner, captured = _build_runner()

    await runner.learn_from_trajectory(trajectory)
    reasoning = captured["reflect"]["generator_output"].reasoning

    # Operator info is still rendered.
    assert "tap something" in reasoning
    assert "**Action**: tap {'x': 1, 'y': 1}" in reasoning

    # Every reflection slot renders as None when the source data is absent.
    assert "**Outcome**: None" in reasoning
    assert "**What Happened**: None" in reasoning
    assert "**Progress**: None" in reasoning
    assert "**Next Goal**: None" in reasoning

    # No fabricated outcome label leaks through.
    assert "**Outcome**: FAILED" not in reasoning
    assert "**Outcome**: SUCCESS" not in reasoning


@pytest.mark.asyncio
async def test_failed_trajectory_uses_error_as_model_prediction() -> None:
    trajectory = TrajectoryData(
        task="paste exact URL",
        success=False,
        total_steps=1,
        chronological_steps=[
            TrajectoryStep(
                step_number=1,
                thought={"thinking": "clipboard is wrong"},
                actions=[{"action_type": "Finished", "parameters": {"verdict": "blocker"}}],
                results=[],
                state={},
            )
        ],
        final_output="",
        error="Clipboard precondition failed",
        duration_seconds=1.0,
        agent_type="android-tester",
        metadata={"skill_name": "android-tester"},
    )
    runner, captured = _build_runner()

    await runner.learn_from_trajectory(trajectory)

    gen = captured["reflect"]["generator_output"]
    assert gen.final_answer == "Clipboard precondition failed"
    assert "Error: Clipboard precondition failed" in gen.reasoning
    assert "Final output: Clipboard precondition failed" not in gen.reasoning


@pytest.mark.asyncio
async def test_blocked_status_renders_as_status_not_error() -> None:
    trajectory = TrajectoryData(
        task="paste exact URL",
        success=False,
        total_steps=1,
        chronological_steps=[
            TrajectoryStep(
                step_number=1,
                actions=[{"action_type": "Finished", "parameters": {"verdict": "blocker"}}],
            )
        ],
        final_output="Clipboard precondition failed",
        error=None,
        duration_seconds=1.0,
        agent_type="android-tester",
        metadata={"skill_name": "android-tester", "status": "blocked"},
    )
    runner, captured = _build_runner()

    await runner.learn_from_trajectory(trajectory)

    gen = captured["reflect"]["generator_output"]
    assert gen.final_answer == "Clipboard precondition failed"
    assert "Task blocked in 1 steps" in gen.reasoning
    assert "Final output: Clipboard precondition failed" in gen.reasoning
    assert "Error: Clipboard precondition failed" not in gen.reasoning


@pytest.mark.asyncio
async def test_multiple_actions_per_step_all_rendered() -> None:
    """A step with multiple ``actions`` should not silently lose the tail.

    ``TrajectoryStep.actions`` is typed as ``list``; new DW parsers may emit
    several actions per step. The renderer must surface every action_type so
    the Reflector sees the full operator behavior.
    """
    trajectory = TrajectoryData(
        task="compound step",
        success=True,
        total_steps=1,
        chronological_steps=[
            TrajectoryStep(
                step_number=1,
                thought={"thinking": "two ops at once"},
                actions=[
                    {"action_type": "tap", "parameters": {"x": 1, "y": 1}},
                    {"action_type": "swipe", "parameters": {"dir": "up"}},
                ],
                results=[{"outcome": "success", "what_happened": "both ran"}],
                state={},
            ),
        ],
        final_output="ok",
        error=None,
        duration_seconds=0.0,
        agent_type="custom",
        metadata={},
    )
    runner, captured = _build_runner()

    await runner.learn_from_trajectory(trajectory)
    reasoning = captured["reflect"]["generator_output"].reasoning

    # Both actions include their parameters in the rendered Action line,
    # separated by "; " so the multi-action boundary is preserved.
    assert "tap {'x': 1, 'y': 1}; swipe {'dir': 'up'}" in reasoning


@pytest.mark.asyncio
async def test_multiple_results_per_step_all_rendered() -> None:
    """A step with multiple ``results`` should not silently lose the tail.

    Symmetric to ``test_multiple_actions_per_step_all_rendered``: the
    reflection-agent renderer must aggregate every result, separated by
    "; " so the boundary stays visible.
    """
    trajectory = TrajectoryData(
        task="compound step",
        success=True,
        total_steps=1,
        chronological_steps=[
            TrajectoryStep(
                step_number=1,
                thought={"thinking": "two observations"},
                actions=[{"action_type": "tap", "parameters": {"x": 1, "y": 1}}],
                results=[
                    {"outcome": "success", "what_happened": "tap landed"},
                    {"outcome": "partial", "what_happened": "secondary check timed out"},
                ],
                state={"progress": "1/1"},
            ),
        ],
        final_output="ok",
        error=None,
        duration_seconds=0.0,
        agent_type="custom",
        metadata={},
    )
    runner, captured = _build_runner()

    await runner.learn_from_trajectory(trajectory)
    reasoning = captured["reflect"]["generator_output"].reasoning

    # Both outcomes appear in the Outcome line, "; "-separated.
    assert "success; partial" in reasoning
    # Both observation strings appear in the What Happened line, also "; ".
    assert "tap landed; secondary check timed out" in reasoning


@pytest.mark.asyncio
async def test_raw_trace_route_rendering_contract() -> None:
    """A DW with no structured steps feeds its raw stdout to the Reflector.

    The text route renders the verbatim execution log instead of an empty
    8-slot skeleton, and carries none of the structured Action/Reflection
    scaffolding. This pins what the Reflector receives for any DW that does not
    emit per-step agent-loop events.
    """
    trajectory = TrajectoryData(
        task="run the data pipeline",
        success=False,
        total_steps=0,
        chronological_steps=[],
        raw_trace="step A: loaded 10 rows\nstep B: wrote out.csv\npipeline done",
        final_output="",
        error=None,
        duration_seconds=0.0,
        agent_type="data-pipeline",
        metadata={"skill_name": "data-pipeline", "status": "unknown"},
    )
    runner, captured = _build_runner()

    await runner.learn_from_trajectory(trajectory)
    reflect_kwargs = captured["reflect"]
    reasoning = reflect_kwargs["generator_output"].reasoning

    # task still arrives via question, not embedded in the trace.
    assert reflect_kwargs["question"] == "run the data pipeline"

    # The raw execution log is fed verbatim under its own header.
    assert "## Execution Log (raw)" in reasoning
    assert "step A: loaded 10 rows" in reasoning
    assert "step B: wrote out.csv" in reasoning
    assert "pipeline done" in reasoning

    # The status header reflects the undeclared outcome (no fabricated verdict).
    # No structured steps -> no misleading "in 0 steps" count.
    assert "Task unknown" in reasoning
    assert "in 0 steps" not in reasoning
    assert reflect_kwargs["generator_output"].final_answer == ""

    # None of the structured slot scaffolding leaks into the text route.
    assert "## Execution Trace" not in reasoning
    assert "#### Action Agent" not in reasoning
    assert "#### Reflection Agent" not in reasoning
    assert "Trace Explanation" not in reasoning

    # The concise environment feedback carries the same status.
    assert "unknown" in reflect_kwargs["feedback"]
