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

"""Dispatch-kind specific renderers used by the rendering layer.

Centralizes the per-dispatch-kind plan-UI cues (icon, titles, labels) so the
rendering modules don't each branch on ``task.skill_name`` / ``task.tool_name``.
Callers read ``task.display`` first and fall back to the dispatch-kind defaults
provided here. Adding a new dispatch kind is: define a Dispatch subclass,
implement a renderer, register it in :data:`_RENDERERS`."""

from __future__ import annotations

from typing import Protocol

from ...models import SkillDispatch, SubAgentDispatch, TaskSpec, ToolDispatch


class TaskRenderer(Protocol):
    """Strategy interface implemented per dispatch kind."""

    default_icon: str
    """Frontend icon identifier for this dispatch kind."""

    def plan_title(self, task: TaskSpec) -> str:
        """Sub-step title shown under the parent plan step."""
        ...

    def batch_step_title(self, task: TaskSpec) -> str:
        """Title for the batch's umbrella plan step."""
        ...

    def single_step_title(self, task: TaskSpec) -> str:
        """Title for a single-task batch shown as one plan step."""
        ...

    def context_line(self, task: TaskSpec) -> str:
        """One ``"Skill: X"`` / ``"Tool: Y"`` style annotation line."""
        ...

    def command_hint(self, task: TaskSpec) -> str:
        """Short execution-command hint (``"local tool: echo"``)."""
        ...

    def resolved_item_name(self, task: TaskSpec, command: str = "") -> str:
        """Plan-item label after the task has been resolved against the
        capability palette."""
        ...

    def invocation_label(self, task: TaskSpec) -> str:
        """Short label used in batch lists (``"skill android-test"``)."""
        ...


def _display_or(default: str, override: str) -> str:
    return override.strip() if override and override.strip() else default


class ToolRenderer:
    """Renderer for :class:`ToolDispatch` tasks."""

    default_icon = "tool"

    def plan_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or "Local tool", task.display.plan_title)

    def batch_step_title(self, task: TaskSpec) -> str:
        return _display_or("Local tool batch", task.display.batch_step_title)

    def single_step_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or "Local tool", task.display.single_step_title)

    def context_line(self, task: TaskSpec) -> str:
        return f"Tool: {task.tool_name}" if task.tool_name else ""

    def command_hint(self, task: TaskSpec) -> str:
        return f"local tool: {task.tool_name}" if task.tool_name else ""

    def resolved_item_name(self, task: TaskSpec, command: str = "") -> str:
        if task.tool_name:
            return f"Resolved local tool: {task.tool_name}"
        return "Resolved local tool"

    def invocation_label(self, task: TaskSpec) -> str:
        return f"tool {task.tool_name}" if task.tool_name else "tool"


class SkillRenderer:
    """Renderer for :class:`SkillDispatch` tasks."""

    default_icon = "skill"

    def plan_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or task.skill_name or "Skill", task.display.plan_title)

    def batch_step_title(self, task: TaskSpec) -> str:
        return _display_or("Skill batch", task.display.batch_step_title)

    def single_step_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or task.skill_name or "Skill", task.display.single_step_title)

    def context_line(self, task: TaskSpec) -> str:
        return f"Skill: {task.skill_name}" if task.skill_name else ""

    def command_hint(self, task: TaskSpec) -> str:
        return f"skill entrypoint: {task.skill_name}" if task.skill_name else ""

    def resolved_item_name(self, task: TaskSpec, command: str = "") -> str:
        if task.skill_name:
            suffix = f" -> {command}" if command else ""
            return f"Resolved skill: {task.skill_name}{suffix}"
        return "Resolved skill"

    def invocation_label(self, task: TaskSpec) -> str:
        return f"skill {task.skill_name}" if task.skill_name else "skill"


class SubAgentRenderer:
    """Renderer for :class:`SubAgentDispatch` tasks."""

    default_icon = "sub_agent"

    def plan_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or "Sub-agent", task.display.plan_title)

    def batch_step_title(self, task: TaskSpec) -> str:
        return _display_or("Sub-agent batch", task.display.batch_step_title)

    def single_step_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or "Sub-agent", task.display.single_step_title)

    def context_line(self, task: TaskSpec) -> str:
        persona = getattr(task.dispatch, "persona", "default")
        return f"Sub-agent: {persona}"

    def command_hint(self, task: TaskSpec) -> str:
        return "sub-agent reasoning loop"

    def resolved_item_name(self, task: TaskSpec, command: str = "") -> str:
        persona = getattr(task.dispatch, "persona", "default")
        return f"Resolved sub-agent: {persona}"

    def invocation_label(self, task: TaskSpec) -> str:
        persona = getattr(task.dispatch, "persona", "default")
        return f"sub-agent {persona}"


_TOOL_RENDERER = ToolRenderer()
_SKILL_RENDERER = SkillRenderer()
_SUB_AGENT_RENDERER = SubAgentRenderer()

_RENDERERS: dict[type, TaskRenderer] = {
    ToolDispatch: _TOOL_RENDERER,
    SkillDispatch: _SKILL_RENDERER,
    SubAgentDispatch: _SUB_AGENT_RENDERER,
}


def renderer_for(task: TaskSpec) -> TaskRenderer:
    """Return the renderer associated with ``task.dispatch``.

    Falls back to the tool renderer when the dispatch kind is unknown — this
    only happens with corrupt persisted records and produces a benign label
    rather than raising."""
    return _RENDERERS.get(type(task.dispatch), _TOOL_RENDERER)
