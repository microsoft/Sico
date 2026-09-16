"""Pure capability identifier and selector construction, normalization, and parsing."""

from __future__ import annotations

from dataclasses import dataclass

CAPABILITY_ID_SEPARATOR = ":"
CAPABILITY_SUBTREE_WILDCARD = "**"
BUILTIN_PROVIDER_ID = "builtin"
SKILL_PROVIDER_ID = "skill"
LINUX_WORKSTATION_PROVIDER_ID = "linux_workstation"

_LEGACY_LINUX_WORKSTATION_LOCAL_NAMES = {
    "shell_exec": "shell:exec",
    "mouse_click": "mouse:click",
    "mouse_move": "mouse:move",
    "mouse_scroll": "mouse:scroll",
    "keyboard_type": "keyboard:type",
    "keyboard_press": "keyboard:press",
    "browser_open_url": "browser:open_url",
    "browser_screenshot": "browser:screenshot",
    "file_export": "file:export",
    "file_read": "file:read",
    "file_write": "file:write",
    "file_list": "file:list",
}


def capability_id(provider_id: str, local_name: str) -> str:
    return f"{provider_id}{CAPABILITY_ID_SEPARATOR}{local_name}"


def builtin_capability_id(tool_name: str) -> str:
    return capability_id(BUILTIN_PROVIDER_ID, tool_name)


def skill_capability_id(skill_name: str, action_name: str = "") -> str:
    local = capability_id(skill_name, action_name) if action_name else skill_name
    return capability_id(SKILL_PROVIDER_ID, local)


def split_capability_id(value: str) -> tuple[str, str]:
    """Split a namespaced id on the first separator."""
    provider, separator, local = value.partition(CAPABILITY_ID_SEPARATOR)
    if not separator:
        return "", value
    return provider, local


def provider_of(value: str) -> str:
    return split_capability_id(value)[0]


def normalize_provider_id(value: str) -> str:
    return value.strip()


def normalize_capability_id(value: str) -> str:
    """Return one canonical executable ID, accepting legacy spellings."""
    text = (value or "").strip()
    if not text:
        return ""
    if CAPABILITY_SUBTREE_WILDCARD in text:
        raise ValueError(f"capability id must be exact, got selector {text!r}")
    if CAPABILITY_ID_SEPARATOR in text:
        provider, local = split_capability_id(text)
        normalized_provider = normalize_provider_id(provider)
        normalized_local = _normalize_local_name(normalized_provider, local)
        return capability_id(normalized_provider, normalized_local)
    if "." in text:
        skill_name, _, action_name = text.partition(".")
        return skill_capability_id(skill_name, action_name)
    return capability_id(BUILTIN_PROVIDER_ID, text)


def skill_action_of(value: str) -> tuple[str, str]:
    provider, local = split_capability_id(normalize_capability_id(value))
    if provider != SKILL_PROVIDER_ID or not local:
        return "", ""
    skill_name, _, action_name = local.partition(CAPABILITY_ID_SEPARATOR)
    return skill_name, action_name


def builtin_tool_of(value: str) -> str:
    provider, local = split_capability_id(normalize_capability_id(value))
    return local if provider == BUILTIN_PROVIDER_ID else ""


def _normalize_local_name(provider: str, local: str) -> str:
    if provider == SKILL_PROVIDER_ID and CAPABILITY_ID_SEPARATOR not in local and "." in local:
        skill_name, _, action_name = local.partition(".")
        return capability_id(skill_name, action_name)
    if provider == LINUX_WORKSTATION_PROVIDER_ID:
        return _LEGACY_LINUX_WORKSTATION_LOCAL_NAMES.get(local, local)
    return local


@dataclass(frozen=True, slots=True)
class CapabilitySelector:
    """An exact capability ID or one explicitly marked namespace subtree."""

    value: str
    namespace: tuple[str, ...]
    subtree: bool = False

    @property
    def provider_id(self) -> str:
        return self.namespace[0]

    def matches(self, capability: str) -> bool:
        parts = tuple(normalize_capability_id(capability).split(CAPABILITY_ID_SEPARATOR))
        if self.subtree:
            return len(parts) > len(self.namespace) and parts[: len(self.namespace)] == self.namespace
        return parts == self.namespace


def parse_capability_selector(value: str) -> CapabilitySelector:
    """Parse an exact ID or a terminal ``:**`` subtree selector."""
    text = (value or "").strip()
    if not text:
        raise ValueError("capability selector must not be empty")
    if CAPABILITY_ID_SEPARATOR not in text:
        raise ValueError(f"capability selector must be namespaced: {text!r}")
    raw_parts = text.split(CAPABILITY_ID_SEPARATOR)
    if any(not part.strip() for part in raw_parts):
        raise ValueError(f"capability selector contains an empty namespace segment: {text!r}")
    if any("*" in part and part != CAPABILITY_SUBTREE_WILDCARD for part in raw_parts):
        raise ValueError(f"capability selector supports only a terminal ':**': {text!r}")
    wildcard_indexes = [index for index, part in enumerate(raw_parts) if part == CAPABILITY_SUBTREE_WILDCARD]
    if wildcard_indexes:
        if wildcard_indexes != [len(raw_parts) - 1] or len(raw_parts) < 2:
            raise ValueError(f"capability selector supports only a terminal ':**': {text!r}")
        namespace = tuple(raw_parts[:-1])
        return CapabilitySelector(
            value=CAPABILITY_ID_SEPARATOR.join((*namespace, CAPABILITY_SUBTREE_WILDCARD)),
            namespace=namespace,
            subtree=True,
        )
    canonical = normalize_capability_id(text)
    namespace = tuple(canonical.split(CAPABILITY_ID_SEPARATOR))
    if len(namespace) < 2 or any(not part for part in namespace):
        raise ValueError(f"capability selector must be namespaced: {text!r}")
    return CapabilitySelector(value=canonical, namespace=namespace)


def normalize_capability_selector(value: str) -> str:
    return parse_capability_selector(value).value


def expand_capability_selectors(
    selectors: tuple[str, ...] | list[str],
    capability_ids: tuple[str, ...] | list[str],
) -> tuple[str, ...]:
    """Expand selectors to a deterministic, de-duplicated exact-ID snapshot."""
    parsed = tuple(parse_capability_selector(selector) for selector in selectors)
    expanded: list[str] = []
    seen: set[str] = set()
    for capability in capability_ids:
        canonical = normalize_capability_id(capability)
        if canonical in seen or not any(selector.matches(canonical) for selector in parsed):
            continue
        seen.add(canonical)
        expanded.append(canonical)
    return tuple(expanded)
