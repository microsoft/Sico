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

"""Reflector and Curator components for the experience learning framework."""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import re
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any
from urllib.error import URLError
from urllib.request import urlopen

from pydantic import BaseModel, ConfigDict, Field

from .llm import LLMClient
from .playbook import DeltaBatch, Playbook
from .prompts import PromptManager

_prompt_manager = PromptManager()
REFLECTOR_PROMPT = _prompt_manager.get_reflector_prompt()
CURATOR_PROMPT = _prompt_manager.get_curator_prompt()

if TYPE_CHECKING:
    from .playbook import EntryConsolidator

logger = logging.getLogger(__name__)

STRICT_SCHEMA_CONFIG = ConfigDict(extra="forbid")


def _format_optional(value: str | None) -> str:
    """Format optional value for prompt insertion."""
    return value or "(none)"


def _encode_image_url(url: str) -> str:
    """Convert a remote screenshot URL into a data URI when possible."""
    if url.startswith("data:image/"):
        return url

    with urlopen(url, timeout=20) as response:
        payload = response.read()
        content_type = response.headers.get_content_type()

    media_type = content_type or mimetypes.guess_type(url)[0] or "image/jpeg"
    encoded = base64.b64encode(payload).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


_STEP_HEADER_RE = re.compile(r"^#{1,6}\s*Step\s+(?P<step_number>\d+)\s*$")
_SCREENSHOT_LINE_RE = re.compile(r"^(?P<label>#{1,6}\s*Screenshot:)\s*(?P<value>.*)$")


def _clean_screenshot_line(line: str) -> str:
    """Normalize the visible screenshot line."""
    return line.rstrip()


def _build_screenshot_line(line: str) -> str:
    """Render the screenshot label while the actual image travels in a separate multimodal block."""
    cleaned = _clean_screenshot_line(line)
    match = _SCREENSHOT_LINE_RE.match(cleaned)
    if not match:
        return "#### Screenshot:"
    return match.group("label")


def _resolve_screenshot_step_number(
    line: str,
    current_step_number: int | None,
) -> int | None:
    """Resolve the screenshot step from the current step context."""
    if _SCREENSHOT_LINE_RE.match(line):
        return current_step_number

    return None


