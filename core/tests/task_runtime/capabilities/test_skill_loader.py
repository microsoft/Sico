from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.biz.task_runtime.capabilities.catalogue import skill_descriptors
from app.biz.task_runtime.capabilities.loader import SkillLoader
from app.biz.task_runtime.workspace.layout import reset_workspace_layout, set_workspace_layout
from app.biz.skill.resolver import (
    ACTION_MANIFEST_SCHEMA_VERSION,
    ResolvedAction,
    ResolvedActionStep,
    load_actions_manifest,
    load_resolved_actions,
)


_ACTION_FIXTURES = Path(__file__).parents[2] / "fixtures" / "skill_actions"


class _FakeWorkspaceLayout:
    def __init__(self, skills_root: Path) -> None:
        self._skills_root = skills_root

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int = 0) -> Path:
        return self._skills_root / "turns" / str(agent_instance_id) / username / str(turn_id)

    def workspace_path(self, agent_instance_id: int, username: str, *, conversation_id: int = 0) -> Path:
        return self._skills_root / "workspace" / str(agent_instance_id) / username

    @property
    def chat_root(self) -> Path:
        return self._skills_root / "chat"

    @property
    def skill_root(self) -> Path:
        return self._skills_root

    def skill_roots(
        self,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> list[tuple[str, int | str, Path]]:
        return [("agent", agent_id, self._skills_root / "agent" / agent_id)] if agent_id else []

    def plan_exists(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int) -> bool:
        return False


def test_skill_resolver_projects_actions_json_as_cards(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [
                    {
                        "name": "run",
                        "description": "Run a test.",
                        "infra_requirements": ["sandbox.android"],
                        "parameters": [{"name": "instructions", "description": "Test instructions."}],
                        "steps": [{"argv": ["tester", "{sandbox.android}", "{instructions}"]}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="android-test")

    card = SkillLoader(workspace).resolve("android-test.run")

    assert card is not None
    assert card.skill_id == 100
    assert card.skill_name == "android-test"
    assert card.action_name == "run"
    assert card.requires_sandbox == ["android"]
    assert card.parameters == [{"name": "instructions", "description": "Test instructions.", "required": True}]
    section = SkillLoader(workspace).render_cards_section()
    assert "These executable skill actions are available" in section
    assert "kind: executable_action" in section
    assert "infra_requirements:" in section
    assert "requires_sandbox:" not in section
    assert "invocation: delegated task runtime skill action" in section


def test_skill_loader_projects_multiple_sandbox_options(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [
                    {
                        "name": "run",
                        "infra_requirements": ["sandbox.windows", "sandbox.macos"],
                        "parameters": [{"name": "instructions", "description": "Test instructions."}],
                        "steps": [{"argv": ["desktop-test", "{_sandbox}", "{instructions}"]}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="desktop-test")

    card = SkillLoader(workspace).resolve("desktop-test.run")

    assert card is not None
    assert card.requires_sandbox == ["windows", "macos"]
    assert card.sandbox_options == ("windows", "macos")


def test_skill_loader_does_not_register_proposed_manifest_when_legacy_env_is_enabled(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.proposal.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "review_status": "proposed",
                "source_provenance": "resolver",
                "actions": [{"name": "run", "steps": [{"argv": ["runner"]}]}],
            }
        ),
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="proposed")
    monkeypatch.setenv("SKILL_ALLOW_PROPOSED_ACTION_EXECUTION", "true")

    loader = SkillLoader(workspace)

    assert loader.resolve("proposed.run") is None
    assert loader.list_cards() == []


def test_skill_loader_prefers_accepted_manifest_over_proposal(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "review_status": "accepted",
                "source_provenance": "author",
                "actions": [{"name": "accepted", "steps": [{"argv": ["accepted"]}]}],
            }
        ),
        encoding="utf-8",
    )
    (skill_root / "resolved" / "actions.proposal.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "review_status": "proposed",
                "source_provenance": "resolver",
                "actions": [{"name": "proposed", "steps": [{"argv": ["proposed"]}]}],
            }
        ),
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="mixed")

    loader = SkillLoader(workspace)

    assert [card.name for card in loader.list_cards()] == ["mixed.accepted"]


def test_skill_loader_projects_reviewed_manifest_deterministically(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "review_status": "accepted",
                "source_provenance": "author",
                "actions": [
                    {
                        "name": "inspect",
                        "description": "Inspect without mutation.",
                        "workspace_access": "read_only",
                        "effect": "read",
                        "parameters": [{"name": "path", "type": "string"}],
                        "steps": [{"argv": ["inspect", "{path}"]}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="reviewed")

    first = skill_descriptors(SkillLoader(workspace).list_cards())
    second = skill_descriptors(SkillLoader(workspace).list_cards())

    assert first == second
    assert len(first) == 1
    assert first[0].capability_id == "skill:reviewed:inspect"
    assert first[0].workspace_access == "read_only"
    assert first[0].effect == "read"
    assert first[0].parameter_schema["properties"]["path"]["type"] == "string"


def test_skill_loader_reads_latest_persisted_skill_version(tmp_path: Path, request) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(
        json.dumps([{"id": 100, "name": "android-test", "description": "Test skill."}]),
        encoding="utf-8",
    )
    skill_root = tmp_path / "persisted" / "agent" / "agent-1" / "100"
    old_version = skill_root / "versions" / "9999"
    latest_version = skill_root / "versions" / "2000"
    skill_root.mkdir(parents=True)
    (skill_root / "current_version.txt").write_text("2000", encoding="utf-8")
    (old_version / "resolved").mkdir(parents=True)
    (old_version / "resolved" / "actions.json").write_text(
        json.dumps({"schema_version": 1, "actions": [{"name": "old", "steps": [{"argv": ["old"]}]}]}),
        encoding="utf-8",
    )
    (latest_version / "original" / "scripts").mkdir(parents=True)
    (latest_version / "original" / "scripts" / "runner.py").write_text("print('latest')", encoding="utf-8")
    (latest_version / "resolved").mkdir(parents=True)
    (latest_version / "resolved" / "actions.json").write_text(
        json.dumps({"schema_version": 1, "actions": [{"name": "run", "steps": [{"argv": ["python", "scripts/runner.py"]}]}]}),
        encoding="utf-8",
    )
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "persisted"))
    request.addfinalizer(lambda: reset_workspace_layout(token))

    loader = SkillLoader(workspace, agent_id="agent-1")
    card = loader.resolve("android-test.run")
    action = loader.load_action("android-test", "run")

    assert card is not None
    assert card.skill_dir == str(latest_version / "original")
    assert action is not None
    assert action.runtime_root == latest_version / "original"


def test_skill_resolver_ignores_legacy_frontmatter_entrypoint(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    skill_root.mkdir(parents=True)
    (skill_root / "SKILL.md").write_text(
        """
---
name: legacy-skill
description: Legacy skill.
entrypoint:
  argv: ["python", "{{ skill.root }}/run.py"]
---
# Legacy
""".strip(),
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="legacy-skill")

    card = SkillLoader(workspace).resolve("legacy-skill")

    assert card is None
    assert SkillLoader(workspace).render_cards_section() == ""


def test_skill_loader_does_not_project_instruction_only_skill_as_capability(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    skill_root.mkdir(parents=True)
    (skill_root / "SKILL.md").write_text(
        "---\nname: docs-only\ndescription: Helps answer documentation questions.\n---\n# Docs\n",
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="docs-only")

    card = SkillLoader(workspace).resolve("docs-only")
    section = SkillLoader(workspace).render_cards_section()

    assert card is None
    assert section == ""


def test_skill_with_both_a_script_and_a_workflow_surfaces_both(tmp_path: Path) -> None:
    # A skill that ships one helper script plus a documented workflow must keep
    # both visible: the action for delegation, the prose for the requests that do
    # not land on it. Treating them as either/or made a single script silently
    # delete the workflow from the chat context.
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [
                    {
                        "name": "validate",
                        "description": "Validate the generated deck.",
                        "parameters": [{"name": "path", "description": "Deck path."}],
                        "steps": [{"argv": ["node", "scripts/validate.mjs", "{path}"]}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (skill_root / "SKILL.md").write_text("# Swiss deck workflow\n" + ("Follow these steps carefully. " * 40), encoding="utf-8")
    _write_workspace_index(workspace, skill_root, name="ppt-designer")

    loader = SkillLoader(workspace)
    cards = loader.list_cards()
    section = loader.render_cards_section()

    assert {card.name for card in cards} == {"ppt-designer.validate"}
    assert loader.resolve("ppt-designer.validate").is_executable  # type: ignore[union-attr]
    assert "kind: executable_action" in section
    assert "instruction_" not in section


def test_skill_projection_baseline_covers_prose_action_and_mixed_packages(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    packages = [
        {
            "id": 101,
            "name": "docs-only",
            "description": "Follow a documentation workflow.",
            "guide": "# Documentation workflow\n" + ("Inspect the source before answering. " * 20),
            "actions": [],
        },
        {
            "id": 102,
            "name": "runner",
            "description": "Run deterministic checks.",
            "guide": "",
            "actions": [{"name": "run", "steps": [{"argv": ["runner"]}]}],
        },
        {
            "id": 103,
            "name": "deck",
            "description": "Build and validate decks.",
            "guide": "# Deck workflow\n" + ("Apply the documented layout constraints. " * 20),
            "actions": [
                {"name": "render", "steps": [{"argv": ["render"]}]},
                {"name": "validate", "steps": [{"argv": ["validate"]}]},
            ],
        },
    ]
    skills_dir = workspace / "skills"
    skills_dir.mkdir(parents=True)
    (skills_dir / "index.json").write_text(
        json.dumps([{key: package[key] for key in ("id", "name", "description")} for package in packages]),
        encoding="utf-8",
    )
    for package in packages:
        skill_root = workspace.parent / "skills" / str(package["id"])
        if package["guide"]:
            skill_root.mkdir(parents=True)
            (skill_root / "SKILL.md").write_text(str(package["guide"]), encoding="utf-8")
        if package["actions"]:
            (skill_root / "resolved").mkdir(parents=True, exist_ok=True)
            (skill_root / "resolved" / "actions.json").write_text(
                json.dumps({"schema_version": 1, "actions": package["actions"]}),
                encoding="utf-8",
            )

    loader = SkillLoader(workspace)
    cards = loader.list_cards()
    section = loader.render_cards_section()

    assert [(card.name, card.is_executable) for card in cards] == [
        ("runner.run", True),
        ("deck.render", True),
        ("deck.validate", True),
    ]
    assert section.count("kind: executable_action") == 3
    assert "Inspect the source before answering." not in section
    assert "Apply the documented layout constraints." not in section


def test_skill_prose_stub_is_not_advertised_as_a_workflow(tmp_path: Path) -> None:
    # A couple of lines of front matter is a description, not a workflow; pointing
    # a reader at it would only cost a read that answers nothing.
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [{"name": "run", "steps": [{"argv": ["run"]}]}],
            }
        ),
        encoding="utf-8",
    )
    (skill_root / "SKILL.md").write_text("---\nname: tiny\n---\n# Tiny\n", encoding="utf-8")
    _write_workspace_index(workspace, skill_root, name="tiny")

    cards = SkillLoader(workspace).list_cards()

    assert {card.name for card in cards} == {"tiny.run"}


def test_undecodable_skill_document_does_not_break_the_catalogue(tmp_path: Path) -> None:
    # ``load()`` has no per-entry guard, so a document this cannot decode must
    # not escape as an exception: one bad package would take down the whole
    # catalogue, not just its own card.
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps({"schema_version": 1, "actions": [{"name": "run", "steps": [{"argv": ["run"]}]}]}),
        encoding="utf-8",
    )
    # Long enough to clear the prose threshold, but not valid UTF-8.
    (skill_root / "SKILL.md").write_bytes(b"# Workflow\n" + b"\xff\xfe" + b"step. " * 100)
    _write_workspace_index(workspace, skill_root, name="tiny")

    cards = SkillLoader(workspace).list_cards()

    # The executable action survives; the unreadable prose is simply not offered.
    assert {card.name for card in cards} == {"tiny.run"}


def test_resolved_action_step_rejects_llm_supplied_env() -> None:
    with pytest.raises(ValidationError):
        ResolvedActionStep.model_validate(
            {
                "argv": ["android-tester"],
                "env": [{"name": "SICO_ENDPOINT", "value": "{sico_endpoint}"}],
            }
        )


def test_resolved_action_rejects_platform_parameters() -> None:
    with pytest.raises(ValidationError):
        ResolvedAction.model_validate(
            {
                "name": "run",
                "parameters": [{"name": "sico_endpoint", "description": "Platform URL."}],
                "steps": [{"argv": ["android-tester"]}],
            }
        )


def test_resolved_action_rejects_unused_parameters() -> None:
    with pytest.raises(ValidationError, match="unused parameters"):
        ResolvedAction.model_validate(
            {
                "name": "run",
                "parameters": [
                    {"name": "instructions", "description": "Test steps."},
                    {"name": "task_name", "description": "Case label."},
                ],
                "steps": [{"argv": ["android-tester", "--instructions", "{instructions}"]}],
            }
        )


def test_resolved_action_rejects_path_literals_that_leave_parameters_unused() -> None:
    with pytest.raises(ValidationError, match="unused parameters"):
        ResolvedAction.model_validate(
            {
                "name": "run_android_test_case",
                "parameters": [
                    {"name": "instructions", "description": "Natural-language test steps."},
                    {"name": "task_name", "description": "Short human-readable label."},
                ],
                "steps": [
                    {
                        "argv": [
                            "android-tester",
                            "--instructions",
                            "{workspace_dir}/instructions",
                            "--task-name",
                            "{workspace_dir}/task_name",
                        ]
                    }
                ],
            }
        )


@pytest.mark.parametrize(
    "placeholder",
    ["{instructions}", "{workspace_dir}", "{result_dir}", "{_sandbox}", "{sandbox.android}"],
)
def test_resolved_action_rejects_invocation_dependent_preparation(placeholder: str) -> None:
    with pytest.raises(ValidationError, match="preparation steps must not use placeholders"):
        ResolvedAction.model_validate(
            {
                "name": "run",
                "parameters": [{"name": "instructions", "description": "Test instructions."}],
                "preparation": {"steps": [{"argv": ["prepare", placeholder]}]},
                "steps": [{"argv": ["runner", "{instructions}"]}],
            }
        )


def test_resolved_action_rejects_optional_preparation_argv() -> None:
    with pytest.raises(ValidationError, match="preparation steps must not have optional argv"):
        ResolvedAction.model_validate(
            {
                "name": "run",
                "preparation": {"steps": [{"argv": ["uv", "sync"], "optional_argv": [["--upgrade"]]}]},
                "steps": [{"argv": ["runner"]}],
            }
        )


@pytest.mark.parametrize(
    ("fixture_name", "backend", "target_type"),
    [
        ("prepared_android_controller.json", "kubernetes", ""),
        ("prepared_worker_controls_linux_workstation.json", "kubernetes", "linux_workstation"),
        ("direct_linux_workstation_hybrid.json", "linux_workstation", "linux_workstation"),
    ],
)
def test_phase_zero_action_manifest_fixtures(
    fixture_name: str,
    backend: str,
    target_type: str,
) -> None:
    manifest = load_actions_manifest(_ACTION_FIXTURES / fixture_name)

    assert manifest.schema_version == ACTION_MANIFEST_SCHEMA_VERSION
    assert manifest.review_status == "accepted"
    assert len(manifest.actions) == 1
    action = manifest.actions[0]
    assert action.execution_requirement.backend == backend
    assert action.preparation.steps
    assert action.target_requirements.type == target_type


def test_skill_card_carries_execution_and_target_requirements(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    shutil.copyfile(
        _ACTION_FIXTURES / "direct_linux_workstation_hybrid.json",
        skill_root / "resolved" / "actions.json",
    )
    _write_workspace_index(workspace, skill_root, name="linux-workstation-hybrid")

    card = SkillLoader(workspace).resolve("linux-workstation-hybrid.run_inside_linux_workstation")

    assert card is not None
    assert card.execution_backend == "linux_workstation"
    assert card.target_os == "linux"
    assert card.target_type == "linux_workstation"
    assert card.sandbox_options == ("linux_workstation",)


def test_direct_linux_workstation_execution_requires_a_linux_workstation_lease(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    skill_root = tmp_path / "runtime" / "100"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "review_status": "accepted",
                "source_provenance": "author",
                "actions": [
                    {
                        "name": "run",
                        "execution_requirement": {"backend": "linux_workstation"},
                        "steps": [{"argv": ["true"]}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    _write_workspace_index(workspace, skill_root, name="linux-workstation")

    card = SkillLoader(workspace).resolve("linux-workstation.run")

    assert card is not None
    assert card.sandbox_options == ("linux_workstation",)


def test_new_target_requirements_reject_capability_lists() -> None:
    with pytest.raises(ValidationError):
        ResolvedAction.model_validate(
            {
                "name": "run",
                "target_requirements": {"capabilities": ["linux_workstation.shell"]},
                "steps": [{"argv": ["true"]}],
            }
        )


def test_schema_v2_setup_steps_remain_invocation_steps(tmp_path: Path) -> None:
    actions_file = tmp_path / "actions.json"
    actions_file.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "review_status": "accepted",
                "source_provenance": "author",
                "actions": [
                    {
                        "name": "run",
                        "steps": [
                            {"argv": ["uv", "sync", "--frozen"]},
                            {"argv": ["uv", "run", "python", "runner.py"]},
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    manifest = load_actions_manifest(actions_file, legacy_provenance="author")

    assert manifest.schema_version == ACTION_MANIFEST_SCHEMA_VERSION
    assert manifest.source_provenance == "author"
    assert manifest.actions[0].preparation.steps == []
    assert [step.argv for step in manifest.actions[0].steps] == [
        ["uv", "sync", "--frozen"],
        ["uv", "run", "python", "runner.py"],
    ]


def test_load_resolved_actions_strips_legacy_step_env(tmp_path: Path) -> None:
    skill_root = tmp_path / "skill"
    (skill_root / "resolved").mkdir(parents=True)
    (skill_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [
                    {
                        "name": "run",
                        "parameters": [
                            {"name": "instructions", "description": "Test instructions."},
                            {"name": "sico_endpoint", "description": "Platform URL."},
                            {"name": "sico_agent_instance_id", "description": "Agent instance."},
                        ],
                        "steps": [
                            {
                                "argv": ["android-tester", "{instructions}"],
                                "env": [{"name": "SICO_ENDPOINT", "value": "{sico_endpoint}"}],
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    actions = load_resolved_actions(skill_root)

    assert actions[0].steps[0].argv == ["android-tester", "{instructions}"]
    assert [parameter.name for parameter in actions[0].parameters] == ["instructions"]
    assert not hasattr(actions[0].steps[0], "env")


def _write_workspace_index(workspace: Path, skill_root: Path, *, name: str) -> None:
    staged_root = workspace.parent / "skills" / "100"
    staged_root.parent.mkdir(parents=True, exist_ok=True)
    if staged_root.exists():
        shutil.rmtree(staged_root)
    shutil.copytree(skill_root, staged_root)
    skills_dir = workspace / "skills"
    skills_dir.mkdir(parents=True)
    (skills_dir / "index.json").write_text(
        json.dumps([{"id": 100, "name": name, "description": "Test skill."}]),
        encoding="utf-8",
    )
