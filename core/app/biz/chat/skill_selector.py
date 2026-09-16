from __future__ import annotations

import json
import logging

from pydantic import BaseModel, ConfigDict, Field

import app.llmhubs
from app.biz.task_runtime.guides import SkillGuide, SkillGuideDescriptor, SkillGuideRegistry
from app.llmhubs.request_builder import build_llm_request


_LOGGER = logging.getLogger(__name__)
_MAX_SELECTED_GUIDES = 3


class SkillGuideSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skill_ids: list[int] = Field(default_factory=list, max_length=_MAX_SELECTED_GUIDES)
    reason: str = ""


async def select_skill_guides(
    registry: SkillGuideRegistry,
    user_prompt: str,
    *,
    prior_conversation: str = "",
) -> tuple[SkillGuide, ...]:
    explicit = registry.activate_explicit(user_prompt)
    if explicit:
        return explicit
    descriptors = registry.list_guides()
    if not descriptors or not user_prompt.strip():
        return ()
    selection = await _semantic_selection(user_prompt, prior_conversation, descriptors)
    descriptors_by_id = {descriptor.ref.skill_id: descriptor for descriptor in descriptors}
    selected: list[SkillGuide] = []
    seen: set[int] = set()
    for skill_id in selection.skill_ids:
        descriptor = descriptors_by_id.get(skill_id)
        if descriptor is None or skill_id in seen:
            continue
        seen.add(skill_id)
        selected.append(registry.resolve(descriptor.ref))
    return tuple(selected)


async def _semantic_selection(
    user_prompt: str,
    prior_conversation: str,
    descriptors: tuple[SkillGuideDescriptor, ...],
) -> SkillGuideSelection:
    request = build_llm_request(
        [
            {
                "role": "system",
                "content": (
                    "Select instruction guides that clearly govern how to perform the user's request. "
                    "Select none when a guide is only tangentially related or the user is merely discussing it. "
                    f"Select at most {_MAX_SELECTED_GUIDES}. Return only the structured response."
                ),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "user_prompt": user_prompt,
                                "recent_prior_conversation": prior_conversation,
                                "guides": [
                                    {
                                        "skill_id": descriptor.ref.skill_id,
                                        "name": descriptor.name,
                                        "description": descriptor.description,
                                    }
                                    for descriptor in descriptors
                                ],
                            },
                            ensure_ascii=False,
                        ),
                    }
                ],
            },
        ],
        response_format=SkillGuideSelection,
    )
    try:
        response = await app.llmhubs.generate(request=request)
    except Exception:
        _LOGGER.warning("skill_guide_semantic_selection_failed", exc_info=True)
        return SkillGuideSelection(reason="selection_failed")
    if response.code != 0:
        _LOGGER.warning("skill_guide_semantic_selection_non_zero code=%s msg=%s", response.code, response.msg)
        return SkillGuideSelection(reason="selection_error")
    try:
        for output in response.outputs or ():
            if getattr(output, "json", None) is not None:
                return SkillGuideSelection.model_validate(output.json)
        text = response.outputs[0].text if response.outputs else response.text
        return SkillGuideSelection.model_validate_json(text or "{}")
    except ValueError:
        _LOGGER.warning("skill_guide_semantic_selection_invalid_response")
        return SkillGuideSelection(reason="selection_invalid")


__all__ = ["SkillGuideSelection", "select_skill_guides"]
