"""Dispatch-kind specific renderers used by the rendering layer.

Centralizes the plan-UI cues (icon, titles, labels) so the rendering modules
don't each branch on ``task.skill_name`` / ``task.tool_name``. Callers read
``task.display`` first and fall back to the defaults provided here. Giving a
new capability provider its own phrasing is: implement a renderer and register
it in :data:`_CAPABILITY_RENDERERS` under that provider id."""

from __future__ import annotations

from typing import Protocol

from ...capabilities.ids import BUILTIN_PROVIDER_ID, SKILL_PROVIDER_ID, provider_of
from ...domain.models import TaskSpec


class TaskRenderer(Protocol):
    """Strategy interface implemented per presentation flavour."""

    default_icon: str
    """Frontend icon identifier for this flavour."""

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
    """Renderer for builtin capability tasks."""

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
    """Renderer for skill capability tasks."""

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
    """Renderer for sub-agent tasks."""

    default_icon = "sub_agent"

    def plan_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or "Sub-agent", task.display.plan_title)

    def batch_step_title(self, task: TaskSpec) -> str:
        return _display_or("Sub-agent batch", task.display.batch_step_title)

    def single_step_title(self, task: TaskSpec) -> str:
        return _display_or(task.title or "Sub-agent", task.display.single_step_title)

    def context_line(self, task: TaskSpec) -> str:
        profile_id = getattr(task.dispatch, "profile_id", "default")
        return f"Sub-agent: {profile_id}"

    def command_hint(self, task: TaskSpec) -> str:
        return "sub-agent reasoning loop"

    def resolved_item_name(self, task: TaskSpec, command: str = "") -> str:
        profile_id = getattr(task.dispatch, "profile_id", "default")
        return f"Resolved sub-agent: {profile_id}"

    def invocation_label(self, task: TaskSpec) -> str:
        profile_id = getattr(task.dispatch, "profile_id", "default")
        return f"sub-agent {profile_id}"


_TOOL_RENDERER = ToolRenderer()
_SKILL_RENDERER = SkillRenderer()
_SUB_AGENT_RENDERER = SubAgentRenderer()

_CAPABILITY_RENDERERS: dict[str, TaskRenderer] = {
    BUILTIN_PROVIDER_ID: _TOOL_RENDERER,
    SKILL_PROVIDER_ID: _SKILL_RENDERER,
}


def renderer_for(task: TaskSpec) -> TaskRenderer:
    """Return the renderer that phrases ``task`` for the plan view.

    Presentation still distinguishes a skill from a builtin payload, but that is
    now a *label* decision keyed off the capability's provider rather than a
    dispatch kind. A provider with no entry here falls back to the builtin
    wording, which is right for a corrupt record but not for a real new source:
    adding one means adding its renderer alongside it.
    """
    if task.kind == "sub_agent":
        return _SUB_AGENT_RENDERER
    return _CAPABILITY_RENDERERS.get(provider_of(task.capability_id), _TOOL_RENDERER)
