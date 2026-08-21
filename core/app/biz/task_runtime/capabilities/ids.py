"""Pure capability identifier construction, normalization, and parsing."""

CAPABILITY_ID_SEPARATOR = ":"
BUILTIN_PROVIDER_ID = "builtin"
SKILL_PROVIDER_ID = "skill"


def capability_id(provider_id: str, local_name: str) -> str:
    return f"{provider_id}{CAPABILITY_ID_SEPARATOR}{local_name}"


def builtin_capability_id(tool_name: str) -> str:
    return capability_id(BUILTIN_PROVIDER_ID, tool_name)


def skill_capability_id(skill_name: str, action_name: str = "") -> str:
    local = f"{skill_name}.{action_name}" if action_name else skill_name
    return capability_id(SKILL_PROVIDER_ID, local)


def split_capability_id(value: str) -> tuple[str, str]:
    """Split a namespaced id on the first separator."""
    provider, separator, local = value.partition(CAPABILITY_ID_SEPARATOR)
    if not separator:
        return "", value
    return provider, local


def provider_of(value: str) -> str:
    return split_capability_id(value)[0]


def normalize_capability_id(value: str) -> str:
    """Map a bare builtin or dotted skill action onto its namespaced id."""
    text = (value or "").strip()
    if not text:
        return ""
    if CAPABILITY_ID_SEPARATOR in text:
        return text
    if "." in text:
        return capability_id(SKILL_PROVIDER_ID, text)
    return capability_id(BUILTIN_PROVIDER_ID, text)


def skill_action_of(value: str) -> tuple[str, str]:
    provider, local = split_capability_id(normalize_capability_id(value))
    if provider != SKILL_PROVIDER_ID or not local:
        return "", ""
    skill_name, _, action_name = local.partition(".")
    return skill_name, action_name


def builtin_tool_of(value: str) -> str:
    provider, local = split_capability_id(normalize_capability_id(value))
    return local if provider == BUILTIN_PROVIDER_ID else ""
