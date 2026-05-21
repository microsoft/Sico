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

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from android_tester.models import RunState


class PromptRenderer:
    def __init__(self, data_root: Path) -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(data_root / "prompts")),
            autoescape=select_autoescape(
                enabled_extensions=("html", "htm", "xml"),
                default_for_string=False,
            ),
            trim_blocks=True,
            lstrip_blocks=True,
        )

    async def render_operator(self, state: RunState) -> str:
        template = self._env.get_template("operator.j2")
        return template.render(
            problem=state.instruction,
            previous_actions=self._previous_actions(state),
            progress_status=state.progress_status,
            current_step_goal=state.current_step_goal,
            last_reflection=self._format_last_reflection(state),
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
