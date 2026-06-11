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