from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, Field

from app.biz.skill.paths import latest_skill_version_dir, skill_runtime_dir

from ..sandbox.types import sandbox_for_requirement
from ..workspace.layout import workspace_layout

if TYPE_CHECKING:
    from app.biz.skill.resolver import ResolvedAction

_LOGGER = logging.getLogger(__name__)

CapabilityVisibility = Literal["public", "internal"]
"""Capability palette scope.

- ``public``: shown to the Lead Planner LLM and listed in
  :meth:`SkillLoader.render_cards_section`. Default for project-registered
  skills.
- ``internal``: callable inside the runtime (sub-agents, normalizer fallback,
  explicit planner allow-list) but withheld from the default Lead Planner
  palette. Used for low-level building blocks that should not be planned
  directly.
"""


class CapabilityCard(BaseModel):
    """Prompt/runtime projection of one resolved skill action."""

    name: str
    description: str = ""
    when_to_use: str = ""
    skill_id: int = 0
    skill_name: str = ""
    action_name: str = ""
    action_description: str = ""
    infra_requirements: list[str] = Field(default_factory=list)
    execution_backend: Literal["any", "local", "docker", "kubernetes", "linux_workstation"] = "any"
    target_type: Literal["", "linux_workstation"] = ""
    target_os: str = ""
    parameters: list[dict[str, Any]] = Field(default_factory=list)
    display: dict[str, str] = Field(default_factory=dict)
    skill_dir: str = ""
    visibility: CapabilityVisibility = "public"
    workspace_access: Literal["none", "read_only", "read_write"] = "read_write"
    """Whether the Lead Planner LLM should see this card by default."""
    effect: Literal["read", "mutate"] | None = None
    """Side-effect class declared on the skill index's action entry.

    ``None`` means undeclared, which is the case for every skill today. The
    capability provider projects an undeclared action as ``mutate`` — the
    conservative reading. That default lives in the provider, never in the
    descriptor, so "forgot to declare" can never silently become "assumed
    harmless".
    """

    @property
    def is_executable(self) -> bool:
        return bool(self.action_name)

    @property
    def requires_sandbox(self) -> list[str]:
        return list(self.sandbox_options)

    @property
    def sandbox_options(self) -> tuple[str, ...]:
        """Every OS or concrete target type this card can use.

        An explicit target type takes precedence over OS-derived infra options.
        """
        if self.target_type:
            return (self.target_type,)
        if self.execution_backend == "linux_workstation":
            return ("linux_workstation",)
        options: list[str] = []
        seen: set[str] = set()
        for requirement in self.infra_requirements:
            sandbox = sandbox_for_requirement(requirement)
            if sandbox and sandbox not in seen:
                options.append(sandbox)
                seen.add(sandbox)
        return tuple(options)


@dataclass(frozen=True)
class ResolvedSkillAction:
    """A resolved skill action paired with the runtime directory it runs in."""

    action: ResolvedAction
    runtime_root: Path


class SkillLoader:
    def __init__(self, workspace_root: Path, *, project_id: int = 0, agent_id: str = "") -> None:
        self.workspace_root = workspace_root
        self.project_id = project_id
        self.agent_id = agent_id
        self._cards: dict[str, CapabilityCard] = {}

    def load(self) -> None:
        cards: dict[str, CapabilityCard] = {}
        for entry in self._read_index():
            for card in self._load_action_cards(entry):
                cards[card.name] = card
        self._cards = cards

    def resolve(self, skill_name: str) -> CapabilityCard | None:
        if not self._cards:
            self.load()
        return self._cards.get(skill_name)

    def load_action(self, skill_name: str, action_name: str) -> ResolvedSkillAction | None:
        """Resolve one skill action into its executable steps + runtime root.

        Returns the pre-generated :class:`ResolvedAction` (the model never reads
        skill code - the resolver already lowered each action into argv steps)
        together with the runtime directory those steps ``cd`` into. ``None`` is
        returned when the skill/action is unknown or has no resolved steps so the
        caller can surface a deterministic user-input failure.
        """
        card = self.resolve(f"{skill_name}.{action_name}")
        if card is None or not card.action_name:
            return None
        skill_root = self._skill_root(card.skill_id)
        from app.biz.skill.resolver import load_resolved_actions

        for action in load_resolved_actions(skill_root):
            if action.name == action_name:
                return ResolvedSkillAction(action=action, runtime_root=_runtime_root(skill_root))
        return None

    def list_cards(self, *, visibility: CapabilityVisibility | Literal["any"] = "public") -> list[CapabilityCard]:
        """List capability cards filtered by visibility.

        - ``"public"`` (default): only cards intended for the Lead Planner palette.
        - ``"internal"``: only cards withheld from the default planner palette
          (sub-agent toolkits, normaliser-only fallbacks).
        - ``"any"``: every loaded card regardless of visibility.

        ``resolve(name)`` always works regardless of visibility; visibility
        only affects discovery, not resolution.
        """
        if not self._cards:
            self.load()
        if visibility == "any":
            return list(self._cards.values())
        return [card for card in self._cards.values() if card.visibility == visibility]

    def render_cards_section(self, *, compact: bool = False) -> str:
        cards = self.list_cards(visibility="public")
        if not cards:
            return ""
        lines = [
            "These executable skill actions are available:",
            "- Executable skill actions have an action_name and may be run by a delegated task when an adapter is appropriate.",
        ]
        for card in cards:
            lines.append(f"- skill_id: {card.skill_id}")
            lines.append(f"  skill_name: {card.skill_name}")
            if card.description:
                lines.append(f"  description: {card.description}")
            lines.append("  kind: executable_action")
            lines.append(f"  action_name: {card.action_name}")
            if compact:
                lines.append(f"  capability_id: skill:{card.skill_name}:{card.action_name}")
                lines.append("  invocation: describe with capability_catalogue, then delegate")
                continue
            if card.action_description:
                lines.append(f"  action_description: {card.action_description}")
            if card.infra_requirements:
                lines.append(f"  infra_requirements: {json.dumps(card.infra_requirements, ensure_ascii=False)}")
            lines.append(f"  execution_backend: {card.execution_backend}")
            if card.target_type:
                lines.append(f"  target_type: {card.target_type}")
            if card.parameters:
                lines.append(f"  parameters: {json.dumps(card.parameters, ensure_ascii=False)}")
            lines.append("  invocation: delegated task runtime skill action")
        return "\n".join(lines)

    def _read_index(self) -> list[dict[str, Any]]:
        index_path = self.workspace_root / "skills" / "index.json"
        if not index_path.exists():
            return []
        loaded = json.loads(index_path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, list) else []

    def _load_action_cards(self, entry: dict[str, Any]) -> list[CapabilityCard]:
        """Project one registered skill's accepted manifest onto executable cards."""
        skill_id = _int_value(entry.get("id"))
        if skill_id <= 0:
            return []
        skill_name = str(entry.get("name") or f"skill-{skill_id}").strip() or f"skill-{skill_id}"
        skill_description = str(entry.get("description") or "")
        skill_root = self._skill_root(skill_id)
        from app.biz.skill.resolver import load_resolved_actions

        try:
            actions = load_resolved_actions(skill_root)
        except Exception:
            _LOGGER.warning("failed to load accepted actions for skill %s", skill_id, exc_info=True)
            return []
        return [_action_card(skill_id, skill_name, skill_description, skill_root, action) for action in actions]

    def _skill_root(self, skill_id: int) -> Path:
        if self.project_id or self.agent_id:
            for _, _, root in workspace_layout().skill_roots(project_id=self.project_id, agent_id=self.agent_id):
                skill_root = root / str(skill_id)
                if skill_root.exists():
                    return latest_skill_version_dir(skill_root)
        return _staged_skill_root(self.workspace_root, skill_id)


