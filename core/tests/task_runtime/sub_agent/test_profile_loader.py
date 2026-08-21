from __future__ import annotations

from pathlib import Path

import pytest

from app.biz.task_runtime.sub_agent.profile import (
    ALL_CAPABILITIES,
    AcceptModelCompletionPolicy,
    ProfileQuery,
)
from app.biz.task_runtime.sub_agent.profile_loader import (
    AgentProfileConfigError,
    AgentProfileConfigLoader,
    clear_agent_profile_resolver_cache,
    default_agent_profile_resolver,
    resolve_agent_profile_dir,
)

_REPOSITORY_PROFILE_DIR = (
    Path(__file__).resolve().parents[4]
    / "deploy"
    / "config"
    / "task_runtime"
    / "sub_agent"
    / "profiles"
)


def _write_profile(
    root: Path,
    profile_id: str,
    *,
    schema_version: str = "1",
    when_to_use: str | None = None,
    ceiling: str = '"*"',
    completion_type: str = "accept_model",
    body: str = "",
    extra: str = "",
) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{profile_id}.md"
    guidance = when_to_use if when_to_use is not None else f"Use {profile_id}."
    path.write_text(
        "\n".join(
            (
                "---",
                f"schema_version: {schema_version}",
                f"profile_id: {profile_id}",
                f"when_to_use: {guidance}",
                f"capability_ceiling: {ceiling}",
                "invocation_policies: []",
                "completion_policy:",
                f"  type: {completion_type}",
                extra,
                "---",
                body,
            )
        ),
        encoding="utf-8",
    )
    return path


def test_repository_default_profile_preserves_hardcoded_behavior() -> None:
    resolver = AgentProfileConfigLoader(_REPOSITORY_PROFILE_DIR).load().build_resolver()

    profile = resolver.resolve("default")
    assert profile is not None
    assert profile.system_prompt == ""
    assert profile.capability_ceiling == ALL_CAPABILITIES
    assert profile.invocation_policies == ()
    assert isinstance(profile.completion_policy, AcceptModelCompletionPolicy)
    descriptors = {descriptor.profile_id: descriptor for descriptor in resolver.list_profiles(query=ProfileQuery())}
    descriptor = descriptors["default"]
    assert descriptor.profile_id == "default"
    assert descriptor.when_to_use == "General multi-step tasks that require a bounded capability loop."


def test_repository_profile_template_is_ignored_and_copyable(tmp_path: Path) -> None:
    template = _REPOSITORY_PROFILE_DIR / "profile-template.md.example"
    repository_catalog = AgentProfileConfigLoader(_REPOSITORY_PROFILE_DIR).load()

    assert template.is_file()
    assert template.name not in {source.name for source in repository_catalog.sources}

    root = tmp_path / "profiles"
    _write_profile(root, "default")
    root.joinpath("example-profile.md").write_text(template.read_text(encoding="utf-8"), encoding="utf-8")

    copied_catalog = AgentProfileConfigLoader(root).load()

    assert copied_catalog.profiles["example-profile"].system_prompt == (
        "# System prompt\n\n"
        "You are a focused sub-agent for this domain. Follow the task instructions,\n"
        "stay within the available capabilities, and report uncertainty explicitly."
    )


def test_profile_dir_resolution_uses_repository_default() -> None:
    assert resolve_agent_profile_dir() == _REPOSITORY_PROFILE_DIR


def test_loader_compiles_markdown_body_and_namespaced_ceiling(tmp_path: Path) -> None:
    root = tmp_path / "profiles"
    _write_profile(root, "default")
    _write_profile(root, "research", ceiling='["builtin:echo", "skill:web-search.run"]', body="Research carefully.\n")

    catalog = AgentProfileConfigLoader(root).load()

    assert list(catalog.profiles) == ["default", "research"]
    assert catalog.profiles["research"].system_prompt == "Research carefully."
    assert catalog.profiles["research"].capability_ceiling == frozenset(
        ("builtin:echo", "skill:web-search.run")
    )
    assert [path.name for path in catalog.sources] == ["default.md", "research.md"]


def test_loader_accepts_utf8_bom(tmp_path: Path) -> None:
    root = tmp_path / "profiles"
    source = _write_profile(root, "default")
    source.write_bytes(b"\xef\xbb\xbf" + source.read_bytes())

    catalog = AgentProfileConfigLoader(root).load()

    assert catalog.profiles["default"].profile_id == "default"


def test_loader_preserves_empty_ceiling_as_reasoning_only_profile(tmp_path: Path) -> None:
    root = tmp_path / "profiles"
    _write_profile(root, "default")
    _write_profile(root, "reasoning-only", ceiling="[]")

    catalog = AgentProfileConfigLoader(root).load()

    assert catalog.profiles["reasoning-only"].capability_ceiling == frozenset()
    assert catalog.descriptors["reasoning-only"].capability_ceiling == frozenset()


