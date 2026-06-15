# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.biz.task_runtime.skill_loader import SkillLoader
from app.biz.task_runtime.workspace import reset_workspace_layout, set_workspace_layout
from app.biz.skill.resolver import ResolvedAction, ResolvedActionStep, load_resolved_actions


class _FakeWorkspaceLayout:
    def __init__(self, skills_root: Path) -> None:
        self._skills_root = skills_root

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int) -> Path:
        return self._skills_root / "turns" / str(agent_instance_id) / username / str(turn_id)

    def workspace_path(self, agent_instance_id: int, username: str) -> Path:
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
    assert card.requires_sandbox == "android"
    assert card.parameters == [{"name": "instructions", "description": "Test instructions.", "required": True}]
    section = SkillLoader(workspace).render_cards_section()
    assert "These skill capabilities are available" in section
    assert "infra_requirements:" in section
    assert "requires_sandbox:" not in section
    assert "invocation: invoke_skill" in section


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

    assert card is not None
    assert not card.is_executable
    assert "entrypoint_inputs:" not in SkillLoader(workspace).render_cards_section()


def test_skill_resolver_includes_no_action_skill_as_capability_card(tmp_path: Path) -> None:
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

    assert card is not None
    assert not card.is_executable
    assert card.description == "Test skill."
    assert "skill_name: docs-only" in section
    assert "description: Test skill." in section
    assert "action_name:" not in section
    assert "invocation:" not in section


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
