"""Single source of truth for the task runtime's sandbox vocabulary.

The runtime separates *what a task needs* from *how the platform delivers it*:

- :class:`SandboxOS` -- the operating-system *capability* a task requires. A
  skill declares it through ``infra_requirements`` (e.g. ``sandbox.android``),
  and the scheduler matches it against any sandbox that can supply that OS.
- :class:`SandboxType` -- the concrete *lease* types a task can end up running
    in (``emulator`` / ``wincua`` / ``aio`` / ``physical``). Several types may
    satisfy one OS, so the type is an outcome of scheduling, not an input to it.
- :data:`INFRA_TO_OS` -- the authoritative map from a skill's
  ``infra_requirements`` token to the OS capability it needs.

A reservation is made against an **OS selector** (the value of
:func:`sandbox_for_requirement`); the backend expands that to every eligible
type and returns a lease tagged with the concrete type it actually acquired. The
selector travels over the existing gRPC ``type`` field — OS names and type names
are disjoint, so one string is unambiguous and the contract is unchanged.

Every value returned from this module is a plain ``str`` (the enums subclass
``str``) so it drops into the existing ``Literal[...]`` field contracts and the
gRPC boundary unchanged.
"""

from __future__ import annotations

from enum import StrEnum


class SandboxOS(StrEnum):
    """Operating-system capabilities a task can require of a sandbox."""

    WINDOWS = "windows"
    MACOS = "macos"
    IOS = "ios"
    ANDROID = "android"
    LINUX = "linux"


class SandboxType(StrEnum):
    """Concrete sandbox lease types a task can run in."""

    EMULATOR = "emulator"
    WINCUA = "wincua"
    AIO = "aio"
    PHYSICAL = "physical"


class InfraRequirement(StrEnum):
    """Skill-registry ``infra_requirements`` tokens that imply a sandbox lease.

    One ``sandbox.<os>`` token per :class:`SandboxOS`. A skill declares the OS it
    needs; the scheduler resolves it to whichever concrete type has a free
    machine.
    """

    ANDROID = "sandbox.android"
    WINDOWS = "sandbox.windows"
    MACOS = "sandbox.macos"
    IOS = "sandbox.ios"
    LINUX = "sandbox.linux"


#: Concrete lease values, e.g. for membership checks and per-type rendering.
SANDBOX_TYPES: tuple[str, ...] = tuple(member.value for member in SandboxType)

#: OS capability values, the selectors a reservation can be made against.
SANDBOX_OSES: tuple[str, ...] = tuple(member.value for member in SandboxOS)

#: Every accepted reservation/lease selector: an OS capability or a concrete
#: type. Used to validate values that may sit on either side of the boundary.
SANDBOX_SELECTORS: tuple[str, ...] = SANDBOX_OSES + SANDBOX_TYPES

#: Authoritative map: a skill's infra requirement -> the OS capability it needs.
INFRA_TO_OS: dict[str, str] = {
    InfraRequirement.ANDROID.value: SandboxOS.ANDROID.value,
    InfraRequirement.WINDOWS.value: SandboxOS.WINDOWS.value,
    InfraRequirement.MACOS.value: SandboxOS.MACOS.value,
    InfraRequirement.IOS.value: SandboxOS.IOS.value,
    InfraRequirement.LINUX.value: SandboxOS.LINUX.value,
}

#: The OS each fixed-OS type always provides.
TYPE_OS: dict[str, str] = {
    SandboxType.EMULATOR.value: SandboxOS.ANDROID.value,
    SandboxType.WINCUA.value: SandboxOS.WINDOWS.value,
    SandboxType.AIO.value: SandboxOS.LINUX.value,
}


def eligible_types_for_os(os: str) -> tuple[str, ...]:
    """Return the concrete types that can supply *os*, in scheduling-priority order.

    Fixed-OS types come first and ``physical`` last: a managed, disposable pool
    is preferred over a real person's machine. Derived from :data:`TYPE_OS`, so
    declaring a new type's OS automatically enrolls it.
    """
    fixed = [t for t in SANDBOX_TYPES if t != SandboxType.PHYSICAL.value and TYPE_OS.get(t) == os]
    return (*fixed, SandboxType.PHYSICAL.value)


def lease_type_from_sandbox_id(sandbox_id: str) -> str | None:
    """Extract the concrete sandbox type from a ``{type}:{resourceID}`` id.

    Backend leases are keyed ``{type}:{resourceID}``; the prefix is the concrete
    type actually acquired. Returns ``None`` when the id has no recognizable type
    prefix so the caller can fall back.
    """
    prefix = sandbox_id.split(":", 1)[0].strip()
    return prefix if prefix in SANDBOX_TYPES else None


#: Advisory hint aliases mapped to an OS selector. Derived from every OS name
#: and every infra token, so an OS name or a ``sandbox.<os>`` token both resolve
#: to the OS; anything else collapses to ``""``.
_HINT_ALIASES: dict[str, str] = {
    **{member.value: member.value for member in SandboxOS},
    **INFRA_TO_OS,
}


def sandbox_for_requirement(requirement: str) -> str | None:
    """Return the OS selector a skill infra requirement reserves against.

    ``None`` when the requirement does not map to a sandbox. The returned value
    is an OS capability (e.g. ``android``); the backend resolves it to whichever
    concrete sandbox type has a free machine.
    """
    return INFRA_TO_OS.get(requirement)


def normalize_sandbox_hint(value: str | None) -> str:
    """Coerce an advisory sandbox hint to an OS selector or ``""``.

    Unknown hints collapse to ``""`` instead of raising so a stray value never
    fails a whole batch; for skill tasks the runtime still derives the real
    requirement from the skill's ``infra_requirements``.
    """
    return _HINT_ALIASES.get((value or "").strip().lower(), "")


__all__ = [
    "INFRA_TO_OS",
    "SANDBOX_OSES",
    "SANDBOX_SELECTORS",
    "SANDBOX_TYPES",
    "TYPE_OS",
    "InfraRequirement",
    "SandboxOS",
    "SandboxType",
    "eligible_types_for_os",
    "lease_type_from_sandbox_id",
    "normalize_sandbox_hint",
    "sandbox_for_requirement",
]
