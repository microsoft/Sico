"""Catalogue projections: source metadata → :class:`CapabilityDescriptor`.

Both the *runtime* (through each provider's ``list_descriptors``) and the
*planner* (which must know what it may pick before anything is executable) need
the same view of a capability. Keeping the projection here means there is one
place per source where a descriptor is built, so the two views cannot drift —
which is precisely how the builtin and skill catalogues came to disagree about
even how a capability is *named*.

The projections are pure: they take source metadata and return descriptors. That
is what lets the planner reuse them without dragging in artifact storage or a
command backend it has no business constructing.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING, Any

from .tool_catalog import RUNTIME_TOOLS, RuntimeTool
from .descriptors import CapabilityDescriptor
from .ids import (
    builtin_capability_id,
    normalize_capability_id,
    skill_capability_id,
)

if TYPE_CHECKING:
    from .loader import CapabilityCard

_PARAMETER_SCHEMA_KEYS = frozenset(
    (
        "type",
        "enum",
        "const",
        "default",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minLength",
        "maxLength",
        "pattern",
        "format",
        "items",
        "minItems",
        "maxItems",
        "uniqueItems",
        "x-sico-binding",
    )
)


def builtin_descriptor(tool: RuntimeTool) -> CapabilityDescriptor:
    """Project one builtin tool entry onto a descriptor."""
    return CapabilityDescriptor(
        capability_id=builtin_capability_id(tool.name),
        parameter_schema=tool.parameter_schema,
        required_sandbox=(),
        workspace_access=tool.workspace_access,
        effect=tool.effect,
        description=tool.usage,
    )


def builtin_descriptors(names: Iterable[str] | None = None) -> tuple[CapabilityDescriptor, ...]:
    """The builtin catalogue, optionally narrowed to ``names``.

    ``names`` accepts either bare tool names or already-namespaced ids, since
    callers on the planning side may hold either.
    """
    descriptors = tuple(builtin_descriptor(tool) for tool in RUNTIME_TOOLS)
    if names is None:
        return descriptors
    wanted = {normalize_capability_id(name) for name in names if name.strip()}
    return tuple(descriptor for descriptor in descriptors if descriptor.capability_id in wanted)


def skill_descriptor(card: "CapabilityCard") -> CapabilityDescriptor:
    """Project one executable capability card onto a descriptor."""
    return CapabilityDescriptor(
        capability_id=skill_capability_id(card.skill_name, card.action_name),
        parameter_schema=_skill_parameter_schema(card),
        required_sandbox=tuple(card.sandbox_options),  # type: ignore[arg-type]
        # Skill actions read and write the shared workspace; their durable
        # deliverables additionally land in the per-run result directory.
        workspace_access="read_write",
        # Fail closed: a skill that never declared its effect is assumed to
        # change external state. The default belongs here, in the projection,
        # and never on the descriptor itself.
        effect=card.effect or "mutate",
        description=card.action_description or card.description,
        when_to_use=card.when_to_use,
        visibility=card.visibility,
    )


def skill_descriptors(cards: Iterable["CapabilityCard"]) -> tuple[CapabilityDescriptor, ...]:
    """The skill catalogue: executable cards only.

    Prose-only entries are deliberately absent. They are knowledge for a reader,
    not something the runtime can invoke, and listing them would invite a planner
    to dispatch a workflow that has no entry point.
    """
    return tuple(skill_descriptor(card) for card in cards if card.is_executable)


def _skill_parameter_schema(card: "CapabilityCard") -> dict[str, Any]:
    properties: dict[str, Any] = {}
    required: list[str] = []
    for parameter in card.parameters:
        if not isinstance(parameter, dict):
            continue
        name = str(parameter.get("name") or "").strip()
        if not name:
            continue
        node: dict[str, Any] = {key: parameter[key] for key in _PARAMETER_SCHEMA_KEYS if key in parameter}
        node.setdefault("type", "string")
        if description := str(parameter.get("description") or "").strip():
            node["description"] = description
        if parameter.get("sensitive") is True:
            node["sensitive"] = True
        properties[name] = node
        if parameter.get("required") is True:
            required.append(name)
    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema
