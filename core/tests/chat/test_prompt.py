"""Tests for hot-reloadable prompt loading via CHAT_PROMPTS_DIR."""

import os
from pathlib import Path

import pytest

from app.biz.chat import prompt as prompt_mod
from app.biz.chat.prompt import PromptFile, read_prompt_file


@pytest.fixture(autouse=True)
def _clear_prompt_cache():
    """Isolate the module-global mtime cache between tests."""
    prompt_mod._PROMPT_CACHE.clear()
    yield
    prompt_mod._PROMPT_CACHE.clear()


def _bump_mtime(path: Path, delta_seconds: float = 2.0) -> None:
    """Advance a file's mtime so the mtime-based cache is invalidated."""
    stat = path.stat()
    os.utime(path, (stat.st_atime, stat.st_mtime + delta_seconds))


class TestReadPromptFile:
    def test_override_file_wins_over_packaged(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))
        (tmp_path / PromptFile.SYSTEM.value).write_text("OVERRIDDEN SYSTEM PROMPT", encoding="utf-8")

        assert read_prompt_file(PromptFile.SYSTEM) == "OVERRIDDEN SYSTEM PROMPT"

    def test_falls_back_to_packaged_when_override_absent(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))

        packaged = (prompt_mod._PROMPT_DIR / PromptFile.SYSTEM.value).read_text(encoding="utf-8")
        assert read_prompt_file(PromptFile.SYSTEM) == packaged

    def test_edits_are_hot_reloaded(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))
        override = tmp_path / PromptFile.SYSTEM.value

        override.write_text("VERSION A", encoding="utf-8")
        assert read_prompt_file(PromptFile.SYSTEM) == "VERSION A"

        override.write_text("VERSION B", encoding="utf-8")
        _bump_mtime(override)
        assert read_prompt_file(PromptFile.SYSTEM) == "VERSION B"

    def test_cache_serves_unchanged_file_without_reread(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))
        override = tmp_path / PromptFile.SYSTEM.value
        override.write_text("CACHED", encoding="utf-8")

        assert read_prompt_file(PromptFile.SYSTEM) == "CACHED"

        stat = override.stat()
        override.write_text("SNEAKY EDIT", encoding="utf-8")
        os.utime(override, (stat.st_atime, stat.st_mtime))
        assert read_prompt_file(PromptFile.SYSTEM) == "CACHED"

    def test_missing_file_returns_fallback(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))

        result = read_prompt_file("does_not_exist.md", fallback="FALLBACK")
        assert result == "FALLBACK"

    def test_empty_env_disables_override(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", "")

        packaged = (prompt_mod._PROMPT_DIR / PromptFile.SYSTEM.value).read_text(encoding="utf-8")
        assert read_prompt_file(PromptFile.SYSTEM) == packaged


class TestResolvePromptPath:
    def test_override_dir_used_when_file_present(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))
        (tmp_path / PromptFile.SYSTEM.value).write_text("x", encoding="utf-8")

        resolved = prompt_mod._resolve_prompt_path(PromptFile.SYSTEM.value)
        assert resolved == tmp_path / PromptFile.SYSTEM.value

    def test_packaged_dir_used_when_override_missing(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))

        resolved = prompt_mod._resolve_prompt_path(PromptFile.SYSTEM.value)
        assert resolved == prompt_mod._PROMPT_DIR / PromptFile.SYSTEM.value


class TestComposeSystemPrompt:
    def test_compose_uses_override_fragments(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHAT_PROMPTS_DIR", str(tmp_path))
        (tmp_path / PromptFile.SYSTEM.value).write_text("BASE for {{name}}", encoding="utf-8")
        (tmp_path / "task_rules.md").write_text("TASK RULES", encoding="utf-8")

        result = prompt_mod.compose_system_prompt(prompt_mode="task", name="Tester")

        assert "BASE for Tester" in result
        assert "TASK RULES" in result


def test_task_rules_use_only_the_unified_tabular_delegate_contract() -> None:
    rules = read_prompt_file("task_rules.md")

    assert "request_json" in rules
    assert "options_json" not in rules
    assert "workbook_sheet_scope_required" not in rules
    assert '"kind": "workbook"' not in rules
    assert "skill_name" not in rules
    assert "action_name" not in rules


def test_task_rules_stay_within_fixed_prompt_budget() -> None:
    rules = read_prompt_file("task_rules.md")

    assert len(rules.encode("utf-8")) <= 18_000


def test_task_rules_describe_safe_first_attempt_tabular_binding() -> None:
    rules = read_prompt_file("task_rules.md")

    assert "first attempt" in rules
    assert "omit `parameter_bindings`" in rules
    assert "at most one bounded table-planner call" in rules
    assert "Do not invent explicit bindings from similar-looking column names" in rules
    assert '"column":"<exact header>"' in rules
    assert "details.unknown_parameters" in rules
    assert "details.unknown_columns" in rules
    assert '"parameter_bindings": {"case_id"' not in rules
    assert '"capability_ids": ["skill:' not in rules
