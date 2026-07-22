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

import asyncio
import json
import shutil
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

from app.biz.chat import workspace_init
from app.biz.chat.prompt import compose_system_prompt
from app.biz.chat.service import ChatService
from app.biz.task_runtime.skill_loader import SkillLoader
from app.pb.conversation.api import ChatRequest
from app.pb.conversation.chat import ChatContent, ChatContentType


class FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None


def test_copy_attachments_retains_previous_turn_files_when_requested(tmp_path: Path, monkeypatch) -> None:
    calls: list[str] = []

    def fake_get(url: str, timeout: int) -> FakeResponse:
        calls.append(f"{url}:{timeout}")
        return FakeResponse(b"case data")

    monkeypatch.setattr(workspace_init.requests, "get", fake_get)
    attachment = SimpleNamespace(
        name="cases.xlsx",
        type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sas_url="https://blob.example/cases.xlsx",
    )

    workspace_init._copy_attachments(tmp_path, [attachment], turn_id=7)
    workspace_init._copy_attachments(tmp_path, None, turn_id=8, retain_previous=True)

    assert calls == ["https://blob.example/cases.xlsx:60"]
    assert (tmp_path / "attachments" / "cases.xlsx").read_bytes() == b"case data"

    index = json.loads((tmp_path / "attachments" / "index.json").read_text(encoding="utf-8"))
    assert len(index) == 1
    entry = index[0]
    assert isinstance(entry.pop("downloaded_at"), int)
    assert entry == {
        "name": "cases.xlsx",
        "path": "attachments/cases.xlsx",
        "url_path": "attachments/cases.xlsx_url.txt",
        "type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }


def test_copy_attachments_clears_previous_turn_files_by_default(tmp_path: Path, monkeypatch) -> None:
    def fake_get(_url: str, timeout: int) -> FakeResponse:
        return FakeResponse(b"case data")

    monkeypatch.setattr(workspace_init.requests, "get", fake_get)
    attachment = SimpleNamespace(name="cases.xlsx", type="text/csv", sas_url="https://blob.example/cases.xlsx")

    workspace_init._copy_attachments(tmp_path, [attachment], turn_id=7)
    workspace_init._copy_attachments(tmp_path, None, turn_id=8)

    assert not (tmp_path / "attachments").exists()


def test_copy_attachments_replaces_previous_files_for_new_upload(tmp_path: Path, monkeypatch) -> None:
    def fake_get(url: str, timeout: int) -> FakeResponse:
        return FakeResponse(url.encode())

    monkeypatch.setattr(workspace_init.requests, "get", fake_get)
    first = SimpleNamespace(name="old.xlsx", type="text/csv", sas_url="https://blob.example/old.xlsx")
    second = SimpleNamespace(name="new.xlsx", type="text/csv", sas_url="https://blob.example/new.xlsx")

    workspace_init._copy_attachments(tmp_path, [first], turn_id=7)
    workspace_init._copy_attachments(tmp_path, [second], turn_id=8)

    assert not (tmp_path / "attachments" / "old.xlsx").exists()
    assert (tmp_path / "attachments" / "new.xlsx").exists()


def test_copy_attachments_archives_workbook_case_sources(tmp_path: Path, monkeypatch) -> None:
    from openpyxl import Workbook

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "rewritten_userdata"
    worksheet.append(["ID", "Title", "Rewritten Steps"])
    worksheet.append(["45894791", "Collections smoke", "Open Collections and verify no crash"])
    worksheet.append(["31229175", "Sync settings", "Open Sync settings"])
    buffer = BytesIO()
    workbook.save(buffer)

    def fake_get(_url: str, timeout: int) -> FakeResponse:
        return FakeResponse(buffer.getvalue())

    workspace_root = tmp_path / "workspace"
    monkeypatch.setattr(workspace_init.requests, "get", fake_get)
    monkeypatch.setattr(workspace_init.CHAT_FS, "get_workspace_path", lambda *_args, **_kwargs: workspace_root)
    attachment = SimpleNamespace(
        name="cases.xlsx",
        type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sas_url="https://blob.example/cases.xlsx",
    )

    workspace_init._copy_attachments(workspace_root, [attachment], turn_id=7, agent_instance_id=1, username="alice")

    parsed_dir = workspace_root / "case_sources" / "parsed_documents"
    manifests = list(parsed_dir.glob("cases.xlsx-*.json"))
    assert len(manifests) == 1
    manifest = json.loads(manifests[0].read_text(encoding="utf-8"))
    assert manifest["source"] == "workbook_attachment"
    assert manifest["workbook_manifest"]["runnable_data_rows"] == 2
    source = manifest["workbook_case_sources"][0]
    assert source["sheet_name"] == "rewritten_userdata"
    assert source["case_count"] == 2
    jsonl_path = parsed_dir / source["case_source_path"]
    rows = [json.loads(line) for line in jsonl_path.read_text(encoding="utf-8").splitlines()]
    assert [row["case_id"] for row in rows] == ["45894791", "31229175"]


def test_task_workspace_profile_clears_heavy_snapshots(tmp_path: Path, monkeypatch) -> None:
    called: list[str] = []
    for name in ("knowledge", "history", "playbooks"):
        (tmp_path / name).mkdir()

    monkeypatch.setattr(workspace_init.CHAT_FS, "migrate_legacy_session", lambda *_args, **_kwargs: tmp_path)
    monkeypatch.setattr(workspace_init.CHAT_FS, "get_workspace_path", lambda *_args, **_kwargs: tmp_path)
    monkeypatch.setattr(workspace_init, "_copy_skills", lambda *_args, **_kwargs: called.append("skills"))
    monkeypatch.setattr(workspace_init, "_copy_attachments", lambda *_args, **_kwargs: called.append("attachments"))
    monkeypatch.setattr(workspace_init, "_copy_knowledge", lambda *_args, **_kwargs: called.append("knowledge"))
    monkeypatch.setattr(workspace_init, "_copy_history", lambda *_args, **_kwargs: called.append("history"))
    monkeypatch.setattr(workspace_init, "_copy_playbooks", lambda *_args, **_kwargs: called.append("playbooks"))

    workspace_init._init_workspace_sync(
        agent_instance_id=1,
        username="alice@example.com",
        turn_id=2,
        project_id=1,
        agent_id="agent",
        attachments=None,
        options=workspace_init.WorkspaceInitOptions(
            include_knowledge=False,
            include_history=False,
            include_playbooks=False,
        ),
    )

    assert called == ["skills", "attachments"]
    assert not (tmp_path / "knowledge").exists()
    assert not (tmp_path / "history").exists()
    assert not (tmp_path / "playbooks").exists()


def test_workspace_init_removes_history_but_retains_results_and_case_sources(tmp_path: Path, monkeypatch) -> None:
    called: list[str] = []
    (tmp_path / "history").mkdir()
    (tmp_path / "results").mkdir()
    (tmp_path / "case_sources").mkdir()

    monkeypatch.setattr(workspace_init.CHAT_FS, "migrate_legacy_session", lambda *_args, **_kwargs: tmp_path)
    monkeypatch.setattr(workspace_init.CHAT_FS, "get_workspace_path", lambda *_args, **_kwargs: tmp_path)
    monkeypatch.setattr(workspace_init, "_copy_skills", lambda *_args, **_kwargs: called.append("skills"))
    monkeypatch.setattr(workspace_init, "_copy_attachments", lambda *_args, **_kwargs: called.append("attachments"))
    monkeypatch.setattr(workspace_init, "_copy_knowledge", lambda *_args, **_kwargs: called.append("knowledge"))
    monkeypatch.setattr(workspace_init, "_copy_history", lambda *_args, **_kwargs: called.append("history"))
    monkeypatch.setattr(workspace_init, "_copy_playbooks", lambda *_args, **_kwargs: called.append("playbooks"))

    workspace_init._init_workspace_sync(
        agent_instance_id=1,
        username="alice@example.com",
        turn_id=2,
        project_id=1,
        agent_id="agent",
        attachments=None,
        options=workspace_init.WorkspaceInitOptions(include_history=True),
    )

    assert called == ["skills", "knowledge", "playbooks", "attachments"]
    assert not (tmp_path / "history").exists()
    # ``results/`` and ``case_sources/`` are content-addressed and persist
    # across turns so prior delegate runs and parsed workbooks remain visible.
    assert (tmp_path / "results").exists()
    assert (tmp_path / "case_sources").exists()


def test_copy_history_includes_rerun_sources(tmp_path: Path, monkeypatch) -> None:
    user_root = tmp_path / "chat" / "agent" / "alice"
    turn_7 = user_root / "turn" / "7"
    source_dir = turn_7 / "rerun_sources"
    source_dir.mkdir(parents=True)
    (source_dir / "batch-1.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "turn_id": 7,
                "batch_id": "batch-1",
                "reason": "prior xlsx",
                "join_strategy": "partial_ok",
                "task_count": 1,
                "tasks": [{"task_id": "case-1", "title": "Case 1", "kind": "tool", "tool_name": "echo"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    workspace = tmp_path / "workspace"
    monkeypatch.setattr(workspace_init.CHAT_FS, "list_turn_ids", lambda *_args: [7, 8])
    monkeypatch.setattr(
        workspace_init.CHAT_FS,
        "get_turn_path",
        lambda _agent_instance_id, _username, tid, _conversation_id: user_root / "turn" / str(tid),
    )

    workspace_init._copy_history(workspace, agent_instance_id=1, username="alice", current_turn_id=8, conversation_id=22)

    copied = workspace / "history" / "turn-7" / "rerun_sources" / "batch-1.json"
    assert copied.exists()
    assert json.loads(copied.read_text(encoding="utf-8"))["tasks"][0]["title"] == "Case 1"


def test_copy_history_scans_older_rerun_sources(tmp_path: Path, monkeypatch) -> None:
    user_root = tmp_path / "chat" / "agent" / "alice"
    source_dir = user_root / "turn" / "1" / "rerun_sources"
    source_dir.mkdir(parents=True)
    (source_dir / "batch-old.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "turn_id": 1,
                "batch_id": "batch-old",
                "reason": "old but latest test source",
                "join_strategy": "partial_ok",
                "task_count": 1,
                "tasks": [{"task_id": "case-old", "title": "Old Case", "kind": "tool", "tool_name": "echo"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(workspace_init.CHAT_FS, "list_turn_ids", lambda *_args: list(range(1, 8)))
    monkeypatch.setattr(
        workspace_init.CHAT_FS,
        "get_turn_path",
        lambda _agent_instance_id, _username, tid, _conversation_id: user_root / "turn" / str(tid),
    )

    workspace_init._copy_history(
        tmp_path / "workspace",
        agent_instance_id=1,
        username="alice",
        current_turn_id=8,
        conversation_id=22,
    )

    copied = tmp_path / "workspace" / "history" / "turn-1" / "rerun_sources" / "batch-old.json"
    assert copied.exists()


def test_repeat_user_message_injects_prior_rerun_source_without_attachments(tmp_path: Path, monkeypatch) -> None:
    history_source = tmp_path / "workspace" / "history" / "turn-7" / "rerun_sources"
    history_source.mkdir(parents=True)
    (history_source / "batch-1.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "turn_id": 7,
                "batch_id": "batch-1",
                "reason": "prior xlsx",
                "join_strategy": "partial_ok",
                "task_count": 1,
                "tasks": [
                    {
                        "task_id": "case-1",
                        "title": "STCAQA-001",
                        "kind": "skill",
                        "skill_name": "android-test",
                        "required_sandbox": "emulator",
                        "instructions": "Launch Copilot and verify sign-in.",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(workspace_init.CHAT_FS, "get_workspace_path", lambda *_args: tmp_path / "workspace")
    service = object.__new__(ChatService)
    service._logger = SimpleNamespace(info=lambda *_args, **_kwargs: None, warning=lambda *_args, **_kwargs: None)

    section = service._build_prior_rerun_sources_section(agent_instance_id=1, username="alice")

    assert "Prior delegated task sources" in section
    assert "history/turn-7/rerun_sources/batch-1.json" in section
    assert "rerun_input_json" in section
    assert "STCAQA-001" in section

    message = asyncio.run(
        service._build_user_message(
            ChatRequest(
                username="alice",
                agent_instance_id=1,
                message=ChatContent(type=ChatContentType.TEXT, content="璇烽噸璺戜笂涓€娆＄殑娴嬭瘯鐢ㄤ緥"),
            ),
        )
    )
    assert "Prior delegated task sources" not in message.text
    assert "Launch Copilot" not in message.text
    assert "Workspace attachments available:" not in message.text


def test_case_source_user_message_injects_bounded_source_context(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    knowledge_dir = workspace / "knowledge"
    knowledge_dir.mkdir(parents=True)
    (knowledge_dir / "index.json").write_text(json.dumps([{"id": 1, "name": "case library"}]), encoding="utf-8")
    original_dir = knowledge_dir / "1" / "original"
    original_dir.mkdir(parents=True)
    (original_dir / "cases.xlsx").write_bytes(b"workbook")
    source_dir = workspace / "history" / "turn-7" / "case_sources" / "parsed_documents"
    source_dir.mkdir(parents=True)
    (source_dir / "cases.md").write_text("STCAQA-567: attachment content", encoding="utf-8")
    (source_dir / "cases.json").write_text(
        json.dumps({"archived_markdown_path": "cases.md", "case_ids": ["STCAQA-567"], "file_path": "attachments/cases.xlsx"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(workspace_init.CHAT_FS, "get_workspace_path", lambda *_args: workspace)
    service = object.__new__(ChatService)
    service._logger = SimpleNamespace(info=lambda *_args, **_kwargs: None, warning=lambda *_args, **_kwargs: None)

    request = ChatRequest(
        username="alice",
        agent_instance_id=1,
        message=ChatContent(type=ChatContentType.TEXT, content="STCAQA-567鐨勫唴瀹规槸浠€涔堬紵"),
    )
    sections = service._build_context_sections(request, SkillLoader(workspace))
    case_section = sections["case_source_resolution"]

    assert "Case source resolver context" in case_section
    assert "history/turn-7/case_sources/parsed_documents/cases.md" in case_section
    assert "Project Knowledge" in case_section
    assert "knowledge/1/original/cases.xlsx" in case_section
    assert "Do not call parse_document for historical attachments" in case_section

    message = asyncio.run(service._build_user_message(request))

    assert "Case source resolver context" not in message.text
    assert "history/turn-7/case_sources/parsed_documents/cases.md" not in message.text
    assert "Project Knowledge" not in message.text
    assert "knowledge/1/original/cases.xlsx" not in message.text


def test_capability_cards_read_actions_from_skill_storage(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "user" / "workspace"
    (workspace / "skills" / "7").mkdir(parents=True)
    (workspace / "skills" / "7" / "SKILL.md").write_text(
        "---\nname: staged-skill\ndescription: Workspace cortex.\n---\n# Cortex\n",
        encoding="utf-8",
    )
    (workspace / "skills" / "index.json").write_text(
        json.dumps([{"id": 7, "name": "staged-skill", "description": "Workspace cortex."}]),
        encoding="utf-8",
    )
    source_root = tmp_path / "source"
    skill_source = source_root / "7"
    (skill_source / "resolved").mkdir(parents=True)
    (skill_source / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [
                    {
                        "name": "run_from_storage",
                        "parameters": [{"name": "instructions"}],
                        "steps": [{"argv": ["runner", "{instructions}"]}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(workspace_init.CHAT_FS, "get_workspace_path", lambda *_args: workspace)
    monkeypatch.setattr(workspace_init.SKILLS_FS, "roots", lambda **_kwargs: [("project", 1, source_root)])
    service = object.__new__(ChatService)
    service._logger = SimpleNamespace(info=lambda *_args, **_kwargs: None, warning=lambda *_args, **_kwargs: None)

    request = ChatRequest(
        username="alice",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        message=ChatContent(type=ChatContentType.TEXT, content="Run it"),
    )
    sections = service._build_context_sections(request, SkillLoader(workspace, project_id=1, agent_id="agent"))
    skills_section = sections["skills"]

    assert not (workspace / "skills" / "7" / "resolved" / "actions.json").exists()
    assert "These skills are available" in skills_section
    assert "kind: executable_action" in skills_section
    assert "action_name: run_from_storage" in skills_section
    assert "requires_sandbox:" not in skills_section
    assert "parameters:" in skills_section

    system_prompt = compose_system_prompt(prompt_mode="task", skills_section=skills_section)

    assert "These skills are available" in system_prompt
    assert "kind: executable_action" in system_prompt
    assert "action_name: run_from_storage" in system_prompt
    assert "parameters:" in system_prompt

    message = asyncio.run(service._build_user_message(request))

    assert "These skills are available" not in message.text
    assert "kind: executable_action" not in message.text
    assert "action_name: run_from_storage" not in message.text
    assert "parameters:" not in message.text


def test_manifest_only_skill_snapshot_uses_staged_runtime(tmp_path: Path, monkeypatch) -> None:
    source_root = tmp_path / "source"
    skill_source = source_root / "1"
    (skill_source / "scripts").mkdir(parents=True)
    (skill_source / "scripts" / "runner.py").write_text("print('runtime only')", encoding="utf-8")
    (skill_source / "SKILL.md").write_text(
        """
---
name: sample-skill
description: Runtime source map sample.
tool_pack: chat.task
entrypoint:
    argv:
        - python
        - "{{ skill.root }}/scripts/runner.py"
---
# Sample Skill
""".strip(),
        encoding="utf-8",
    )
    workspace = tmp_path / "workspace"
    monkeypatch.setattr(workspace_init.SKILLS_FS, "roots", lambda **_kwargs: [(None, None, source_root)])

    workspace_init._copy_skills(workspace, project_id=1, agent_id="agent")

    assert (workspace / "skills" / "1" / "SKILL.md").exists()
    assert not (workspace / "skills" / "1" / "scripts" / "runner.py").exists()
    staged_skill_root = workspace.parent / "skills" / "1"
    assert (staged_skill_root / "runtime" / "scripts" / "runner.py").exists()
    assert not (workspace / "skills" / ".runtime-map.json").exists()

    card = SkillLoader(workspace).resolve("sample-skill")
    assert card is not None
    assert card.skill_dir == str(staged_skill_root / "runtime")
    assert not card.is_executable


def test_copy_skills_stages_original_runtime_and_resolved_metadata(tmp_path: Path, monkeypatch) -> None:
    source_root = tmp_path / "source"
    old_skill_source = source_root / "7" / "versions" / "9999"
    (old_skill_source / "original").mkdir(parents=True)
    (old_skill_source / "original" / "runner.py").write_text("VALUE = 0", encoding="utf-8")
    (old_skill_source / "original" / "SKILL.md").write_text(
        "---\nname: old-skill\ndescription: Old runtime.\n---\n# Old\n",
        encoding="utf-8",
    )
    skill_source = source_root / "7" / "versions" / "2000"
    (source_root / "7" / "current_version.txt").write_text("2000", encoding="utf-8")
    (skill_source / "original").mkdir(parents=True)
    (skill_source / "original" / "runner.py").write_text("VALUE = 1", encoding="utf-8")
    (skill_source / "original" / "SKILL.md").write_text(
        "---\nname: staged-skill\ndescription: Staged runtime.\n---\n# Staged\n",
        encoding="utf-8",
    )
    (skill_source / "resolved" / "cortex").mkdir(parents=True)
    (skill_source / "resolved" / "cortex" / "SKILL.md").write_text(
        "---\nname: staged-skill\ndescription: Resolved cortex.\n---\n# Resolved\n",
        encoding="utf-8",
    )
    (skill_source / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [
                    {
                        "name": "run",
                        "parameters": [{"name": "instructions"}],
                        "steps": [{"argv": ["python", "runner.py", "{instructions}"]}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    workspace = tmp_path / "user" / "workspace"
    monkeypatch.setattr(workspace_init.SKILLS_FS, "roots", lambda **_kwargs: [(None, None, source_root)])

    workspace_init._copy_skills(workspace, project_id=1, agent_id="agent")

    staged_skill_root = workspace.parent / "skills" / "7"
    assert (staged_skill_root / "runtime" / "SKILL.md").exists()
    assert (staged_skill_root / "runtime" / "runner.py").read_text(encoding="utf-8") == "VALUE = 1"
    assert (staged_skill_root / "resolved" / "actions.json").exists()
    assert (
        (workspace / "skills" / "7" / "SKILL.md")
        .read_text(encoding="utf-8")
        .startswith("---\nname: staged-skill\ndescription: Resolved cortex.")
    )
    assert not (workspace / "skills" / "7" / "resolved" / "actions.json").exists()
    assert not (workspace / "skills" / "7" / "runner.py").exists()
    assert not (workspace / "skills" / ".runtime-map.json").exists()
    index = json.loads((workspace / "skills" / "index.json").read_text(encoding="utf-8"))
    assert index[0]["actions"] == [
        {
            "name": "run",
            "description": "",
            "infra_requirements": [],
            "parameters": [{"name": "instructions", "description": "", "required": True}],
        }
    ]

    shutil.rmtree(staged_skill_root)
    card = SkillLoader(workspace, project_id=1, agent_id="agent").resolve("staged-skill.run")
    assert card is not None
    assert card.action_name == "run"