def _action_card(
    skill_id: int, skill_name: str, skill_description: str, skill_root: Path, action: ResolvedAction
) -> CapabilityCard:
    from app.biz.skill.resolver import infer_required_parameter_names

    required = infer_required_parameter_names(action)
    parameters = [
        {
            **parameter.model_dump(exclude={"type"} if parameter.type == "string" else set()),
            "required": parameter.name in required,
        }
        for parameter in action.parameters
    ]
    runtime_root = _runtime_root(skill_root)
    return CapabilityCard(
        name=f"{skill_name}.{action.name}",
        description=skill_description,
        skill_id=skill_id,
        skill_name=skill_name,
        action_name=action.name,
        action_description=action.description,
        infra_requirements=list(action.infra_requirements),
        execution_backend=action.execution_requirement.backend,
        target_type=action.target_requirements.type,
        target_os=action.target_requirements.os,
        parameters=parameters,
        display=_display_for_infra(action.infra_requirements),
        skill_dir=str(runtime_root),
        workspace_access=action.workspace_access,
        effect=action.effect,
    )


def _action_cards_from_index(
    entry: dict[str, Any],
    *,
    skill_id: int,
    skill_name: str,
    skill_description: str,
    skill_root: Path,
) -> list[CapabilityCard]:
    raw_actions = entry.get("actions")
    if not isinstance(raw_actions, list):
        return []
    runtime_root = _runtime_root(skill_root)
    cards: list[CapabilityCard] = []
    for raw_action in raw_actions:
        if not isinstance(raw_action, dict):
            continue
        action_name = str(raw_action.get("name") or "").strip()
        if not action_name:
            continue
        parameters = raw_action.get("parameters") if isinstance(raw_action.get("parameters"), list) else []
        infra_requirements = (
            raw_action.get("infra_requirements") if isinstance(raw_action.get("infra_requirements"), list) else []
        )
        cards.append(
            CapabilityCard(
                name=f"{skill_name}.{action_name}",
                description=skill_description,
                skill_id=skill_id,
                skill_name=skill_name,
                action_name=action_name,
                action_description=str(raw_action.get("description") or ""),
                infra_requirements=[str(item) for item in infra_requirements if str(item).strip()],
                parameters=[item for item in parameters if isinstance(item, dict)],
                display=_display_for_infra(infra_requirements),
                skill_dir=str(runtime_root),
                effect=_effect_value(raw_action.get("effect")),
            )
        )
    return cards


def _runtime_root(skill_root: Path) -> Path:
    return skill_runtime_dir(skill_root)


def _staged_skill_root(workspace_root: Path, skill_id: int) -> Path:
    staged = workspace_root.parent / "skills" / str(skill_id)
    return staged if staged.is_dir() else workspace_root / "skills" / str(skill_id)


def _display_for_infra(requirements: list[str]) -> dict[str, str]:
    sandbox = None
    for requirement in requirements:
        sandbox = sandbox_for_requirement(requirement)
        if sandbox:
            break
    if not sandbox:
        return {}
    sandbox_label = f"{sandbox} sandbox"
    return {
        "sandbox_label": sandbox_label,
        "sandbox_label_plural": f"{sandbox} sandboxes",
        "sandbox_ready_label": f"{sandbox_label} ready",
        "sandbox_releasing_label": f"Releasing {sandbox_label}",
        "sandbox_release_label": f"{sandbox_label} released",
        "environment_label": sandbox_label,
        "environment_group_label": sandbox_label,
    }


def _int_value(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _effect_value(value: Any) -> Literal["read", "mutate"] | None:
    text = str(value or "").strip().lower()
    if text == "read":
        return "read"
    if text == "mutate":
        return "mutate"
    return None
