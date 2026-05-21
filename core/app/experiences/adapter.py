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

"""Convert conversation data into TrajectoryData format.

Uses LLM extraction to convert raw conversation JSON into TrajectoryData.
Called by chat service after execution.

Usage::

    from app.experiences.adapter import convert_to_trajectory_data

    trajectory = await convert_to_trajectory_data(conversation_json)
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.experiences.runner import TrajectoryData

logger = logging.getLogger(__name__)

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def _read_prompt(filename: str) -> str:
    return (_PROMPT_DIR / filename).read_text(encoding="utf-8")


async def convert_to_trajectory_data(conversation_json: str) -> TrajectoryData | None:
    """Use LLM to convert raw conversation JSON into TrajectoryData.

    Args:
        conversation_json: The raw JSON string from conversation.json.

    Returns:
        A populated :class:`TrajectoryData`, or ``None`` if the conversation
        does not contain meaningful trajectory data.
    """
    from app.llmhubs.hub import LLMHub
    from app.llmhubs.types import Input, InputContent, Request

    request = Request(
        instructions=_read_prompt("trajectory_extraction.md"),
        inputs=[
            Input(
                role="user",
                content=[
                    InputContent(
                        type="text",
                        text=f"Extract the trajectory from this conversation:\n\n{conversation_json}",
                    )
                ],
            )
        ],
        options={
            "temperature": 0.0,
            "timeout_ms": 300_000,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "TrajectoryData",
                    "schema": TrajectoryData.model_json_schema(),
                    "strict": False,
                },
            },
        },
    )

    hub = LLMHub()
    response = await hub.generate(request)

    if response.code != 0:
        raise RuntimeError(f"LLM trajectory extraction failed: {response.msg}")

    # Parse the structured JSON output directly into TrajectoryData
    trajectory = TrajectoryData.model_validate_json(response.text)
    if not trajectory.task:
        return None
    return trajectory
