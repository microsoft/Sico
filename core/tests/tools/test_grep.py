from __future__ import annotations

import pytest

from app.tools.grep import _normalize_files_arg, _resolve_search_targets


def test_normalize_files_arg_accepts_empty_string_and_list() -> None:
    assert _normalize_files_arg(None) == []
    assert _normalize_files_arg("") == []
    assert _normalize_files_arg("skills/1/SKILL.md") == ["skills/1/SKILL.md"]
    assert _normalize_files_arg(["a.md", "", " b.md "]) == ["a.md", "b.md"]


def test_normalize_files_arg_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="files must be a list"):
        _normalize_files_arg({"path": "a.md"})
    with pytest.raises(ValueError, match="files must contain only strings"):
        _normalize_files_arg(["a.md", 1])


def test_resolve_search_targets_defaults_to_workspace(tmp_path) -> None:
    assert _resolve_search_targets(tmp_path, []) == [tmp_path]


def test_resolve_search_targets_accepts_files_and_folders(tmp_path) -> None:
    folder = tmp_path / "skills" / "1"
    folder.mkdir(parents=True)
    file = folder / "SKILL.md"
    file.write_text("hello", encoding="utf-8")

    targets = _resolve_search_targets(tmp_path, ["skills/1", "skills/1/SKILL.md", "skills/1"])

    assert targets == [folder.resolve(), file.resolve()]


@pytest.mark.parametrize("bad_path", ["../secret.md", "/tmp/secret.md", "skills//one", "."])
def test_resolve_search_targets_rejects_unsafe_paths(tmp_path, bad_path: str) -> None:
    with pytest.raises(ValueError, match="workspace-relative"):
        _resolve_search_targets(tmp_path, [bad_path])


def test_resolve_search_targets_rejects_missing_path(tmp_path) -> None:
    with pytest.raises(ValueError, match="search target not found"):
        _resolve_search_targets(tmp_path, ["missing.md"])
