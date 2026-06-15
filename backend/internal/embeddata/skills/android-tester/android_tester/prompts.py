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

from __future__ import annotations

import json
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from android_tester.models import RunState


_MAX_OPERATOR_DATA_CHARS = 2000


class PromptRenderer:
    def __init__(
        self,
        data_root: Path,
        resources_available: bool = False,
    ) -> None:
        self._resources_available = resources_available
        self._env = Environment(
            loader=FileSystemLoader(str(data_root / "prompts")),
            autoescape=select_autoescape(
                enabled_extensions=("html", "htm", "xml"),
                default_for_string=False,
            ),
            trim_blocks=True,
            lstrip_blocks=True,
        )

    async def render_operator(
        self,
        state: RunState,
        *,
        image_size: tuple[int, int] | None = None,
    ) -> str:
        template = self._env.get_template("operator.j2")
        return template.render(
            problem=state.instruction,
            previous_actions=self._previous_actions(state),
            data=self._operator_data(state),
            progress_status=state.progress_status,
            current_step_goal=state.current_step_goal,
            last_reflection=self._format_last_reflection(state),
            image_size=image_size,
            resources_available=self._resources_available,
        )

    async def render_reflector(self,
                               state: RunState,
                               last_action: str,
                               last_summary: str,
                               ) -> str:
        template = self._env.get_template("reflector.j2")
        return template.render(
            problem=state.instruction,
            previous_actions=self._previous_actions(state),
            progress_status=state.progress_status,
            current_step_goal=state.current_step_goal,
            last_action=last_action,
            last_summary=last_summary,
        )

    async def render_launch_picker(
        self,
        state: RunState,
        requested_app: str,
        installed_packages: list[str],
    ) -> str:
        template = self._env.get_template("launch_picker.j2")
        return template.render(
            problem=state.instruction,
            requested_app=requested_app,
            installed_packages=installed_packages,
        )

    @staticmethod
    def _previous_actions(state: RunState) -> str:
        if not state.summaries:
            return "None"
        return "\n".join(f"{i + 1}. {summary}"
                         for i, summary in enumerate(state.summaries))

    @staticmethod
    def _format_last_reflection(state: RunState) -> str:
        r = state.last_reflection_obj
        if r is None:
            return ""
        return f"{r.outcome}: {r.what_happened}"

    @staticmethod
    def _operator_data(state: RunState) -> list[tuple[str, str]]:
        if not state.operator_data:
            return []
        rows: list[tuple[str, str]] = []
        for key, value in sorted(state.operator_data.items()):
            sanitized = value.replace("\x00", "")
            if len(sanitized) > _MAX_OPERATOR_DATA_CHARS:
                sanitized = (
                    sanitized[:_MAX_OPERATOR_DATA_CHARS]
                    + " ...(truncated)"
                )
            rows.append((key, json.dumps(sanitized, ensure_ascii=False)))
        return rows


class PreconditionPromptRenderer(PromptRenderer):
    """Swaps the operator prompt for the precondition-specific variant."""

    async def render_operator(
        self,
        state: RunState,
        *,
        image_size: tuple[int, int] | None = None,
    ) -> str:
        template = self._env.get_template("precondition_operator.j2")
        return template.render(
            problem=state.instruction,
            previous_actions=self._previous_actions(state),
            data=self._operator_data(state),
            progress_status=state.progress_status,
            current_step_goal=state.current_step_goal,
            last_reflection=self._format_last_reflection(state),
            image_size=image_size,
            resources_available=self._resources_available,
        )

    async def render_precondition_planner(
        self,
        preconditions: list[tuple[str, str]],
    ) -> str:
        """Render the prompt that asks the LLM to order *preconditions*.

        *preconditions* is a list of ``(label, description)`` pairs in
        their original (CLI) order.
        """
        template = self._env.get_template("precondition_planner.j2")
        return template.render(preconditions=preconditions)
