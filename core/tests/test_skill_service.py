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

import io
import json
import zipfile

import pytest

from app.biz.skill.resolver import _MAX_SCRIPT_BYTES, _RESOLVER_SYSTEM_PROMPT, ResolvedSkillOutput, SkillResolver
from app.biz.skill import service as skill_service_module
from app.pb.skill.skill import ExtractSkillRequest


def test_skill_resolver_prompt_prefers_uv_run_for_python_entrypoints() -> None:
    assert '["uv", "run", "python", "-m", "package"]' in _RESOLVER_SYSTEM_PROMPT
    assert "over plain" in _RESOLVER_SYSTEM_PROMPT
    assert "Preserve documented platform/tooling dependency setup commands" in _RESOLVER_SYSTEM_PROMPT
    assert '["sh", "scripts/install-adb.sh"]' in _RESOLVER_SYSTEM_PROMPT


@pytest.mark.asyncio
async def test_skill_resolver_retries_invalid_schema_output(tmp_path) -> None:
    original_root = tmp_path / "original"
    original_root.mkdir()
    (original_root / "SKILL.md").write_text(
        "---\nname: sample\ndescription: Sample skill.\n---\n# Sample\n",
        encoding="utf-8",
    )
    outputs = iter(
        [
            json.dumps({"cortex": [{"name": "SKILL.md"}], "actions": [{"name": "bad", "steps": []}]}),
            json.dumps({"cortex": [{"name": "SKILL.md"}], "actions": []}),
        ]
    )

    class RetryResolver(SkillResolver):
        def __init__(self) -> None:
            self.prompts: list[str] = []

        async def _generate(self, prompt: str) -> str:
            self.prompts.append(prompt)
            return next(outputs)

    resolver = RetryResolver()

    resolved = await resolver.resolve(original_root)

    assert resolved.actions == []
    assert len(resolver.prompts) == 2
    assert "failed JSON/schema validation" in resolver.prompts[1]


@pytest.mark.asyncio
async def test_skill_resolver_stops_after_three_invalid_schema_outputs(tmp_path) -> None:
    original_root = tmp_path / "original"
    original_root.mkdir()
    (original_root / "SKILL.md").write_text(
        "---\nname: sample\ndescription: Sample skill.\n---\n# Sample\n",
        encoding="utf-8",
    )
    invalid_output = json.dumps({"cortex": [{"name": "SKILL.md"}], "actions": [{"name": "bad", "steps": []}]})

    class RetryResolver(SkillResolver):
        def __init__(self) -> None:
            self.prompts: list[str] = []

        async def _generate(self, prompt: str) -> str:
            self.prompts.append(prompt)
            return invalid_output

    resolver = RetryResolver()

    with pytest.raises(ValueError, match="failed validation after 3 attempts"):
        await resolver.resolve(original_root)

    assert len(resolver.prompts) == 3


def test_skill_resolver_prompt_includes_update_diff_and_previous_actions(tmp_path) -> None:
    previous_root = tmp_path / "previous" / "original"
    current_root = tmp_path / "current" / "original"
    previous_root.mkdir(parents=True)
    current_root.mkdir(parents=True)
    previous_actions = tmp_path / "previous" / "resolved" / "actions.json"
    previous_actions.parent.mkdir(parents=True)
    previous_actions.write_text('{"schema_version":1,"actions":[]}', encoding="utf-8")
    (previous_root / "SKILL.md").write_text(
        "---\nname: sample\ndescription: Sample skill.\n---\nold\n",
        encoding="utf-8",
    )
    (current_root / "SKILL.md").write_text(
        "---\nname: sample\ndescription: Sample skill.\n---\nnew\n",
        encoding="utf-8",
    )
    (previous_root / "removed.txt").write_text("gone", encoding="utf-8")
    (current_root / "added.txt").write_text("hello", encoding="utf-8")

    prompt = SkillResolver()._build_prompt(
        current_root,
        previous_original_root=previous_root,
        previous_actions_file=previous_actions,
    )
    payload = json.loads(prompt)

    update_context = payload["update_context"]
    changes = {item["path"]: item for item in update_context["changed_files"]}
    assert changes["SKILL.md"]["change_type"] == "modified"
    assert "-old" in changes["SKILL.md"]["diff"]
    assert "+new" in changes["SKILL.md"]["diff"]
    assert changes["added.txt"]["change_type"] == "added"
    assert changes["added.txt"]["current_content"] == "hello"
    assert changes["removed.txt"]["change_type"] == "deleted"
    assert update_context["previous_actions_manifest"] == {"schema_version": 1, "actions": []}


