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

"""Tests for the ``WorkspaceLayout`` injection seam."""

from __future__ import annotations

from pathlib import Path

from app.biz.task_runtime.workspace import (
    WorkspaceLayout,
    _StorageFsLayout,
    reset_workspace_layout,
    set_workspace_layout,
    workspace_layout,
)


class _FakeChatFs:
    def __init__(self, root: Path) -> None:
        self._root = root
        self.plan = _FakePlanStore()

    @property
    def root(self) -> Path:
        return self._root

    def get_turn_path(self, agent_instance_id: int, user_id: str, turn_id: int, conversation_id: int = 0) -> Path:
        base = self._root / "ai" / str(agent_instance_id) / user_id
        if conversation_id:
            base = base / "conversation" / str(conversation_id)
        return base / "turn" / str(turn_id)

    def get_workspace_path(self, agent_instance_id: int, user_id: str, conversation_id: int = 0) -> Path:
        base = self._root / "ai" / str(agent_instance_id) / user_id
        if conversation_id:
            base = base / "conversation" / str(conversation_id)
        return base / "workspace"


class _FakePlanStore:
    def __init__(self) -> None:
        self.calls: list[tuple[int, str, int, int]] = []
        self.existing: set[tuple[int, str, int, int]] = set()

    def exists(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int) -> bool:
        key = (agent_instance_id, username, turn_id, conversation_id)
        self.calls.append(key)
        return key in self.existing


class _FakeSkillsFs:
    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    def roots(
        self,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> list[tuple[str, int | str, Path]]:
        out: list[tuple[str, int | str, Path]] = []
        if project_id:
            out.append(("project", project_id, self._root / "project" / str(project_id)))
        if agent_id:
            out.append(("agent", agent_id, self._root / "agent" / agent_id))
        return out


def _fake_layout(tmp_path: Path) -> _StorageFsLayout:
    return _StorageFsLayout(_FakeChatFs(tmp_path / "chat"), _FakeSkillsFs(tmp_path / "skills"))


def test_storage_fs_layout_delegates_to_underlying_fs(tmp_path: Path) -> None:
    layout = _fake_layout(tmp_path)

    assert layout.turn_path(7, "alice", 42) == tmp_path / "chat" / "ai" / "7" / "alice" / "turn" / "42"
    assert layout.workspace_path(7, "alice") == tmp_path / "chat" / "ai" / "7" / "alice" / "workspace"
    assert layout.chat_root == tmp_path / "chat"
    assert layout.skill_root == tmp_path / "skills"
    assert layout.skill_roots(project_id=3, agent_id="ag1") == [
        ("project", 3, tmp_path / "skills" / "project" / "3"),
        ("agent", "ag1", tmp_path / "skills" / "agent" / "ag1"),
    ]


def test_storage_fs_layout_plan_exists_delegates(tmp_path: Path) -> None:
    layout = _fake_layout(tmp_path)
    chat_fs = layout._chat_fs
    chat_fs.plan.existing.add((7, "alice", 42, 0))

    assert layout.plan_exists(7, "alice", 42, conversation_id=0) is True
    assert layout.plan_exists(7, "alice", 42, conversation_id=9) is False
    assert chat_fs.plan.calls == [(7, "alice", 42, 0), (7, "alice", 42, 9)]


def test_storage_fs_layout_satisfies_protocol(tmp_path: Path) -> None:
    assert isinstance(_fake_layout(tmp_path), WorkspaceLayout)


def test_set_workspace_layout_override_is_honored(tmp_path: Path) -> None:
    layout = _fake_layout(tmp_path)
    token = set_workspace_layout(layout)
    try:
        assert workspace_layout() is layout
    finally:
        reset_workspace_layout(token)


def test_reset_workspace_layout_restores_previous(tmp_path: Path) -> None:
    first = _fake_layout(tmp_path)
    second = _fake_layout(tmp_path / "second")

    outer = set_workspace_layout(first)
    try:
        inner = set_workspace_layout(second)
        assert workspace_layout() is second
        reset_workspace_layout(inner)
        assert workspace_layout() is first
    finally:
        reset_workspace_layout(outer)