def _build_reflector_content_blocks(
    prompt: str,
    screenshots: Sequence[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Build multimodal Reflector input with screenshots inserted at their step positions."""
    screenshot_map: dict[int, str] = {}
    for screenshot in screenshots or []:
        step_number = screenshot.get("step_number")
        image_url = str(screenshot.get("url", "")).strip()
        if not isinstance(step_number, int) or not image_url:
            continue

        screenshot_map[step_number] = image_url

    if not screenshot_map:
        return [{"type": "text", "text": prompt}]

    content_blocks: list[dict[str, Any]] = []
    text_buffer: list[str] = []
    current_step_number: int | None = None
    encoded_screenshot_cache: dict[int, str] = {}

    def flush_text_buffer() -> None:
        if text_buffer:
            content_blocks.append({"type": "text", "text": "\n".join(text_buffer)})
            text_buffer.clear()

    def resolve_image_url(step_number: int) -> str | None:
        image_url = screenshot_map.get(step_number)
        if not image_url:
            return None
        if step_number in encoded_screenshot_cache:
            return encoded_screenshot_cache[step_number]

        try:
            encoded_screenshot_cache[step_number] = _encode_image_url(image_url)
        except (OSError, URLError, ValueError) as exc:
            logger.warning("Failed to encode screenshot for step %s: %s", step_number, exc)
            encoded_screenshot_cache[step_number] = image_url
        return encoded_screenshot_cache[step_number]

    for line in prompt.splitlines():
        step_match = _STEP_HEADER_RE.match(line)
        if step_match:
            current_step_number = int(step_match.group("step_number"))
            text_buffer.append(line)
            continue

        screenshot_step_number = _resolve_screenshot_step_number(line, current_step_number)
        if screenshot_step_number is not None:
            resolved_image_url = resolve_image_url(screenshot_step_number)
            if resolved_image_url:
                flush_text_buffer()
                content_blocks.append({"type": "text", "text": _build_screenshot_line(line)})
                content_blocks.append({"type": "image_url", "image_url": {"url": resolved_image_url}})
                continue

            text_buffer.append(_clean_screenshot_line(line))
            continue

        text_buffer.append(line)

    flush_text_buffer()
    return content_blocks


def extract_cited_bullet_ids(text: str) -> list[str]:
    """
    Extract bullet IDs cited in text using [id-format] notation.

    Parses text to find all bullet ID citations in format [section-00001].
    Used to track which strategies were applied by analyzing reasoning traces.

    Args:
        text: Text containing bullet citations (reasoning, thoughts, etc.)

    Returns:
        List of unique bullet IDs in order of first appearance.
        Empty list if no citations found.

    Example:
        >>> reasoning = "Following [general-00042], I verified the data. Using [geo-00003] for lookup."
        >>> extract_cited_bullet_ids(reasoning)
        ['general-00042', 'geo-00003']

    Note:
        Pattern matches: [word_characters-digits]
        Deduplicates while preserving order of first occurrence.
    """
    # Allow `/` and `-` for legacy IDs like `interactive/browser-00009`.
    matches = re.findall(r"\[([a-zA-Z_][a-zA-Z0-9_/-]*-\d+)\]", text)
    # Deduplicate while preserving order
    cited_ids = list(dict.fromkeys(matches))
    if cited_ids:
        logger.info(f"Cited IDs: {cited_ids}")
    return cited_ids


class GeneratorOutput(BaseModel):
    """Output from the Generator role containing reasoning and answer."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    reasoning: str = Field(..., description="Step-by-step reasoning process")
    final_answer: str = Field(..., description="The final answer to the question")
    bullet_ids: list[str] = Field(
        default_factory=list, description="IDs of strategies cited in reasoning"
    )
    raw: dict[str, Any] = Field(
        default_factory=dict, description="Raw LLM response data"
    )


class ExtractedLearning(BaseModel):
    """A single learning extracted by the Reflector from task execution."""

    model_config = STRICT_SCHEMA_CONFIG

    learning: str = Field(..., description="The extracted learning or insight")
    atomicity_score: float = Field(
        default=0.0, ge=0.0, le=1.0, description="How atomic/focused this learning is"
    )
    evidence: str = Field(
        default="", description="Evidence from execution supporting this learning"
    )


class BulletTag(BaseModel):
    """Classification tag for a bullet strategy (helpful/harmful/neutral)."""

    model_config = STRICT_SCHEMA_CONFIG

    id: str = Field(..., description="The bullet ID being tagged")
    tag: str = Field(
        ..., description="Classification: 'helpful', 'harmful', or 'neutral'"
    )


class _DeltaMetadataSchema(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    helpful: int = Field(default=0, description="Helpful count delta")
    harmful: int = Field(default=0, description="Harmful count delta")
    neutral: int = Field(default=0, description="Neutral count delta")


class _DeltaOperationSchema(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    type: str = Field(..., description="Operation type: ADD, UPDATE, TAG, or REMOVE")
    section: str = Field(..., description="Target playbook section")
    content: str = Field(default="", description="Bullet content for add or update operations")
    bullet_id: str = Field(default="", description="Existing bullet identifier for update, tag, or remove")
    metadata: _DeltaMetadataSchema = Field(
        default_factory=_DeltaMetadataSchema,
        description="Helpful, harmful, and neutral tag increments",
    )


class _DeltaBatchSchema(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    reasoning: str = Field(..., description="Curator reasoning for these playbook updates")
    operations: list[_DeltaOperationSchema] = Field(default_factory=list, description="Delta operations to apply")


class _ConsolidationOperationSchema(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    type: str = Field(..., description="Consolidation type: merge, drop, keep, or patch")
    source_ids: list[str] = Field(default_factory=list, description="Source bullet ids for merge")
    merged_content: str = Field(default="", description="Merged content for merge operations")
    keep_id: str = Field(default="", description="Bullet id to keep for merge operations")
    bullet_id: str = Field(default="", description="Single bullet id for delete or update operations")
    bullet_ids: list[str] = Field(default_factory=list, description="Bullet ids to keep separate")
    differentiation: str = Field(default="", description="Reason why similar bullets should stay separate")
    new_content: str = Field(default="", description="Replacement content for update operations")
    reasoning: str = Field(default="", description="Reasoning behind the consolidation decision")


class _ReflectorResponseSchema(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    reasoning: str = Field(..., description="Overall reasoning about the outcome")
    error_identification: str = Field(default="", description="Description of what went wrong if applicable")
    root_cause_analysis: str = Field(default="", description="Analysis of why errors occurred")
    correct_approach: str = Field(..., description="What the correct approach should be")
    key_insight: str = Field(..., description="The main lesson learned from this iteration")
    extracted_learnings: list[ExtractedLearning] = Field(
        default_factory=list, description="Learnings extracted from task execution"
    )
    bullet_tags: list[BulletTag] = Field(default_factory=list, description="Classifications of strategy effectiveness")


class _CuratorResponseSchema(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    delta: _DeltaBatchSchema = Field(..., description="Batch of delta operations to apply to playbook")
    consolidation_operations: list[_ConsolidationOperationSchema] = Field(
        default_factory=list,
        description="Optional bullet consolidation decisions produced during consolidation",
    )


class ReflectorOutput(BaseModel):
    """Output from the Reflector role containing analysis and bullet classifications."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    reasoning: str = Field(..., description="Overall reasoning about the outcome")
    error_identification: str = Field(
        default="", description="Description of what went wrong (if applicable)"
    )
    root_cause_analysis: str = Field(
        default="", description="Analysis of why errors occurred"
    )
    correct_approach: str = Field(
        ..., description="What the correct approach should be"
    )
    key_insight: str = Field(
        ..., description="The main lesson learned from this iteration"
    )
    extracted_learnings: list[ExtractedLearning] = Field(
        default_factory=list, description="Learnings extracted from task execution"
    )
    bullet_tags: list[BulletTag] = Field(
        default_factory=list, description="Classifications of strategy effectiveness"
    )
    raw: dict[str, Any] = Field(
        default_factory=dict, description="Raw LLM response data"
    )


class Reflector:
    """
    Analyzes generator outputs to extract lessons and improve strategies.

    The Reflector is one of the core experience learning roles. It analyzes the Generator's output
    and environment feedback to understand what went right or wrong, classifying
    which playbook bullets were helpful, harmful, or neutral.

    Args:
        llm: The LLM client to use for reflection
        prompt_template: Custom prompt template (uses REFLECTOR_PROMPT by default)
        max_retries: Maximum validation retries (default: 3)

    Example:
        >>> from app.experiences import Reflector, HubLLMClient
        >>> client = HubLLMClient()
        >>> reflector = Reflector(client)
        >>>
        >>> reflection = reflector.reflect(
        ...     question="What is 2+2?",
        ...     generator_output=generator_output,
        ...     playbook=playbook,
        ...     feedback="Correct!"
        ... )
        >>> print(reflection.key_insight)
    """

    def __init__(
        self,
        llm: LLMClient,
        prompt_template: str = REFLECTOR_PROMPT,
        *,
        max_retries: int = 3,
    ) -> None:
        self.llm = llm
        self.prompt_template = prompt_template
        self.max_retries = max_retries

    async def reflect(
        self,
        *,
        question: str,
        generator_output: GeneratorOutput,
        playbook: Playbook,
        ground_truth: str | None = None,
        feedback: str | None = None,
        **kwargs: Any,
    ) -> ReflectorOutput:
        """
        Analyze execution output and extract learnings.

        Args:
            question: The original question/task
            generator_output: Output from generator (reasoning, final_answer)
            playbook: Current playbook of strategies
            ground_truth: Expected correct answer (if known)
            feedback: Environment feedback on execution
            **kwargs: Additional arguments passed to the LLM

        Returns:
            ReflectorOutput with analysis and bullet tags
        """
        playbook_excerpt = _make_playbook_excerpt(playbook, generator_output.bullet_ids)

        # Format playbook section based on citation presence
        if playbook_excerpt:
            playbook_context = f"Strategies Applied:\n{playbook_excerpt}"
        else:
            playbook_context = "(No strategies cited - outcome-based learning)"

        base_prompt = self.prompt_template.format(
            question=question,
            reasoning=generator_output.reasoning,
            prediction=generator_output.final_answer,
            ground_truth=_format_optional(ground_truth),
            feedback=_format_optional(feedback),
            playbook_excerpt=playbook_context,
        )

        # Log Reflector input
        logger.info("=== Reflector Input ===")
        logger.info("Question: %s", question)
        logger.info("Model Reasoning: %s", generator_output.reasoning)
        logger.info("Model Prediction: %s", generator_output.final_answer)
        logger.info("Ground Truth: %s", _format_optional(ground_truth))
        logger.info("Environment Feedback: %s", _format_optional(feedback))
        logger.info("Playbook Excerpt: %s", playbook_context)
        logger.info("=== End Reflector Input ===")

        screenshots = kwargs.get("screenshots")

        content_blocks = None
        if screenshots:
            content_blocks = _build_reflector_content_blocks(base_prompt, screenshots)

        llm_kwargs = {
            k: v for k, v in kwargs.items() if k not in {"sample", "screenshots"}
        }

        output = await self.llm.complete_structured(
            _ReflectorResponseSchema,
            prompt=None if content_blocks is not None else base_prompt,
            content_blocks=content_blocks,
            **llm_kwargs,
        )

        return ReflectorOutput(
            reasoning=output.reasoning,
            error_identification=output.error_identification,
            root_cause_analysis=output.root_cause_analysis,
            correct_approach=output.correct_approach,
            key_insight=output.key_insight,
            extracted_learnings=output.extracted_learnings,
            bullet_tags=output.bullet_tags,
            raw={},
        )


class CuratorOutput(BaseModel):
    """Output from the Curator role containing playbook update operations."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    delta: DeltaBatch = Field(
        ..., description="Batch of delta operations to apply to playbook"
    )
    raw: dict[str, Any] = Field(
        default_factory=dict, description="Raw LLM response data"
    )


class Curator:
    """
    Transforms reflections into actionable playbook updates.

    The Curator is another core experience learning role. It analyzes the Reflector's output
    and decides how to update the playbook - adding new strategies, updating
    existing ones, or removing harmful patterns.

    Args:
        llm: The LLM client to use for curation
        prompt_template: Custom prompt template (uses CURATOR_PROMPT by default)
        max_retries: Maximum validation retries (default: 3)
        consolidator: Optional EntryConsolidator for similarity-based consolidation

    Example:
        >>> from app.experiences import Curator, HubLLMClient
        >>> client = HubLLMClient()
        >>> curator = Curator(client)
        >>>
        >>> output = curator.curate(
        ...     reflection=reflection_output,
        ...     playbook=playbook,
        ...     question_context="Math problem solving",
        ...     progress="5/10 problems solved correctly"
        ... )
        >>> playbook.apply_delta(output.delta)

    The Curator emits DeltaOperations:
        - ADD: Add new strategy bullets
        - UPDATE: Modify existing bullets
        - TAG: Update helpful/harmful counts
        - REMOVE: Delete unhelpful bullets
    """

    def __init__(
        self,
        llm: LLMClient,
        prompt_template: str = CURATOR_PROMPT,
        *,
        max_retries: int = 3,
        consolidator: EntryConsolidator | None = None,
    ) -> None:
        self.llm = llm
        self.prompt_template = prompt_template
        self.max_retries = max_retries
        self.consolidator = consolidator

    async def curate(
        self,
        *,
        reflection: ReflectorOutput,
        playbook: Playbook,
        question_context: str,
        progress: str,
        **kwargs: Any,
    ) -> CuratorOutput:
        """
        Generate delta operations to update the playbook based on reflection.

        If an EntryConsolidator is configured, this method will:
        1. Generate a similarity report for similar bullet pairs
        2. Include the report in the prompt for the Curator to handle
        3. Parse and apply consolidation operations from the response

        Args:
            reflection: The Reflector's analysis of what went right/wrong
            playbook: Current playbook to potentially update
            question_context: Description of the task domain or question type
            progress: Current progress summary (e.g., "5/10 correct")
            **kwargs: Additional arguments passed to the LLM

        Returns:
            CuratorOutput containing the delta operations to apply
        """
        # Get similarity report if consolidation is enabled
        similarity_report = None
        if self.consolidator is not None:
            similarity_report = self.consolidator.get_similarity_report(playbook)
            if similarity_report:
                logger.info("Including similarity report in Curator prompt")

        # Serialize reflection with all meaningful fields
        reflection_data = {
            "reasoning": reflection.reasoning,
            "error_identification": reflection.error_identification,
            "root_cause_analysis": reflection.root_cause_analysis,
            "correct_approach": reflection.correct_approach,
            "key_insight": reflection.key_insight,
            "extracted_learnings": [
                learning.model_dump() for learning in reflection.extracted_learnings
            ],
        }

        base_prompt = self.prompt_template.format(
            progress=progress,
            stats=json.dumps(playbook.stats()),
            reflection=json.dumps(reflection_data, ensure_ascii=False, indent=2),
            playbook=playbook.as_prompt() or "(empty playbook)",
            question_context=question_context,
        )

        # Append similarity report if available
        if similarity_report:
            base_prompt = base_prompt + "\n\n" + similarity_report

        # Log Curator input
        logger.info("=== Curator Input ===")
        logger.info("Progress: %s", progress)
        logger.info("Stats: %s", json.dumps(playbook.stats()))
        logger.info("Reflection: %s", json.dumps(reflection_data, ensure_ascii=False))
        logger.info("Question Context: %s", question_context)
        if similarity_report:
            logger.info("Similarity Report: %s", similarity_report)
        logger.info("=== End Curator Input ===")

        # Filter out non-LLM kwargs
        llm_kwargs = {k: v for k, v in kwargs.items() if k != "sample"}

        output = await self.llm.complete_structured(
            _CuratorResponseSchema,
            prompt=base_prompt,
            **llm_kwargs,
        )

        public_output = CuratorOutput(
            delta=_delta_batch_from_schema(output.delta),
            raw=_consolidation_payload(output.consolidation_operations),
        )

        # Apply consolidation operations if consolidation is enabled
        if self.consolidator is not None and public_output.raw:
            applied_ops = self.consolidator.apply_operations_from_response(
                public_output.raw, playbook
            )
            if applied_ops:
                logger.info(f"Applied {len(applied_ops)} consolidation operations")

        return public_output


class ReplayGenerator:
    """
    Replays pre-recorded responses instead of calling an LLM.

    Useful for offline training from historical data (logs, traces, etc.)
    where you want the experience system to learn from actual past interactions without
    generating new responses.

    Args:
        responses: Dict mapping questions to their pre-recorded answers (optional)
        default_response: Response to return if question not found (default: "")

    Example:
        >>> responses = {
        ...     "What is 2+2?": "4",
        ...     "What is the capital of France?": "Paris"
        ... }
        >>> generator = ReplayGenerator(responses)
        >>> output = generator.generate(
        ...     question="What is 2+2?",
        ...     playbook=Playbook()
        ... )
        >>> print(output.final_answer)
        4
    """

    def __init__(
        self, responses: dict[str, str] | None = None, default_response: str = ""
    ) -> None:
        self.responses = responses if responses is not None else {}
        self.default_response = default_response

    def _extract_response_from_sample(
        self, sample: Any
    ) -> tuple[str | None, str | None]:
        """Extract response from sample object using multiple fallback strategies."""
        # Try sample.metadata['response'] (Sample dataclass)
        if hasattr(sample, "metadata") and isinstance(sample.metadata, dict):
            response = sample.metadata.get("response")
            if response:
                return response, "sample_metadata"

        # Try sample['metadata']['response'] (nested dict)
        if isinstance(sample, dict) and "metadata" in sample:
            if isinstance(sample["metadata"], dict):
                response = sample["metadata"].get("response")
                if response:
                    return response, "sample_dict_metadata"

        # Try sample['response'] (direct dict)
        if isinstance(sample, dict):
            response = sample.get("response")
            if response:
                return response, "sample_dict_direct"

        return None, None

    def generate(
        self,
        *,
        question: str,
        playbook: Playbook,
        context: str | None = None,
        reflection: str | None = None,
        **kwargs: Any,
    ) -> GeneratorOutput:
        """
        Return the pre-recorded response for the given question.

        Args:
            question: The question to answer
            playbook: The current playbook (ignored in replay)
            context: Additional context (ignored in replay)
            reflection: Optional reflection (ignored in replay)
            **kwargs: Additional arguments. Can include 'sample' for sample-based mode.

        Returns:
            GeneratorOutput with the replayed answer
        """
        final_answer = None
        response_source = None

        # Priority 1-3: Extract from sample if provided
        if "sample" in kwargs:
            sample = kwargs["sample"]
            final_answer, response_source = self._extract_response_from_sample(sample)

        # Priority 4: Look up in responses dict
        if not final_answer and question in self.responses:
            final_answer = self.responses[question]
            response_source = "responses_dict"

        # Priority 5: Use default response
        if not final_answer and self.default_response:
            final_answer = self.default_response
            response_source = "default_response"

        # Validation: Ensure we have a response
        if not final_answer:
            raise ValueError(
                f"ReplayGenerator could not find response for question: '{question[:100]}...'. "
                f"Ensure sample has 'response' field or provide default_response."
            )

        # Create metadata for observability
        reasoning_map: dict[str, str] = {
            "sample_metadata": "[Replayed from sample.metadata]",
            "sample_dict_metadata": "[Replayed from sample dict metadata]",
            "sample_dict_direct": "[Replayed from sample dict]",
            "responses_dict": "[Replayed from responses dict]",
            "default_response": "[Replayed using default response]",
        }
        reasoning = reasoning_map.get(
            response_source if response_source else "", "[Replayed - source unknown]"
        )

        return GeneratorOutput(
            reasoning=reasoning,
            final_answer=final_answer,
            bullet_ids=[],
            raw={
                "reasoning": reasoning,
                "final_answer": final_answer,
                "bullet_ids": [],
                "replay_metadata": {
                    "response_source": response_source,
                    "question_found_in_dict": question in self.responses,
                    "sample_provided": "sample" in kwargs,
                },
            },
        )


def _make_playbook_excerpt(playbook: Playbook, bullet_ids: Sequence[str]) -> str:
    """Create excerpt of playbook showing only cited bullets."""
    lines: list[str] = []
    seen = set()
    for bullet_id in bullet_ids:
        if bullet_id in seen:
            continue
        bullet = playbook.get_bullet(bullet_id)
        if bullet:
            seen.add(bullet_id)
            lines.append(f"[{bullet.id}] {bullet.content}")
    return "\n".join(lines)


__all__ = [
    "GeneratorOutput",
    "ReflectorOutput",
    "CuratorOutput",
    "ExtractedLearning",
    "BulletTag",
    "Reflector",
    "Curator",
    "ReplayGenerator",
    "extract_cited_bullet_ids",
]


def _delta_batch_from_schema(delta: _DeltaBatchSchema) -> DeltaBatch:
    payload = {
        "reasoning": delta.reasoning,
        "operations": [
            {
                "type": operation.type,
                "section": operation.section,
                "content": operation.content or None,
                "bullet_id": operation.bullet_id or None,
                "metadata": _metadata_payload(operation.metadata),
            }
            for operation in delta.operations
        ],
    }
    return DeltaBatch.from_json(payload)


def _metadata_payload(metadata: _DeltaMetadataSchema) -> dict[str, int]:
    return {
        key: value
        for key, value in metadata.model_dump().items()
        if value
    }


def _consolidation_payload(
    operations: list[_ConsolidationOperationSchema],
) -> dict[str, Any]:
    if not operations:
        return {}
    return {
        "consolidation_operations": [
            operation.model_dump()
            for operation in operations
        ]
    }