def test_skill_resolver_prompt_includes_small_scripts_fully_with_total_budget(tmp_path) -> None:
    original_root = tmp_path / "original"
    original_root.mkdir()
    (original_root / "SKILL.md").write_text(
        "---\nname: sample\ndescription: Sample skill.\n---\n# Sample\n",
        encoding="utf-8",
    )
    (original_root / "scripts").mkdir()
    small_script = "print('small script')\n"
    (original_root / "scripts" / "extract-pptx.py").write_bytes(small_script.encode("utf-8"))
    (original_root / "scripts" / "large.py").write_bytes(b"x" * (_MAX_SCRIPT_BYTES + 100))

    prompt = SkillResolver()._build_prompt(original_root)
    payload = json.loads(prompt)
    important_files = {item["path"]: item for item in payload["important_files"]}

    assert important_files["scripts/extract-pptx.py"]["content"] == small_script
    assert important_files["scripts/extract-pptx.py"]["included_full_content"] is True
    assert important_files["scripts/large.py"]["content_truncated"] is True
    total_content_bytes = sum(len(item.get("content", "").encode("utf-8")) for item in payload["important_files"])
    assert total_content_bytes <= _MAX_SCRIPT_BYTES


class _FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None


class _FakeAssetUploadResponse:
    def __init__(self, asset_id: int, uri: str = "default_space/asset.zip") -> None:
        self._asset_id = asset_id
        self._uri = uri

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return {"data": {"id": self._asset_id, "uri": self._uri}}


