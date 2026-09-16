"""Planning catalogue for capabilities backed by assigned sandbox types."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

from ..sandbox.types import SandboxType, normalize_sandbox_type
from .linux_workstation import linux_workstation_descriptors
from .descriptors import CapabilityDescriptor


@dataclass(frozen=True, slots=True)
class SandboxCapabilitySource:
    sandbox_type: str
    descriptors: Callable[[], tuple[CapabilityDescriptor, ...]]


_SANDBOX_CAPABILITY_SOURCES = (SandboxCapabilitySource(SandboxType.LINUX_WORKSTATION.value, linux_workstation_descriptors),)


def sandbox_capability_descriptors(assigned_sandbox_types: Iterable[str]) -> tuple[CapabilityDescriptor, ...]:
    assigned = frozenset(normalize_sandbox_type(value) for value in assigned_sandbox_types)
    return tuple(
        descriptor
        for source in _SANDBOX_CAPABILITY_SOURCES
        if source.sandbox_type in assigned
        for descriptor in source.descriptors()
    )


def sandbox_capability_provider_ids(assigned_sandbox_types: Iterable[str]) -> tuple[str, ...]:
    """Return provider namespaces made available by assigned sandbox types."""
    return tuple(dict.fromkeys(descriptor.provider_id for descriptor in sandbox_capability_descriptors(assigned_sandbox_types)))


def render_sandbox_delegation_section(assigned_sandbox_types: Iterable[str]) -> str:
    descriptors = sandbox_capability_descriptors(assigned_sandbox_types)
    if not descriptors:
        return ""
    lines = [
        "These sandbox capability namespaces are available to delegated sub-agents:",
        "- Delegate ordinary execution goals without selecting a namespace; preparation discovers capabilities backed "
        "by assigned sandboxes.",
        "- The sub-agent searches and invokes capabilities allowed by its human-defined profile; do not grant or select "
        "individual capabilities in the delegate request.",
        "- The runtime acquires an assigned compatible sandbox automatically. These are not direct chat tools.",
    ]
    namespaces: list[str] = []
    for descriptor in descriptors:
        parts = descriptor.capability_id.split(":")
        namespace = ":".join(parts[:2]) + ":**"
        if namespace not in namespaces:
            namespaces.append(namespace)
    lines.extend(f"- namespace: {namespace}" for namespace in namespaces)
    return "\n".join(lines)