@pytest.mark.parametrize(
    ("profile_id", "ceiling", "completion_type", "match"),
    [
        ("Default", '"*"', "accept_model", "profile_id"),
        ("default", '["echo"]', "accept_model", "namespaced"),
        ("default", '"*"', "unknown", "unknown completion policy"),
    ],
)
def test_loader_rejects_invalid_profile_fields(
    tmp_path: Path,
    profile_id: str,
    ceiling: str,
    completion_type: str,
    match: str,
) -> None:
    root = tmp_path / "profiles"
    _write_profile(root, profile_id, ceiling=ceiling, completion_type=completion_type)

    with pytest.raises(AgentProfileConfigError, match=match):
        AgentProfileConfigLoader(root).load()


def test_loader_rejects_missing_default_and_duplicate_ids(tmp_path: Path) -> None:
    missing_default = tmp_path / "missing"
    _write_profile(missing_default, "research")
    with pytest.raises(AgentProfileConfigError, match="must define 'default'"):
        AgentProfileConfigLoader(missing_default).load()

    duplicate = tmp_path / "duplicate"
    first = _write_profile(duplicate / "one", "default")
    second = _write_profile(duplicate / "two", "default")
    assert first.name == second.name
    with pytest.raises(AgentProfileConfigError, match="duplicate profile_id"):
        AgentProfileConfigLoader(duplicate).load()


def test_loader_rejects_missing_and_empty_directories(tmp_path: Path) -> None:
    missing = tmp_path / "missing"
    with pytest.raises(FileNotFoundError, match="missing task-runtime profile directory"):
        AgentProfileConfigLoader(missing).load()

    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(AgentProfileConfigError, match="no profile definitions"):
        AgentProfileConfigLoader(empty).load()


def test_loader_rejects_symlinked_profile(tmp_path: Path) -> None:
    root = tmp_path / "profiles"
    target = _write_profile(root, "default")
    symlink = root / "linked.md"
    try:
        symlink.symlink_to(target)
    except OSError:
        pytest.skip("symlink creation is unavailable")

    with pytest.raises(AgentProfileConfigError, match="must not be symlinks"):
        AgentProfileConfigLoader(root).load()


def test_loader_rejects_oversized_profile_file(tmp_path: Path) -> None:
    root = tmp_path / "profiles"
    _write_profile(root, "default", body="x" * (64 * 1024))

    with pytest.raises(AgentProfileConfigError, match="exceeds 65536 bytes"):
        AgentProfileConfigLoader(root).load()


def test_loader_rejects_type_coercion_and_duplicate_frontmatter_keys(tmp_path: Path) -> None:
    coerced = tmp_path / "coerced"
    _write_profile(coerced, "default", schema_version="true")
    with pytest.raises(AgentProfileConfigError, match="schema_version"):
        AgentProfileConfigLoader(coerced).load()

    duplicate = tmp_path / "duplicate-key"
    _write_profile(duplicate, "default", extra="profile_id: research")
    with pytest.raises(AgentProfileConfigError, match="duplicate key 'profile_id'"):
        AgentProfileConfigLoader(duplicate).load()


def test_loader_rejects_catalogs_over_resource_bounds(tmp_path: Path) -> None:
    too_many = tmp_path / "too-many"
    _write_profile(too_many, "default")
    for index in range(64):
        _write_profile(too_many, f"profile-{index:02d}")
    with pytest.raises(AgentProfileConfigError, match="exceeds 64 profiles"):
        AgentProfileConfigLoader(too_many).load()

    too_large = tmp_path / "too-large"
    _write_profile(too_large, "default", body="x" * 60_000)
    for index in range(17):
        _write_profile(too_large, f"profile-{index:02d}", body="x" * 60_000)
    with pytest.raises(AgentProfileConfigError, match="exceeds 1048576 bytes"):
        AgentProfileConfigLoader(too_large).load()

    too_much_metadata = tmp_path / "too-much-metadata"
    _write_profile(too_much_metadata, "default")
    for index in range(17):
        _write_profile(
            too_much_metadata,
            f"profile-{index:02d}",
            when_to_use="\\" * 1000,
        )
    with pytest.raises(AgentProfileConfigError, match="serialized planner metadata exceeds 32768 characters"):
        AgentProfileConfigLoader(too_much_metadata).load()


def test_default_resolver_keeps_one_process_snapshot() -> None:
    clear_agent_profile_resolver_cache()

    first = default_agent_profile_resolver()
    second = default_agent_profile_resolver()

    assert first is second
