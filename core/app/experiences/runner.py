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

"""
Experience Runner - Entry point for processing trajectory data.

This module provides ExperienceRunner, which enables custom agents to provide
trajectory data and run the Reflector and Curator to learn from it.

The TrajectoryData format captures rich execution traces including:
- Agent thoughts (thinking, evaluation, memory, goals)
- Actions taken (action_type, parameters)
- Results observed (success, errors, extracted content)
- State information (URLs, context)

Usage:
    from app.experiences import ExperienceRunner, TrajectoryData, TrajectoryStep

    # Create runner
    runner = ExperienceRunner()

    # Build trajectory from your agent's execution
    steps = [
        TrajectoryStep(
            step_number=1,
            thought={
                "thinking": "I need to search for flights...",
                "evaluation": "Starting fresh task",
                "memory": "User wants cheapest flight",
                "next_goal": "Search flight comparison sites"
            },
            actions=[{"action_type": "navigate", "parameters": {"url": "https://flights.com"}}],
            results=[{"success": True, "is_done": False, "extracted_content": "Page loaded"}],
            state={"url": "https://flights.com", "context": {}}
        ),
        # ... more steps
    ]

    trajectory = TrajectoryData(
        task="Find the cheapest flight to NYC",
        success=True,
        total_steps=len(steps),
        final_output="Found $199 flight on Delta",
        chronological_steps=steps
    )

    # Learn from the trajectory
    await runner.learn_from_trajectory(trajectory)
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from app.llmhubs.structured import HubLLMClient, LLMClient
from .playbook import Playbook
from .prompts import PromptManager
from .roles import Curator, GeneratorOutput, Reflector, extract_cited_bullet_ids

logger = logging.getLogger(__name__)


def _ordered_screenshot_inputs(steps: list[TrajectoryStep]) -> list[dict[str, Any]]:
    """Build screenshot inputs aligned with chronological trajectory steps."""
    screenshots: list[dict[str, Any]] = []
    for step in sorted(steps, key=lambda item: item.step_number):
        screenshot_url = step.state.get("screenshot")
        if not screenshot_url:
            continue

        mapped_step_number = step.state.get("screenshot_step_number", step.step_number)
        if mapped_step_number != step.step_number:
            logger.warning(
                "Skipping mismatched screenshot mapping for step %s (mapped to %s)",
                step.step_number,
                mapped_step_number,
            )
            continue

        screenshots.append(
            {
                "step_number": step.step_number,
                "url": str(screenshot_url),
                "description": str(step.state.get("screenshot_description", "")).strip(),
            }
        )
    return screenshots


def _step_action_agent(step: TrajectoryStep) -> dict[str, Any]:
    state_value = step.state.get("action_agent")
    if isinstance(state_value, dict):
        return state_value

    # Aggregate every action on the step. Most parsers emit a single action
    # per step but the contract is a list; silently dropping the tail would
    # hide work from the Reflector. Multiple actions are separated by "; "
    # so their boundaries stay visible when parameter payloads are present.
    action_names: list[str] = []
    description_chunks: list[str] = []
    for action in step.actions:
        action_type = action.get("action_type")
        parameters = action.get("parameters")
        conclusion = action.get("conclusion")

        if action_type:
            if parameters is not None:
                action_names.append(f"{action_type} {parameters}")
            else:
                action_names.append(str(action_type))
        elif parameters is not None:
            action_names.append(str(parameters))

        if conclusion:
            description_chunks.append(str(conclusion))

    description = "; ".join(description_chunks)
    if not description and step.state.get("screenshot_description"):
        description = str(step.state["screenshot_description"])

    return {
        "thought": step.thought.get("thinking", "") if step.thought else "",
        "action": "; ".join(action_names),
        "description": description,
    }


def _step_reflection_agent(step: TrajectoryStep) -> dict[str, Any]:
    state_value = step.state.get("reflection_agent")
    if isinstance(state_value, dict):
        return state_value

    # Iterate every result so multi-result steps surface the full reflector
    # text, symmetric to how _step_action_agent handles multi-action steps.
    outcomes: list[str] = []
    what_happened_pieces: list[str] = []
    for result in step.results:
        if result.get("outcome"):
            outcomes.append(str(result["outcome"]))
        elif "success" in result:
            outcomes.append("SUCCESS" if result.get("success") else "FAILED")
        what = result.get("what_happened") or result.get("extracted_content")
        if what:
            what_happened_pieces.append(str(what))

    progress = step.state.get("progress", "")
    next_goal = step.thought.get("next_goal", "") if step.thought else ""

    return {
        "outcome": "; ".join(outcomes),
        "what_happened": "; ".join(what_happened_pieces),
        "progress": progress,
        "next_goal": next_goal,
    }


def _display_text(value: Any) -> str:
    if value in (None, ""):
        return "None"
    return str(value)


def _format_screenshot_line(step_number: int, screenshot_url: Any) -> str:
    """Build a human-readable screenshot line for the trajectory trace."""
    return f"#### Screenshot: {_display_text(screenshot_url)}"


class TrajectoryStep(BaseModel):
    """A single step in the agent's execution trajectory.

    Stable contract for DW parsers. Field shapes the renderer reads:

    - ``thought["thinking"]`` / ``thought["next_goal"]`` — operator-side text.
    - ``actions[i]["action_type"]`` / ``["parameters"]`` / ``["conclusion"]``
      — every action is rendered (the list is not truncated).
    - ``results[i]["outcome"]`` / ``["what_happened"]`` — reflector-side text.
      ``["success"]`` (bool) / ``["extracted_content"]`` are accepted for
      browser-use-style callers.
    - ``state["progress"]`` — reflector progress.

    Parsers may add extra keys; the renderer ignores them. Missing fields
    render as the literal string ``"None"`` in the Reflector-facing text
    rather than fabricated outcomes.
    """

    model_config = {"arbitrary_types_allowed": True}

    step_number: int = Field(description="Sequential step number (1-indexed).")
    thought: dict[str, str] | None = Field(
        default=None,
        description="Agent's thought process (thinking, evaluation, memory, next_goal).",
    )
    actions: list[dict[str, Any]] = Field(
        default_factory=list,
        description="List of actions taken (action_type + parameters).",
    )
    results: list[dict[str, Any]] = Field(
        default_factory=list,
        description="List of action results (success, is_done, error, extracted_content).",
    )
    state: dict[str, Any] = Field(
        default_factory=dict,
        description="Current state info (url, context, etc.).",
    )

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"step_number": self.step_number}
        if self.thought:
            data["thought"] = self.thought
        if self.actions:
            data["actions"] = self.actions
        if self.results:
            data["results"] = self.results
        if self.state:
            data["state"] = self.state
        return data


class TrajectoryData(BaseModel):
    """Rich trajectory data from one DW execution unit.

    Stable contract between DW parsers and the experience-learning pipeline.
    One ``TrajectoryData`` per natural DW unit. Field values are plain text
    where the Reflector reads them; structural identifiers and raw runner
    status (skill_name, run_id, batch_id, task_id, status) live in
    ``metadata``.

    The exact field → Reflector / Curator slot wiring is documented on
    ``ExperienceRunner.learn_from_trajectory`` and pinned by
    ``tests/experiences/test_trajectory_rendering_contract.py``.
    """

    model_config = {"arbitrary_types_allowed": True}

    task: str = Field(description="The original task description.")
    success: bool = Field(default=True, description="Whether the task completed successfully.")
    total_steps: int = Field(default=0, description="Total number of steps executed.")
    chronological_steps: list[TrajectoryStep] = Field(
        default_factory=list,
        description="Chronological list of steps the agent executed.",
    )
    final_output: str = Field(
        default="",
        description="The final output or answer from the agent.",
    )
    error: str | None = Field(
        default=None,
        description="Error message if the task failed; null if successful.",
    )
    duration_seconds: float = Field(default=0.0, description="Total execution time in seconds.")
    agent_type: str = Field(default="custom", description="Identifier for the agent type.")
    all_cited_bullet_ids: list[str] = Field(
        default_factory=list,
        description="List of playbook bullet IDs cited by the agent.",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata about the execution.",
    )
    raw_trace: str = Field(
        default="",
        description="Verbatim execution log used as the Reflector trace when no structured steps exist.",
    )
    judge_result: dict[str, Any] | None = Field(
        default=None,
        description="Judge result from external validator.",
    )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary format."""
        return {
            "task": self.task,
            "success": self.success,
            "error": self.error,
            "total_steps": self.total_steps,
            "duration_seconds": self.duration_seconds,
            "final_output": self.final_output,
            "agent_type": self.agent_type,
            "all_cited_bullet_ids": self.all_cited_bullet_ids,
            "chronological_steps": [s.to_dict() for s in self.chronological_steps],
            "metadata": self.metadata,
            "raw_trace": self.raw_trace,
            "judge_result": self.judge_result,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TrajectoryData:
        """Create TrajectoryData from dictionary."""
        steps = [
            TrajectoryStep(
                step_number=s.get("step_number", i + 1),
                thought=s.get("thought"),
                actions=s.get("actions", []),
                results=s.get("results", []),
                state=s.get("state", {}),
            )
            for i, s in enumerate(data.get("chronological_steps", []))
        ]
        return cls(
            task=data.get("task", ""),
            success=data.get("success", True),
            total_steps=data.get("total_steps", len(steps)),
            chronological_steps=steps,
            final_output=data.get("final_output", ""),
            error=data.get("error"),
            duration_seconds=data.get("duration_seconds", 0.0),
            agent_type=data.get("agent_type", "custom"),
            all_cited_bullet_ids=data.get("all_cited_bullet_ids", []),
            metadata=data.get("metadata", {}),
            raw_trace=data.get("raw_trace", ""),
            judge_result=data.get("judge_result"),
        )

    def build_feedback_string(self) -> str:
        """Build a detailed feedback string for Reflector analysis.

        Returns:
            Formatted string with execution trace in chronological order.
        """
        parts = []

        # Overall status
        status = str(self.metadata.get("status") or ("succeeded" if self.success else "failed"))
        if self.total_steps > 0:
            parts.append(f"Task {status} in {self.total_steps} steps")
        else:
            parts.append(f"Task {status}")

        if self.duration_seconds:
            parts.append(f"Duration: {self.duration_seconds}s")

        if self.final_output:
            parts.append(f"\nFinal output: {self.final_output}")

        if self.error:
            parts.append(f"\nError: {self.error}")

        # Chronological execution trace
        if self.chronological_steps:
            parts.append("\n\n## Execution Trace")

            parts.append("\n> **Trace Explanation**")
            parts.append("> The workflow trajectory is organized into two sub-agents:")
            parts.append("> - **Action Agent**: captures the step thought, chosen action, and action description")
            parts.append("> - **Reflection Agent**: captures the observed outcome, what happened, progress, and next goal")
            parts.append("> Each step also includes the corresponding screenshot for visual context.")

            for step in sorted(self.chronological_steps, key=lambda item: item.step_number):
                action_agent = _step_action_agent(step)
                reflection_agent = _step_reflection_agent(step)

                parts.append(f"\n### Step {step.step_number}")
                parts.append("#### Action Agent")
                parts.append(f"- **Thought**: {_display_text(action_agent.get('thought'))}")
                parts.append(f"- **Action**: {_display_text(action_agent.get('action'))}")
                parts.append(f"- **Description**: {_display_text(action_agent.get('description'))}")

                parts.append("#### Reflection Agent")
                parts.append(f"- **Outcome**: {_display_text(reflection_agent.get('outcome'))}")
                parts.append(f"- **What Happened**: {_display_text(reflection_agent.get('what_happened'))}")
                parts.append(f"- **Progress**: {_display_text(reflection_agent.get('progress'))}")
                parts.append(f"- **Next Goal**: {_display_text(reflection_agent.get('next_goal'))}")

                parts.append(
                    _format_screenshot_line(
                        step.step_number,
                        step.state.get("screenshot"),
                    )
                )

            parts.append("\n## End of Trace")
        elif self.raw_trace:
            # Text route: a DW without recognizable per-step events. Feed the raw
            # execution log to the Reflector verbatim instead of an empty 8-slot
            # skeleton.
            parts.append("\n\n## Execution Log (raw)")
            parts.append(self.raw_trace.strip())
            parts.append("\n## End of Log")

        return "\n".join(parts)

    @staticmethod
    def build_judge_result(verdict: bool, reasoning: str = "") -> dict[str, Any]:
        """Build the judge_result shape consumed by ``format_model_prediction``."""
        return {"verdict": verdict, "reasoning": reasoning}

    def format_model_prediction(self) -> str:
        """Format the model prediction shown to the Reflector.

        Prefer the normalized judge_result representation so logs and prompts stay
        consistent with the experience learning pipeline. Fall back to the raw final_output when no
        structured verdict is available.
        """
        if self.judge_result and "verdict" in self.judge_result:
            verdict = self.judge_result.get("verdict", False)
            verdict_text = "PASS" if verdict else "FAIL"
            reasoning = str(self.judge_result.get("reasoning", "")).strip()
            if reasoning:
                return f"Verdict: {verdict_text}. Reason: {reasoning}"
            return f"Verdict: {verdict_text}."

        return self.final_output or self.error or ""

    def build_environment_feedback(self) -> str:
        """Build concise environment feedback for the Reflector.

        Keep this summary compact. When authoritative ground truth exists via
        judge_result, avoid repeating the same error detail here.
        """
        status = str(self.metadata.get("status") or ("succeeded" if self.success else "failed"))
        feedback = f"Task {status} in {self.total_steps} steps" if self.total_steps > 0 else f"Task {status}"
        if self.duration_seconds:
            feedback += f" ({self.duration_seconds}s)"

        has_authoritative_judge = bool(self.judge_result and "verdict" in self.judge_result)
        if self.error and not has_authoritative_judge:
            feedback += f"\nError: {self.error}"

        return feedback

    def screenshot_inputs(self) -> list[dict[str, Any]]:
        """Expose screenshot inputs that preserve step alignment."""
        return _ordered_screenshot_inputs(self.chronological_steps)


class ExperienceRunner:
    """
    Entry point for processing trajectory data with the experience learning system.

    ExperienceRunner enables custom agents to provide trajectory data and
    automatically run the Reflector and Curator to learn from it.

    Key Features:
    - Rich trajectory data interface with step-by-step execution traces
    - Automatic Reflector + Curator pipeline
    - Playbook persistence
    - Optional consolidation support

    Args:
        llm: LLM client (defaults to llmhubs gpt5.4)
        playbook: Existing playbook to use (creates new if None)
        playbook_path: Path to load playbook from
        consolidation_config: Optional ConsolidationConfig for entry consolidation

    Example:
        >>> from app.experiences import ExperienceRunner, TrajectoryData, TrajectoryStep
        >>>
        >>> runner = ExperienceRunner()
        >>>
        >>> # Build rich trajectory
        >>> trajectory = TrajectoryData(
        ...     task="Search for news",
        ...     success=True,
        ...     total_steps=2,
        ...     chronological_steps=[
        ...         TrajectoryStep(
        ...             step_number=1,
        ...             thought={"thinking": "Need to navigate..."},
        ...             actions=[{"action_type": "navigate", "parameters": {"url": "..."}}],
        ...             results=[{"success": True, "is_done": False}],
        ...         ),
        ...         TrajectoryStep(
        ...             step_number=2,
        ...             thought={"thinking": "Found results..."},
        ...             actions=[{"action_type": "done", "parameters": {"text": "..."}}],
        ...             results=[{"success": True, "is_done": True}],
        ...         ),
        ...     ]
        ... )
        >>>
        >>> await runner.learn_from_trajectory(trajectory)
    """

    def __init__(
            self,
            llm: LLMClient | None = None,
            playbook: Playbook | None = None,
            playbook_path: str | None = None,
            consolidation_config: ConsolidationConfig | None = None,
            use_screenshots: bool = False,
    ):
        """Initialize Experience Runner.

        Args:
            llm: LLM client (defaults to llmhubs gpt5.4)
            playbook: Existing playbook to use (creates new if None)
            playbook_path: Path to load playbook from
            consolidation_config: Optional ConsolidationConfig for entry consolidation
            use_screenshots: Whether Reflector should receive screenshots as multimodal input
        """
        # Initialize LLM
        self.llm = llm or HubLLMClient()
        self.use_screenshots = use_screenshots

        # Load or create playbook
        if playbook_path:
            self.playbook = Playbook.load_from_file(playbook_path)
        elif playbook:
            self.playbook = playbook
        else:
            self.playbook = Playbook()

        # Create experience learning components
        prompt_mgr = PromptManager()
        self.reflector = Reflector(
            self.llm, prompt_template=prompt_mgr.get_reflector_prompt()
        )

        # Wire up EntryConsolidator if config provided
        consolidator = None
        if consolidation_config is not None:
            from .playbook import EntryConsolidator

            consolidator = EntryConsolidator(consolidation_config)

        self.curator = Curator(
            self.llm,
            prompt_template=prompt_mgr.get_curator_prompt(),
            consolidator=consolidator,
        )

        # Track learning progress
        self._trajectories_processed = 0

    async def learn_from_trajectory(
            self,
            trajectory: TrajectoryData,
            progress: str | None = None,
    ) -> dict[str, Any]:
        """Core single-trajectory learning step.

        Renders ``trajectory`` into Reflector / Curator inputs, runs both LLM
        roles, and applies the resulting delta to the in-memory playbook.
        Persistence is the wrapping service layer's job.

        Field -> prompt-slot mapping::

            trajectory.task                        -> reflector(question=...), curator(question_context: "task:")
            trajectory.build_feedback_string()     -> GeneratorOutput.reasoning
            trajectory.format_model_prediction()   -> GeneratorOutput.final_answer
            trajectory.build_environment_feedback() -> reflector(feedback=...), curator(question_context: "feedback:")
            trajectory.to_dict()                   -> GeneratorOutput.raw["trace"]
            trajectory.screenshot_inputs()         -> reflector(screenshots=...)
            trajectory.all_cited_bullet_ids        -> GeneratorOutput.bullet_ids

        ``tests/experiences/test_trajectory_rendering_contract.py`` pins the
        exact wiring; consult it when changing any slot.

        Args:
            trajectory: Rich trajectory data from agent execution.
            progress: Optional progress string (e.g., "5/10 tasks completed").

        Returns:
            Dict with ``reflection``, ``curator_output``, and
            ``operations_applied``.
        """
        self._trajectories_processed += 1

        # Build comprehensive feedback string from trajectory
        feedback = trajectory.build_feedback_string()

        # Use cited bullet IDs from trajectory, or extract from feedback text
        cited_ids = trajectory.all_cited_bullet_ids or extract_cited_bullet_ids(feedback)

        # Filter to only valid bullet IDs
        valid_cited_ids = [
            bid for bid in cited_ids if self.playbook.get_bullet(bid) is not None
        ]

        logger.info("Playbook Cited: all_cited_bullet_ids=%s, valid_cited_ids=%s", cited_ids, valid_cited_ids)

        # Create GeneratorOutput from trajectory
        generator_output = GeneratorOutput(
            reasoning=feedback,  # Full trace with thoughts/actions/results
            final_answer=trajectory.format_model_prediction(),
            bullet_ids=valid_cited_ids,
            raw={
                "success": trajectory.success,
                "total_steps": trajectory.total_steps,
                "duration_seconds": trajectory.duration_seconds,
                "agent_type": trajectory.agent_type,
                "execution_mode": "external",
                "trace": trajectory.to_dict(),
                "metadata": trajectory.metadata,
            },
        )

        # Build concise feedback summary
        feedback_summary = trajectory.build_environment_feedback()

        screenshot_inputs = trajectory.screenshot_inputs() if self.use_screenshots else []

        # Run Reflector
        reflection = await self.reflector.reflect(
            question=trajectory.task,
            generator_output=generator_output,
            playbook=self.playbook,
            ground_truth=None,
            feedback=feedback_summary,
            screenshots=screenshot_inputs,
        )

        # Run Curator
        progress_str = progress or f"Trajectory {self._trajectories_processed}"
        curator_output = await self.curator.curate(
            reflection=reflection,
            playbook=self.playbook,
            question_context=(
                f"task: {trajectory.task}\n"
                f"feedback: {feedback_summary}\n"
                f"success: {trajectory.success}\n"
                f"steps: {trajectory.total_steps}\n"
                f"duration: {trajectory.duration_seconds}s"
            ),
            progress=progress_str,
        )

        # Log Curator output
        if curator_output.delta.reasoning:
            logger.info(f"[Curator] Reasoning: {curator_output.delta.reasoning}")
        logger.info(f"[Curator] Generated {len(curator_output.delta.operations)} operations")
        for i, op in enumerate(curator_output.delta.operations, 1):
            logger.info(
                "  [%s] %s: bullet_id=%s, section=%s, tags=%s, content=%s",
                i,
                op.type,
                op.bullet_id,
                op.section,
                op.metadata,
                op.content,
            )

        # Apply delta to playbook
        self.playbook.apply_delta(curator_output.delta)

        # Ensure embeddings are computed for new bullets
        if self.curator.consolidator is not None:
            self.curator.consolidator.scanner.ensure_embeddings(self.playbook)

        return {
            "reflection": reflection,
            "curator_output": curator_output,
            "operations_applied": len(curator_output.delta.operations),
            "add_operations": sum(1 for op in curator_output.delta.operations if op.type.upper() == "ADD"),
        }


if TYPE_CHECKING:
    from .playbook import ConsolidationConfig

__all__ = ["ExperienceRunner", "TrajectoryData", "TrajectoryStep"]
