from pathlib import Path

from app.biz.chat import workspace_init


def test_copy_skills_removes_deleted_staged_runtime(tmp_path: Path, monkeypatch) -> None:
    source_root = tmp_path / "source"
    skill_source = source_root / "7"
    skill_source.mkdir(parents=True)
    (skill_source / "SKILL.md").write_text(
        "---\nname: active-skill\ndescription: Active runtime.\n---\n# Active\n",
        encoding="utf-8",
    )
    (skill_source / "runner.py").write_text("VALUE = 2", encoding="utf-8")

    workspace = tmp_path / "user" / "workspace"
    stale_runtime = workspace.parent / "skills" / "42" / "runtime"
    stale_runtime.mkdir(parents=True)
    (stale_runtime / "runner.py").write_text("VALUE = 1", encoding="utf-8")
    (workspace.parent / "skills" / "notes").mkdir(parents=True)

    monkeypatch.setattr(workspace_init.SKILLS_FS, "roots", lambda **_kwargs: [(None, None, source_root)])

    workspace_init._copy_skills(workspace, project_id=1, agent_id="agent")

    assert not (workspace.parent / "skills" / "42").exists()
    assert (workspace.parent / "skills" / "notes").exists()
    assert (workspace.parent / "skills" / "7" / "runtime" / "runner.py").read_text(encoding="utf-8") == "VALUE = 2"
