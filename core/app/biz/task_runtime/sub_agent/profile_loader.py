"""Load immutable sub-agent profile catalogs from Markdown definitions."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from yaml.constructor import ConstructorError
from yaml.nodes import MappingNode
from yaml.resolver import BaseResolver

from ..capabilities.ids import split_capability_id
from .profile import (
    ALL_CAPABILITIES,
    AcceptModelCompletionPolicy,
    AgentProfile,
    CompletionPolicy,
    InvocationPolicy,
    ProfileDescriptor,
    ProfileVisibilityPolicy,
    StaticAgentProfileResolver,
    profile_descriptor_payload,
)

_LOGGER = logging.getLogger(__name__)

_DEFAULT_PROFILE_ID = "default"
_MAX_PROFILE_COUNT = 64
_MAX_PROFILE_BYTES = 64 * 1024
_MAX_PROFILE_CATALOG_BYTES = 1024 * 1024
_MAX_PLANNER_METADATA_JSON_CHARS = 32 * 1024
_MAX_WHEN_TO_USE_CHARS = 1536
_PROFILE_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62})$")
_PROFILE_CONFIG_RELATIVE_DIR = Path("config", "task_runtime", "sub_agent", "profiles")


class _UniqueKeySafeLoader(yaml.SafeLoader):
    pass


def _construct_unique_mapping(
    loader: yaml.SafeLoader,
    node: MappingNode,
    deep: bool = False,
) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found unhashable key {key!r}",
                key_node.start_mark,
            ) from exc
        if duplicate:
            raise ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeySafeLoader.add_constructor(BaseResolver.DEFAULT_MAPPING_TAG, _construct_unique_mapping)


class AgentProfileConfigError(ValueError):
    """A profile directory cannot be compiled into one valid catalog."""


class PolicyDefinition(BaseModel):
    """Stable policy tag plus JSON-compatible construction parameters."""

    model_config = ConfigDict(extra="forbid", strict=True)

    type: str
    parameters: dict[str, Any] = Field(default_factory=dict)

    @field_validator("type")
    @classmethod
    def _type_not_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("policy type must not be empty")
        return normalized


class AgentProfileDefinition(BaseModel):
    """Strict YAML-frontmatter schema for one profile Markdown file."""

    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: Literal[1]
    profile_id: str
    when_to_use: str
    capability_ceiling: Literal["*"] | list[str]
    invocation_policies: list[PolicyDefinition] = Field(default_factory=list)
    completion_policy: PolicyDefinition

    @field_validator("schema_version", mode="before")
    @classmethod
    def _schema_version_is_integer_one(cls, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, int) or value != 1:
            raise ValueError("schema_version must be the integer 1")
        return value

    @field_validator("profile_id")
    @classmethod
    def _valid_profile_id(cls, value: str) -> str:
        normalized = value.strip()
        if not _PROFILE_ID_PATTERN.fullmatch(normalized):
            raise ValueError("profile_id must contain only lowercase letters, digits, and hyphens")
        return normalized

    @field_validator("when_to_use")
    @classmethod
    def _valid_when_to_use(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("when_to_use must not be empty")
        if len(normalized) > _MAX_WHEN_TO_USE_CHARS:
            raise ValueError(f"when_to_use must not exceed {_MAX_WHEN_TO_USE_CHARS} characters")
        return normalized

    @field_validator("capability_ceiling")
    @classmethod
    def _valid_capability_ceiling(cls, value: Literal["*"] | list[str]) -> Literal["*"] | list[str]:
        if value == ALL_CAPABILITIES:
            return value
        normalized: list[str] = []
        seen: set[str] = set()
        for capability_id in value:
            capability_id = capability_id.strip()
            provider, local_name = split_capability_id(capability_id)
            if not provider or not local_name:
                raise ValueError(f"capability ceiling entry must be namespaced: {capability_id!r}")
            if capability_id in seen:
                raise ValueError(f"duplicate capability ceiling entry: {capability_id!r}")
            normalized.append(capability_id)
            seen.add(capability_id)
        return normalized


@dataclass(frozen=True, slots=True)
class AgentProfileCatalog:
    """One atomically loaded planning/execution snapshot."""

    profiles: Mapping[str, AgentProfile]
    descriptors: Mapping[str, ProfileDescriptor]
    sources: tuple[Path, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "profiles", MappingProxyType(dict(self.profiles)))
        object.__setattr__(self, "descriptors", MappingProxyType(dict(self.descriptors)))

    def build_resolver(
        self,
        visibility_policy: ProfileVisibilityPolicy | None = None,
    ) -> StaticAgentProfileResolver:
        return StaticAgentProfileResolver(
            self.profiles,
            descriptors=self.descriptors,
            visibility_policy=visibility_policy,
        )


CompletionPolicyBuilder = Callable[[Mapping[str, Any]], CompletionPolicy]
InvocationPolicyBuilder = Callable[[Mapping[str, Any]], InvocationPolicy]


def _accept_model_policy(parameters: Mapping[str, Any]) -> CompletionPolicy:
    if parameters:
        raise ValueError("accept_model completion policy accepts no parameters")
    return AcceptModelCompletionPolicy()


_COMPLETION_POLICY_BUILDERS: Mapping[str, CompletionPolicyBuilder] = MappingProxyType(
    {"accept_model": _accept_model_policy}
)
_INVOCATION_POLICY_BUILDERS: Mapping[str, InvocationPolicyBuilder] = MappingProxyType({})


class AgentProfileConfigLoader:
    """Compile every ``*.md`` below one directory into a fail-closed catalog."""

    def __init__(self, config_dir: Path | str) -> None:
        self.config_dir = Path(config_dir)

    def load(self) -> AgentProfileCatalog:
        root = self.config_dir.resolve()
        if not root.is_dir():
            raise FileNotFoundError(f"missing task-runtime profile directory: {root}")
        sources = tuple(sorted(root.rglob("*.md"), key=lambda path: path.relative_to(root).as_posix()))
        if not sources:
            raise AgentProfileConfigError(f"no profile definitions found under {root}")
        if len(sources) > _MAX_PROFILE_COUNT:
            raise AgentProfileConfigError(
                f"profile catalog exceeds {_MAX_PROFILE_COUNT} profiles under {root}"
            )

        profiles: dict[str, AgentProfile] = {}
        descriptors: dict[str, ProfileDescriptor] = {}
        catalog_bytes = 0
        for source in sources:
            definition, system_prompt, source_bytes = self._load_definition(root, source)
            catalog_bytes += source_bytes
            if catalog_bytes > _MAX_PROFILE_CATALOG_BYTES:
                raise AgentProfileConfigError(
                    f"profile catalog exceeds {_MAX_PROFILE_CATALOG_BYTES} bytes under {root}"
                )
            if definition.profile_id in profiles:
                raise AgentProfileConfigError(f"duplicate profile_id {definition.profile_id!r} in {source}")
            ceiling = (
                ALL_CAPABILITIES
                if definition.capability_ceiling == ALL_CAPABILITIES
                else frozenset(definition.capability_ceiling)
            )
            try:
                profile = AgentProfile(
                    profile_id=definition.profile_id,
                    system_prompt=system_prompt,
                    capability_ceiling=ceiling,
                    invocation_policies=tuple(
                        _compile_invocation_policy(policy) for policy in definition.invocation_policies
                    ),
                    completion_policy=_compile_completion_policy(definition.completion_policy),
                )
            except (TypeError, ValueError) as exc:
                raise AgentProfileConfigError(f"invalid profile {source}: {exc}") from exc
            profiles[profile.profile_id] = profile
            descriptors[profile.profile_id] = ProfileDescriptor(
                profile_id=profile.profile_id,
                when_to_use=definition.when_to_use,
                capability_ceiling=profile.capability_ceiling,
            )

        planner_metadata_json = json.dumps(
            {"sub_agent_profiles": [profile_descriptor_payload(descriptor) for descriptor in descriptors.values()]},
            ensure_ascii=False,
            indent=2,
        )
        if len(planner_metadata_json) > _MAX_PLANNER_METADATA_JSON_CHARS:
            raise AgentProfileConfigError(
                f"profile catalog serialized planner metadata exceeds "
                f"{_MAX_PLANNER_METADATA_JSON_CHARS} characters under {root}"
            )
        if _DEFAULT_PROFILE_ID not in profiles:
            raise AgentProfileConfigError(f"profile catalog must define {_DEFAULT_PROFILE_ID!r}")
        _LOGGER.info(
            "task_runtime profiles loaded directory=%s profiles=%s",
            root,
            sorted(profiles),
        )
        return AgentProfileCatalog(profiles=profiles, descriptors=descriptors, sources=sources)

    @staticmethod
    def _load_definition(root: Path, source: Path) -> tuple[AgentProfileDefinition, str, int]:
        try:
            if source.is_symlink():
                raise AgentProfileConfigError(f"profile definitions must not be symlinks: {source}")
            resolved = source.resolve(strict=True)
            if not resolved.is_relative_to(root):
                raise AgentProfileConfigError(f"profile definition escapes the configured directory: {source}")
            source_bytes = source.stat().st_size
        except AgentProfileConfigError:
            raise
        except (OSError, RuntimeError) as exc:
            raise AgentProfileConfigError(f"cannot inspect profile definition {source}: {exc}") from exc
        if source_bytes > _MAX_PROFILE_BYTES:
            raise AgentProfileConfigError(f"profile definition exceeds {_MAX_PROFILE_BYTES} bytes: {source}")
        try:
            frontmatter, system_prompt = _split_markdown_profile(source.read_text(encoding="utf-8-sig"))
            definition = AgentProfileDefinition.model_validate(_safe_load_unique_keys(frontmatter) or {})
        except (OSError, UnicodeError, yaml.YAMLError, ValidationError, ValueError) as exc:
            raise AgentProfileConfigError(f"invalid profile definition {source}: {exc}") from exc
        if source.stem != definition.profile_id:
            raise AgentProfileConfigError(
                f"profile filename {source.name!r} must match profile_id {definition.profile_id!r}"
            )
        return definition, system_prompt.strip(), source_bytes


def _split_markdown_profile(content: str) -> tuple[str, str]:
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("profile must start with YAML frontmatter")
    try:
        boundary = next(index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---")
    except StopIteration as exc:
        raise ValueError("profile YAML frontmatter is not closed") from exc
    return "\n".join(lines[1:boundary]), "\n".join(lines[boundary + 1 :])


def _safe_load_unique_keys(content: str) -> Any:
    loader = _UniqueKeySafeLoader(content)
    try:
        return loader.get_single_data()
    finally:
        loader.dispose()


def _compile_invocation_policy(definition: PolicyDefinition) -> InvocationPolicy:
    builder = _INVOCATION_POLICY_BUILDERS.get(definition.type)
    if builder is None:
        raise ValueError(f"unknown invocation policy type {definition.type!r}")
    return builder(definition.parameters)


def _compile_completion_policy(definition: PolicyDefinition) -> CompletionPolicy:
    builder = _COMPLETION_POLICY_BUILDERS.get(definition.type)
    if builder is None:
        raise ValueError(f"unknown completion policy type {definition.type!r}")
    return builder(definition.parameters)


def resolve_agent_profile_dir() -> Path:
    core_root = Path(__file__).resolve().parents[4]
    packaged = core_root / _PROFILE_CONFIG_RELATIVE_DIR
    if packaged.is_dir():
        return packaged
    return core_root.parent / "deploy" / _PROFILE_CONFIG_RELATIVE_DIR


@lru_cache(maxsize=1)
def default_agent_profile_resolver() -> StaticAgentProfileResolver:
    """Return the process-cached immutable resolver for the default profile catalog."""
    return AgentProfileConfigLoader(resolve_agent_profile_dir()).load().build_resolver()


def clear_agent_profile_resolver_cache() -> None:
    """Clear the process cache. Intended for tests before changing profile files."""
    default_agent_profile_resolver.cache_clear()
