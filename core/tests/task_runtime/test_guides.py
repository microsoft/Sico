from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from app.biz.task_runtime.guides import (
    MAX_SKILL_GUIDE_BYTES,
    SkillGuideRef,
    SkillGuideRegistry,
    build_skill_prompt_section,
    project_guides_into_workspace,
    render_activated_guides,
)
from app.biz.task_runtime.workspace.layout import reset_workspace_layout, set_workspace_layout


class _FakeWorkspaceLayout:
    def __init__(self, skill_root: Path) -> None:
        self._skill_root = skill_root

    def skill_roots(self, *, project_id: int = 0, agent_id: str = "", agent_instance_id: int = 0):
        return [("agent", agent_id, self._skill_root / "agent" / agent_id)]


def _write_version(skill_base: Path, version: str, marker: str) -> None:
    cortex = skill_base / "versions" / version / "resolved" / "cortex"
    cortex.mkdir(parents=True)
    (cortex / "SKILL.md").write_text(
        f"---\nname: docs\ndescription: Documentation workflow.\n---\n# Workflow\n{marker}\n" + ("Follow this step. " * 30),
        encoding="utf-8",
    )


def test_guide_registry_resolves_pinned_version_after_current_changes(tmp_path: Path, request) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(
        json.dumps([{"id": 100, "name": "docs", "description": "Documentation workflow."}]),
        encoding="utf-8",
    )
    skill_base = tmp_path / "persisted" / "agent" / "agent-1" / "100"
    _write_version(skill_base, "v1", "VERSION_ONE")
    _write_version(skill_base, "v2", "VERSION_TWO")
    skill_base.mkdir(parents=True, exist_ok=True)
    (skill_base / "current_version.txt").write_text("v1", encoding="utf-8")
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "persisted"))
    request.addfinalizer(lambda: reset_workspace_layout(token))
    registry = SkillGuideRegistry(workspace, agent_id="agent-1")

    descriptor = registry.list_guides()[0]
    (skill_base / "current_version.txt").write_text("v2", encoding="utf-8")
    guide = registry.resolve(descriptor.ref)

    assert descriptor.ref.version == "v1"
    assert "VERSION_ONE" in guide.content
    assert "VERSION_TWO" not in guide.content


def test_guide_registry_rejects_content_hash_mismatch(tmp_path: Path, request) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(json.dumps([{"id": 100, "name": "docs"}]), encoding="utf-8")
    skill_base = tmp_path / "persisted" / "agent" / "agent-1" / "100"
    _write_version(skill_base, "v1", "VERSION_ONE")
    skill_base.mkdir(parents=True, exist_ok=True)
    (skill_base / "current_version.txt").write_text("v1", encoding="utf-8")
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "persisted"))
    request.addfinalizer(lambda: reset_workspace_layout(token))
    registry = SkillGuideRegistry(workspace, agent_id="agent-1")

    ref = registry.list_guides()[0].ref.model_copy(update={"content_hash": "0" * 64})

    with pytest.raises(ValueError, match="content hash mismatch"):
        registry.resolve(ref)


def test_guide_registry_activates_only_exact_leading_slash_names(tmp_path: Path, request) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(json.dumps([{"id": 100, "name": "docs"}]), encoding="utf-8")
    skill_base = tmp_path / "persisted" / "agent" / "agent-1" / "100"
    _write_version(skill_base, "v1", "EXPLICIT_GUIDE_MARKER")
    skill_base.mkdir(parents=True, exist_ok=True)
    (skill_base / "current_version.txt").write_text("v1", encoding="utf-8")
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "persisted"))
    request.addfinalizer(lambda: reset_workspace_layout(token))
    registry = SkillGuideRegistry(workspace, agent_id="agent-1")

    activated = registry.activate_explicit("  /docs answer the question")
    prompt_section, refs = build_skill_prompt_section("CATALOGUE", registry, activated)

    assert len(activated) == 1
    rendered = render_activated_guides(activated)
    assert "EXPLICIT_GUIDE_MARKER" in rendered
    assert "instruction/cortex resources only" in rendered
    assert "do not reconstruct a guide script call" in rendered
    assert "CATALOGUE" in prompt_section
    assert "EXPLICIT_GUIDE_MARKER" in prompt_section
    assert refs == (activated[0].descriptor.ref,)
    assert registry.activate_explicit("Please use docs to answer") == ()
    assert registry.activate_explicit("/unknown /docs answer") == ()


def test_guide_registry_rejects_missing_pinned_version(tmp_path: Path, request) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(json.dumps([{"id": 100, "name": "docs"}]), encoding="utf-8")
    skill_base = tmp_path / "persisted" / "agent" / "agent-1" / "100"
    _write_version(skill_base, "v1", "VERSION_ONE")
    skill_base.mkdir(parents=True, exist_ok=True)
    (skill_base / "current_version.txt").write_text("v1", encoding="utf-8")
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "persisted"))
    request.addfinalizer(lambda: reset_workspace_layout(token))
    registry = SkillGuideRegistry(workspace, agent_id="agent-1")
    current_ref = registry.list_guides()[0].ref
    missing_ref = current_ref.model_copy(update={"version": "deleted"})

    with pytest.raises(ValueError, match="unavailable"):
        registry.resolve(missing_ref)


def test_guide_ref_rejects_unversioned_or_malformed_values() -> None:
    with pytest.raises(ValueError):
        SkillGuideRef(skill_id=1, version="", content_hash="0" * 64)
    with pytest.raises(ValueError):
        SkillGuideRef(skill_id=1, version="v1", content_hash="not-a-hash")
    with pytest.raises(ValueError):
        SkillGuideRef(skill_id=1, version="../v1", content_hash="0" * 64)


def test_guide_registry_does_not_offer_oversized_guide(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(json.dumps([{"id": 100, "name": "large"}]), encoding="utf-8")
    guide_root = tmp_path / "skills" / "100" / "resolved" / "cortex"
    guide_root.mkdir(parents=True)
    (guide_root / "SKILL.md").write_bytes(b"x" * (MAX_SKILL_GUIDE_BYTES + 1))

    assert SkillGuideRegistry(workspace).list_guides() == ()


def test_project_guides_copies_cortex_to_run_scoped_workspace_and_reuses_it(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(json.dumps([{"id": 100, "name": "docs"}]), encoding="utf-8")
    cortex = tmp_path / "skills" / "100" / "resolved" / "cortex"
    cortex.mkdir(parents=True)
    (cortex / "SKILL.md").write_text("# Guide\n" + ("Follow this workflow. " * 30), encoding="utf-8")
    (cortex / "references").mkdir()
    (cortex / "references" / "api.md").write_text("# API reference\n", encoding="utf-8")
    registry = SkillGuideRegistry(workspace)
    guide = registry.resolve(registry.list_guides()[0].ref)

    first = project_guides_into_workspace((guide,), workspace, "run-123")[0]
    second = project_guides_into_workspace((guide,), workspace, "run-123")[0]

    assert first.resource_root == ".sico/runs/run-123/skills/100/snapshot-" + guide.descriptor.ref.content_hash
    assert second.resource_root == first.resource_root
    projected = workspace / first.resource_root
    assert (projected / "SKILL.md").read_bytes().decode("utf-8") == guide.content
    assert (projected / "references" / "api.md").read_text(encoding="utf-8") == "# API reference\n"


def test_project_guides_rejects_symlinked_resource(tmp_path: Path) -> None:
    if not hasattr(os, "symlink"):
        pytest.skip("symbolic links are unavailable")
    workspace = tmp_path / "workspace"
    cortex = tmp_path / "cortex"
    cortex.mkdir()
    guide_content = "# Guide\n" + ("Follow this workflow. " * 30)
    (cortex / "SKILL.md").write_text(guide_content, encoding="utf-8")
    outside = tmp_path / "outside.md"
    outside.write_text("outside", encoding="utf-8")
    try:
        (cortex / "reference.md").symlink_to(outside)
    except OSError:
        pytest.skip("symbolic link creation is not permitted")
    registry_workspace = tmp_path / "registry"
    (registry_workspace / "skills").mkdir(parents=True)
    (registry_workspace / "skills" / "index.json").write_text(json.dumps([{"id": 100, "name": "docs"}]), encoding="utf-8")
    skill_cortex = tmp_path / "skills" / "100" / "resolved" / "cortex"
    skill_cortex.parent.mkdir(parents=True)
    shutil.copytree(cortex, skill_cortex, symlinks=True)
    registry = SkillGuideRegistry(registry_workspace)
    guide = registry.resolve(registry.list_guides()[0].ref)

    with pytest.raises(ValueError, match="symbolic link"):
        project_guides_into_workspace((guide,), workspace, "run-123")