@pytest.mark.asyncio
async def test_extract_skill_writes_resolved_actions_manifest(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_md = b"""
---
name: sample-skill
description: Sample skill for capability persistence.
---
# Sample Skill

Use this skill for smoke checks.
""".strip()
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", tmp_path / "skills")
    monkeypatch.setattr(skill_service_module.requests, "get", lambda *_args, **_kwargs: _FakeResponse(skill_md))

    class FakeResolver:
        async def resolve(self, _original_root, **_kwargs):
            return ResolvedSkillOutput(cortex=[{"name": "SKILL.md"}], actions=[])

    monkeypatch.setattr(skill_service_module, "SkillResolver", FakeResolver)

    service = skill_service_module.SkillService()
    response = await service.extract_skill(
        ExtractSkillRequest(
            skill_id=7,
            project_id=1,
            version="v1",
            download_url="https://example.test/skill.md",
        )
    )

    assert response.code == 0
    assert response.name == "sample-skill"
    skill_dir = tmp_path / "skills" / "project" / "1" / "skill" / "7" / "versions" / "v1"
    manifest = json.loads((skill_dir / "resolved" / "actions.json").read_text(encoding="utf-8"))
    assert manifest == {"schema_version": 1, "actions": []}
    assert (skill_dir / "resolved" / "cortex" / "SKILL.md").exists()
    assert (skill_dir / "original" / "SKILL.md").exists()
    assert (tmp_path / "skills" / "project" / "1" / "skill" / "7" / "current_version.txt").read_text(encoding="utf-8") == "v1"


@pytest.mark.asyncio
async def test_extract_skill_replaces_existing_skill_directory(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    existing_dir = skill_root / "project" / "1" / "skill" / "7"
    existing_dir.mkdir(parents=True)
    (existing_dir / "old_runner.py").write_text("stale", encoding="utf-8")
    skill_md = b"""
---
name: replacement-skill
description: Replacement skill.
---
# Replacement Skill
""".strip()
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    monkeypatch.setattr(skill_service_module.requests, "get", lambda *_args, **_kwargs: _FakeResponse(skill_md))

    class FakeResolver:
        async def resolve(self, _original_root, **_kwargs):
            return ResolvedSkillOutput(cortex=[{"name": "SKILL.md"}], actions=[])

    monkeypatch.setattr(skill_service_module, "SkillResolver", FakeResolver)

    response = await skill_service_module.SkillService().extract_skill(
        ExtractSkillRequest(skill_id=7, project_id=1, version="v2", download_url="https://example.test/skill.md")
    )

    assert response.code == 0
    assert (existing_dir / "old_runner.py").exists()
    assert (existing_dir / "versions" / "v2" / "original" / "SKILL.md").exists()


@pytest.mark.asyncio
async def test_extract_skill_keeps_existing_directory_when_upload_is_invalid(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    existing_dir = skill_root / "project" / "1" / "skill" / "7"
    existing_dir.mkdir(parents=True)
    (existing_dir / "SKILL.md").write_text("# Existing", encoding="utf-8")
    (existing_dir / "old_runner.py").write_text("still here", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    monkeypatch.setattr(skill_service_module.requests, "get", lambda *_args, **_kwargs: _FakeResponse(b"\xff\xfe\xfd"))

    response = await skill_service_module.SkillService().extract_skill(
        ExtractSkillRequest(skill_id=7, project_id=1, version="v2", download_url="https://example.test/bad.bin")
    )

    assert response.code != 0
    assert (existing_dir / "SKILL.md").exists()
    assert (existing_dir / "old_runner.py").exists()


def test_get_skill_details_returns_current_version_actions(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    version_dir = skill_dir / "versions" / "v1"
    (version_dir / "original" / "SKILL.md").parent.mkdir(parents=True)
    (version_dir / "original" / "SKILL.md").write_text("# Visible", encoding="utf-8")
    (version_dir / "resolved" / "actions.json").parent.mkdir(parents=True)
    (version_dir / "resolved" / "actions.json").write_text('{"schema_version":1,"actions":[]}', encoding="utf-8")
    (skill_dir / "current_version.txt").write_text("v1", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)

    version, versions = skill_service_module.SkillService()._read_current_skill_version(7, 1, "", ["v1"])

    assert version.version == "v1"
    assert version.actions == []
    assert [item.version for item in versions] == ["v1"]


def test_get_skill_details_returns_files_for_historical_versions(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    for version in ("v1", "v2"):
        version_dir = skill_dir / "versions" / version
        (version_dir / "original").mkdir(parents=True)
        (version_dir / "original" / "SKILL.md").write_text(f"# {version}", encoding="utf-8")
        (version_dir / "resolved").mkdir(parents=True)
        (version_dir / "resolved" / "actions.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "actions": [
                        {
                            "name": f"run_{version}",
                            "description": f"Run {version}",
                            "steps": [{"argv": ["echo", version]}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
    (skill_dir / "current_version.txt").write_text("v2", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)

    version, versions = skill_service_module.SkillService()._read_current_skill_version(7, 1, "", ["v2", "v1"])

    assert version.version == "v2"
    by_version = {item.version: item for item in versions}
    assert sorted(by_version) == ["v1", "v2"]
    assert [action.name for action in by_version["v1"].actions] == ["run_v1"]
    assert [action.name for action in by_version["v2"].actions] == ["run_v2"]


def test_get_skill_details_filters_to_requested_versions(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    for version in ("v1", "v2", "orphan"):
        version_dir = skill_dir / "versions" / version
        (version_dir / "original").mkdir(parents=True)
        (version_dir / "original" / "SKILL.md").write_text(f"# {version}", encoding="utf-8")
        (version_dir / "resolved").mkdir(parents=True)
        (version_dir / "resolved" / "actions.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "actions": [
                        {
                            "name": f"run_{version}",
                            "description": f"Run {version}",
                            "steps": [{"argv": ["echo", version]}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
    (skill_dir / "current_version.txt").write_text("v2", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)

    version, versions = skill_service_module.SkillService()._read_current_skill_version(7, 1, "", ["v2", "v1"])

    assert version.version == "v2"
    assert [item.version for item in versions] == ["v2", "v1"]
    assert all(item.version != "orphan" for item in versions)


def test_get_skill_details_deduplicates_requested_versions(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    for index in range(1, 8):
        version = f"v{index}"
        version_dir = skill_dir / "versions" / version
        (version_dir / "original").mkdir(parents=True)
        (version_dir / "original" / "SKILL.md").write_text(f"# {version}", encoding="utf-8")
        (version_dir / "resolved").mkdir(parents=True)
        (version_dir / "resolved" / "actions.json").write_text(
            '{"schema_version":1,"actions":[]}',
            encoding="utf-8",
        )
    (skill_dir / "current_version.txt").write_text("v7", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)

    _version, versions = skill_service_module.SkillService()._read_current_skill_version(7, 1, "", ["v7", "v7", "v5"])

    assert [item.version for item in versions] == ["v7", "v5"]
    assert versions[-1].actions == []


def test_write_skill_version_uses_original_relative_paths_and_skips_pycache(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    skill_root = tmp_path / "skills"
    source_root = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v0" / "original"
    source_root.mkdir(parents=True)
    (source_root / "SKILL.md").write_text("# Old Skill", encoding="utf-8")
    (source_root / "kept.py").write_text("VALUE = 1", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)

    skill_service_module.SkillService()._write_skill_version(
        7,
        1,
        "",
        "v1",
        "v0",
        0,
        "",
        [
            skill_service_module.SkillFile(path="SKILL.md", content="# Skill"),
            skill_service_module.SkillFile(path="__pycache__/runner.pyc", content="cache"),
        ],
        [],
    )

    skill_dir = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v1"
    assert (skill_dir / "original" / "SKILL.md").read_text(encoding="utf-8") == "# Skill"
    assert (skill_dir / "original" / "kept.py").read_text(encoding="utf-8") == "VALUE = 1"
    assert not (skill_dir / "resolved" / "cortex" / "SKILL.md").exists()
    assert not list(skill_dir.rglob("__pycache__"))


def test_write_skill_version_rejects_paths_outside_original_root(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    source_root = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v0" / "original"
    source_root.mkdir(parents=True)
    (source_root / "SKILL.md").write_text("# Old Skill", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)

    with pytest.raises(ValueError, match="invalid skill file path"):
        skill_service_module.SkillService()._write_skill_version(
            7,
            1,
            "",
            "v1",
            "v0",
            0,
            "",
            [skill_service_module.SkillFile(path="../escape.txt", content="bad")],
            [],
        )

    assert not (skill_root / "project" / "1" / "skill" / "7" / "versions" / "escape.txt").exists()
    assert not (skill_root / "project" / "1" / "skill" / "7" / "escape.txt").exists()


@pytest.mark.asyncio
async def test_write_skill_version_requires_source_version() -> None:
    response = await skill_service_module.SkillService().write_skill_version(
        skill_service_module.WriteSkillVersionRequest(
            skill_id=7,
            project_id=1,
            version="v2",
            files=[skill_service_module.SkillFile(path="hello.txt", content="123")],
        )
    )

    assert response.code != 0
    assert response.msg == "source_version is required"


@pytest.mark.asyncio
async def test_write_skill_version_requires_update_source() -> None:
    response = await skill_service_module.SkillService().write_skill_version(
        skill_service_module.WriteSkillVersionRequest(
            skill_id=7,
            project_id=1,
            version="v2",
            source_version="v1",
        )
    )

    assert response.code != 0
    assert response.msg == "asset_id, files, or actions are required"


@pytest.mark.asyncio
async def test_write_skill_version_resolves_file_edits_and_sets_current(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    source_dir = skill_dir / "versions" / "v1" / "original"
    source_dir.mkdir(parents=True)
    source_actions = skill_dir / "versions" / "v1" / "resolved" / "actions.json"
    source_actions.parent.mkdir(parents=True)
    source_actions.write_text('{"schema_version":1,"actions":[]}', encoding="utf-8")
    source_skill_md = "---\nname: source\ndescription: Source skill.\n---\n# Source\n"
    (source_dir / "SKILL.md").write_text(source_skill_md, encoding="utf-8")
    (source_dir / "existing.py").write_text("VALUE = 1\n", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    monkeypatch.setenv("SICO_ENDPOINT", "https://backend.example.test")
    uploads: list[dict[str, object]] = []

    resolver_kwargs: list[dict[str, object]] = []

    class FakeResolver:
        async def resolve(self, _original_root, **kwargs):
            resolver_kwargs.append(kwargs)
            return ResolvedSkillOutput(cortex=[{"name": "SKILL.md"}], actions=[])

    monkeypatch.setattr(skill_service_module, "SkillResolver", FakeResolver)

    def fake_post_file(url, *, file_name, data, content_type, form_data=None, timeout=None, **_kwargs):  # noqa: ANN001
        uploads.append(
            {
                "url": url,
                "file_name": file_name,
                "data": form_data,
                "file_data": data,
                "content_type": content_type,
                "timeout": timeout,
            }
        )
        return _FakeAssetUploadResponse(99, uri="default_space/skill-7-v2.zip")

    monkeypatch.setattr(skill_service_module, "post_file", fake_post_file)

    response = await skill_service_module.SkillService().write_skill_version(
        skill_service_module.WriteSkillVersionRequest(
            skill_id=7,
            project_id=1,
            version="v2",
            source_version="v1",
            files=[
                skill_service_module.SkillFile(
                    path="hello.txt",
                    content="123",
                )
            ],
        )
    )

    new_version_dir = skill_dir / "versions" / "v2"
    assert response.code == 0
    assert response.name == "source"
    assert response.asset_id == 99
    assert uploads[0]["url"] == "https://backend.example.test/api/sico/project/asset"
    assert uploads[0]["data"] is None
    zip_blob = uploads[0]["file_data"]
    assert uploads[0]["file_name"] == "skill-7-v2.zip"
    assert uploads[0]["content_type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(zip_blob)) as archive:
        assert set(archive.namelist()) == {"SKILL.md", "existing.py", "hello.txt"}
        assert archive.read("hello.txt") == b"123"
    assert (new_version_dir / "original" / "SKILL.md").read_text(encoding="utf-8") == source_skill_md
    assert (new_version_dir / "original" / "existing.py").read_text(encoding="utf-8") == "VALUE = 1\n"
    assert (new_version_dir / "original" / "hello.txt").read_text(encoding="utf-8") == "123"
    assert (new_version_dir / "resolved" / "cortex" / "SKILL.md").exists()
    assert resolver_kwargs[0]["previous_original_root"] == source_dir
    assert resolver_kwargs[0]["previous_actions_file"] == source_actions
    assert (skill_dir / "current_version.txt").read_text(encoding="utf-8") == "v2"


@pytest.mark.asyncio
async def test_write_skill_version_files_and_actions_skip_resolver(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    source_dir = skill_dir / "versions" / "v1"
    (source_dir / "original").mkdir(parents=True)
    skill_md = "---\nname: source\ndescription: Source skill.\n---\n# Source\n"
    (source_dir / "original" / "SKILL.md").write_text(skill_md, encoding="utf-8")
    (source_dir / "original" / "runner.py").write_text("print('old')\n", encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    monkeypatch.setenv("SICO_ENDPOINT", "https://sico.example.test")
    monkeypatch.setattr(skill_service_module, "post_file", lambda *_args, **_kwargs: _FakeAssetUploadResponse(88))

    class FailResolver:
        async def resolve(self, *_args, **_kwargs):
            raise AssertionError("resolver should not be called")

    monkeypatch.setattr(skill_service_module, "SkillResolver", FailResolver)

    response = await skill_service_module.SkillService().write_skill_version(
        skill_service_module.WriteSkillVersionRequest(
            skill_id=7,
            project_id=1,
            version="v2",
            source_version="v1",
            files=[skill_service_module.SkillFile(path="runner.py", content="print('new')\n")],
            actions=[
                skill_service_module.SkillAction(
                    name="run",
                    description="Run",
                    advanced_settings=json.dumps({"steps": [{"argv": ["python", "runner.py"]}]}),
                )
            ],
        )
    )

    new_dir = skill_dir / "versions" / "v2"
    assert response.code == 0
    assert response.asset_id == 88
    assert (new_dir / "original" / "runner.py").read_text(encoding="utf-8") == "print('new')\n"
    assert not (new_dir / "resolved" / "cortex").exists()
    assert '"name": "run"' in (new_dir / "resolved" / "actions.json").read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_write_skill_version_skips_resolver_when_original_has_no_diff(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    source_dir = skill_dir / "versions" / "v1"
    (source_dir / "original").mkdir(parents=True)
    (source_dir / "resolved" / "cortex").mkdir(parents=True)
    skill_md = "---\nname: source\ndescription: Source skill.\n---\n# Source\n"
    resolved_md = "---\nname: resolved\ndescription: Resolved skill.\n---\n# Resolved\n"
    (source_dir / "original" / "SKILL.md").write_text(skill_md, encoding="utf-8")
    (source_dir / "resolved" / "cortex" / "SKILL.md").write_text(resolved_md, encoding="utf-8")
    (source_dir / "resolved" / "actions.json").write_text('{"schema_version":1,"actions":[]}', encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    monkeypatch.setenv("SICO_ENDPOINT", "https://sico.example.test")

    class FailResolver:
        async def resolve(self, *_args, **_kwargs):
            raise AssertionError("resolver should not be called")

    monkeypatch.setattr(skill_service_module, "SkillResolver", FailResolver)
    monkeypatch.setattr(skill_service_module, "post_file", lambda *_args, **_kwargs: _FakeAssetUploadResponse(77))

    response = await skill_service_module.SkillService().write_skill_version(
        skill_service_module.WriteSkillVersionRequest(
            skill_id=7,
            project_id=1,
            version="v2",
            source_version="v1",
            files=[skill_service_module.SkillFile(path="SKILL.md", content=skill_md)],
        )
    )

    new_dir = skill_dir / "versions" / "v2"
    assert response.code == 0
    assert response.name == "resolved"
    assert response.asset_id == 77
    assert (new_dir / "resolved" / "cortex" / "SKILL.md").read_text(encoding="utf-8") == resolved_md
    assert (new_dir / "resolved" / "actions.json").exists()


@pytest.mark.asyncio
async def test_write_skill_version_asset_id_downloads_and_resolves_without_upload(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    skill_md = b"""
---
name: asset-skill
description: Asset skill.
---
# Asset Skill
""".strip()
    skill_root = tmp_path / "skills"
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    monkeypatch.setattr(skill_service_module.requests, "get", lambda *_args, **_kwargs: _FakeResponse(skill_md))
    monkeypatch.setattr(skill_service_module, "post_file", lambda *_args, **_kwargs: pytest.fail("unexpected upload"))

    class FakeResolver:
        async def resolve(self, _original_root, **_kwargs):
            return ResolvedSkillOutput(cortex=[{"name": "SKILL.md"}], actions=[])

    monkeypatch.setattr(skill_service_module, "SkillResolver", FakeResolver)

    response = await skill_service_module.SkillService().write_skill_version(
        skill_service_module.WriteSkillVersionRequest(
            skill_id=7,
            project_id=1,
            version="v2",
            source_version="v1",
            asset_id=55,
            download_url="https://example.test/skill.md",
        )
    )

    skill_dir = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v2"
    assert response.code == 0
    assert response.name == "asset-skill"
    assert response.asset_id == 55
    assert (skill_dir / "original" / "SKILL.md").exists()
    assert (skill_dir / "resolved" / "cortex" / "SKILL.md").exists()


@pytest.mark.asyncio
async def test_write_skill_version_action_only_branches_from_source_version(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "project" / "1" / "skill" / "7"
    source_dir = skill_dir / "versions" / "v1"
    (source_dir / "original").mkdir(parents=True)
    (source_dir / "resolved" / "cortex").mkdir(parents=True)
    skill_md = "---\nname: source\ndescription: Source skill.\n---\n# Source\n"
    (source_dir / "original" / "SKILL.md").write_text(skill_md, encoding="utf-8")
    (source_dir / "resolved" / "cortex" / "SKILL.md").write_text(skill_md, encoding="utf-8")
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    monkeypatch.setattr(skill_service_module, "post_file", lambda *_args, **_kwargs: pytest.fail("unexpected upload"))

    response = await skill_service_module.SkillService().write_skill_version(
        skill_service_module.WriteSkillVersionRequest(
            skill_id=7,
            project_id=1,
            version="v2",
            source_version="v1",
            asset_id=44,
            actions=[
                skill_service_module.SkillAction(
                    name="run",
                    description="Run",
                    advanced_settings=json.dumps({"steps": [{"argv": ["echo", "ok"]}]}),
                )
            ],
        )
    )

    new_dir = skill_dir / "versions" / "v2"
    assert response.code == 0
    assert response.name == "source"
    assert response.asset_id == 44
    assert (new_dir / "original" / "SKILL.md").read_text(encoding="utf-8") == skill_md
    assert '"name": "run"' in (new_dir / "resolved" / "actions.json").read_text(encoding="utf-8")
    assert (skill_dir / "current_version.txt").read_text(encoding="utf-8") == "v2"


def test_extract_zip_keeps_legitimate_double_dot_filename(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("package/SKILL.md", "# Skill")
        zf.writestr("package/module..py", "VALUE = 1")

    skill_service_module.SkillService()._extract_zip(buf, 7, 1, "", "v1")

    skill_dir = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v1"
    assert (skill_dir / "original" / "module..py").read_text(encoding="utf-8") == "VALUE = 1"


def test_extract_zip_skips_path_traversal_entries(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("package/SKILL.md", "# Skill")
        zf.writestr("package/../evil.txt", "pwnd")

    skill_service_module.SkillService()._extract_zip(buf, 7, 1, "", "v1")

    skill_dir = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v1"
    assert not (skill_dir / "evil.txt").exists()
    assert not (skill_dir.parent / "evil.txt").exists()


def test_extract_zip_skips_windows_drive_entries(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_root = tmp_path / "skills"
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("package/SKILL.md", "# Skill")
        zf.writestr("C:/evil.txt", "pwnd")

    skill_service_module.SkillService()._extract_zip(buf, 7, 1, "", "v1")

    skill_dir = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v1"
    assert not (skill_dir / "C:" / "evil.txt").exists()


def test_extract_zip_skips_pycache_dirs_without_affecting_top_level_detection(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    skill_root = tmp_path / "skills"
    monkeypatch.setattr(skill_service_module.SKILLS_FS, "_root", skill_root)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("package/SKILL.md", "# Skill")
        zf.writestr("package/runner.py", "print('ok')")
        zf.writestr("package/__pycache__/runner.cpython-313.pyc", "cache")
        zf.writestr("__pycache__/root.cpython-313.pyc", "cache")

    skill_service_module.SkillService()._extract_zip(buf, 7, 1, "", "v1")

    skill_dir = skill_root / "project" / "1" / "skill" / "7" / "versions" / "v1"
    assert (skill_dir / "original" / "SKILL.md").exists()
    assert (skill_dir / "original" / "runner.py").exists()
    assert not list(skill_dir.rglob("__pycache__"))
