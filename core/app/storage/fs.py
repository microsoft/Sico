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

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from app.storage.plan_fs import PlanFS
from app.utils.sanitize import sanitize_user_id

_LOGGER = logging.getLogger(__name__)

_WORKSPACE_HIDDEN_DIRS = {"history"}


class StorageFS:
    """Filesystem helper for project/agent/agent-instance-scoped resources.

    Three independent root locations:
      - project level:        ``root/project/{project_id}/{resource_dir}``
      - agent level:          ``root/agent/{agent_id}/{resource_dir}``
      - agent-instance level: ``root/agent_instance/{agent_instance_id}/{resource_dir}``

    ``roots()`` returns entries for every scope whose ID is non-zero/non-None.
    ``read_text()`` / ``write_text()`` require exactly **one** ID to be provided.
    """

    def __init__(self, root: Path, resource_dir: str) -> None:
        self._root = root
        self._resource_dir = resource_dir

    @property
    def root(self) -> Path:
        return self._root

    # ---- helpers ------------------------------------------------------- #

    def _scope_path(
        self,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
        resource_id: int,
        must_exist: bool = True,
    ) -> Path:
        """Return the path for a single scope + resource."""
        if project_id:
            path = self._root / "project" / str(project_id) / self._resource_dir / str(resource_id)
        elif agent_id:
            path = self._root / "agent" / agent_id / self._resource_dir / str(resource_id)
        elif agent_instance_id:
            path = self._root / "agent_instance" / str(agent_instance_id) / self._resource_dir / str(resource_id)
        else:
            raise ValueError("exactly one of project_id, agent_id, or agent_instance_id must be provided")
        if must_exist and not path.exists():
            raise FileNotFoundError(f"path does not exist: {path}")
        return path

    @staticmethod
    def _validate_single_id(project_id: int, agent_id: str, agent_instance_id: int) -> None:
        count = sum(1 for v in (project_id, agent_id, agent_instance_id) if v)
        if count != 1:
            raise ValueError(
                f"exactly one of project_id, agent_id, or agent_instance_id must be provided "
                f"(got project_id={project_id}, agent_id={agent_id}, agent_instance_id={agent_instance_id})"
            )

    # ---- public API ---------------------------------------------------- #

    def roots(
        self,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> list[tuple[str, int | str, Path]]:
        """Return ``(scope_name, scope_id, root_path)`` for every provided scope."""
        paths: list[tuple[str, int | str, Path]] = []
        if project_id:
            paths.append(("project", project_id, self._root / "project" / str(project_id) / self._resource_dir))
        if agent_id:
            paths.append(("agent", agent_id, self._root / "agent" / agent_id / self._resource_dir))
        if agent_instance_id:
            paths.append(
                (
                    "agent_instance",
                    agent_instance_id,
                    self._root / "agent_instance" / str(agent_instance_id) / self._resource_dir,
                )
            )
        return paths

    def resolve_file_path(
        self,
        resource_id: int,
        filename: str,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> Path:
        # Search across all provided scopes (agent > project > agent_instance)
        scope_roots = self.roots(
            project_id=project_id,
            agent_id=agent_id,
            agent_instance_id=agent_instance_id,
        )
        for _, _, root_path in scope_roots:
            target = root_path / str(resource_id) / filename
            if target.exists():
                return target
        # Build a descriptive error with all searched paths
        searched = [str(root / str(resource_id) / filename) for _, _, root in scope_roots]
        raise FileNotFoundError(f"file not found, searched: {searched}")

    def read_text(
        self,
        resource_id: int,
        filename: str,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
        encoding: str = "utf-8",
    ) -> str:
        path = self.resolve_file_path(
            resource_id,
            filename,
            project_id=project_id,
            agent_id=agent_id,
            agent_instance_id=agent_instance_id,
        )
        return path.read_text(encoding=encoding)

    def write_text(
        self,
        resource_id: int,
        filename: str,
        content: str,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
        encoding: str = "utf-8",
    ) -> Path:
        self._validate_single_id(project_id, agent_id, agent_instance_id)
        target = (
            self._scope_path(
                project_id=project_id,
                agent_id=agent_id,
                agent_instance_id=agent_instance_id,
                resource_id=resource_id,
                must_exist=False,
            )
            / filename
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding=encoding)
        return target

    def write_bytes(
        self,
        resource_id: int,
        filename: str,
        content: bytes,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> Path:
        self._validate_single_id(project_id, agent_id, agent_instance_id)
        target = (
            self._scope_path(
                project_id=project_id,
                agent_id=agent_id,
                agent_instance_id=agent_instance_id,
                resource_id=resource_id,
                must_exist=False,
            )
            / filename
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return target

    def delete_resource(
        self,
        resource_id: int,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> None:
        """Delete the entire directory for a resource. No-op if it does not exist."""
        self._validate_single_id(project_id, agent_id, agent_instance_id)
        path = self._scope_path(
            project_id=project_id,
            agent_id=agent_id,
            agent_instance_id=agent_instance_id,
            resource_id=resource_id,
            must_exist=False,
        )
        if path.exists():
            shutil.rmtree(path)


_KNOWLEDGE_ROOT = Path(os.getenv("KNOWLEDGE_STORAGE_ROOT", "/mnt/storage/knowledge"))
_SKILLS_ROOT = Path(os.getenv("SKILLS_STORAGE_ROOT", "/mnt/storage/skills"))

KNOWLEDGE_DOCUMENT_FS = StorageFS(
    root=_KNOWLEDGE_ROOT,
    resource_dir="document",
)

KNOWLEDGE_LINK_FS = StorageFS(
    root=_KNOWLEDGE_ROOT,
    resource_dir="link",
)

SKILLS_FS = StorageFS(
    root=_SKILLS_ROOT,
    resource_dir="skill",
)

_PLAYBOOK_ROOT = Path(os.getenv("PLAYBOOK_STORAGE_ROOT", "/mnt/storage/playbook"))

PLAYBOOK_FS = StorageFS(
    root=_PLAYBOOK_ROOT,
    resource_dir="playbook",
)


# =============================================================================
# SC Memory Storage
# =============================================================================

_SC_MEMORY_ROOT = Path(os.getenv("SC_MEMORY_STORAGE_ROOT", "/mnt/storage/sc_memory"))
_CHAT_ROOT = Path(os.getenv("CHAT_STORAGE_ROOT", "/mnt/storage/chat"))


class SCMemoryFS:
    """Filesystem helper for SC (Screen Context) Memory storage.

    Storage structure:
        {root}/{creator_username}/{agent_instance_id}/knowledge.json

    Example:
        /mnt/storage/sc_memory/kexzhang_at_microsoft.com/129/knowledge.json
    """

    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    def _get_knowledge_path(self, creator_username: str, agent_instance_id: int) -> Path:
        """Get the path to the knowledge.json file for a user/agent combination."""
        # Sanitize username for filesystem (replace @ and other special chars)
        safe_username = creator_username.replace("@", "_at_").replace(":", "_")
        return self._root / safe_username / str(agent_instance_id) / "knowledge.json"

    def read_knowledge(self, creator_username: str, agent_instance_id: int) -> str:
        """Read SC Memory knowledge for a user/agent combination.

        Args:
            creator_username: Username of the creator
            agent_instance_id: ID of the agent instance

        Returns:
            JSON string of knowledge data, or empty array if not found
        """
        path = self._get_knowledge_path(creator_username, agent_instance_id)
        if path.exists():
            return path.read_text(encoding="utf-8")
        return "[]"

    def write_knowledge(self, creator_username: str, agent_instance_id: int, content: str) -> Path:
        """Write SC Memory knowledge for a user/agent combination.

        Args:
            creator_username: Username of the creator
            agent_instance_id: ID of the agent instance
            content: JSON string of knowledge data

        Returns:
            Path to the written file
        """
        path = self._get_knowledge_path(creator_username, agent_instance_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def exists(self, creator_username: str, agent_instance_id: int) -> bool:
        """Check if knowledge file exists for a user/agent combination."""
        path = self._get_knowledge_path(creator_username, agent_instance_id)
        return path.exists()

    def get_knowledge_path(self, creator_username: str, agent_instance_id: int) -> Path:
        """Get the path to the knowledge file (public accessor)."""
        return self._get_knowledge_path(creator_username, agent_instance_id)


SC_MEMORY_FS = SCMemoryFS(root=_SC_MEMORY_ROOT)


class ChatFS:
    """Filesystem helper for chat-related filesystem storage.

    Workspace path: {root}/agent_instance/{id}/user/{user}/workspace/
    Skills path:    {root}/agent_instance/{id}/user/{user}/skills/{skill_id}/
    Turn path:      {root}/agent_instance/{id}/user/{user}/turn/{turn_id}/
    """

    def __init__(self, root: Path) -> None:
        self._root = root

        # Plan persistence + Redis-backed locking lives in its own module; ChatFS
        # exposes it as ``self.plan`` so callers do ``CHAT_FS.plan.read(...)``.
        self.plan = PlanFS(self._get_user_path)

    @property
    def root(self) -> Path:
        return self._root

    def _get_user_path(self, agent_instance_id: int, user_id: str) -> Path:
        safe_user_id = sanitize_user_id(user_id)
        return self._root / "agent_instance" / str(agent_instance_id) / "user" / safe_user_id

    def _get_turn_path(self, agent_instance_id: int, user_id: str, turn_id: int) -> Path:
        return self._get_user_path(agent_instance_id, user_id) / "turn" / str(turn_id)

    def get_workspace_path(self, agent_instance_id: int, user_id: str) -> Path:
        """Return the workspace directory path for the given agent instance + user."""
        return self._get_user_path(agent_instance_id, user_id) / "workspace"

    def get_user_path(self, agent_instance_id: int, user_id: str) -> Path:
        """Return the user-scoped chat storage root for the given agent instance + user."""
        return self._get_user_path(agent_instance_id, user_id)

    def get_skill_path(self, agent_instance_id: int, user_id: str, skill_id: int) -> Path:
        """Return the staged skill storage path for the given agent instance + user + skill."""
        return self._get_user_path(agent_instance_id, user_id) / "skills" / str(skill_id)

    def get_turn_path(self, agent_instance_id: int, user_id: str, turn_id: int) -> Path:
        """Return the turn directory path for the given agent instance + user + turn."""
        return self._get_turn_path(agent_instance_id, user_id, turn_id)

    # ---- workspace file operations ------------------------------------ #

    def write_file(self, agent_instance_id: int, user_id: str, filepath: str, content: str, *, encoding: str = "utf-8") -> Path:
        """Write a file to the workspace/ directory."""
        workspace = self.get_workspace_path(agent_instance_id, user_id)
        target = workspace / filepath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding=encoding)
        return target

    def read_file(self, agent_instance_id: int, user_id: str, filename: str, *, encoding: str = "utf-8") -> str:
        """Read a file from the workspace/ directory."""
        workspace = self.get_workspace_path(agent_instance_id, user_id)
        target = workspace / filename
        if not target.exists():
            raise FileNotFoundError(f"file not found at {target}")
        return target.read_text(encoding=encoding)

    def delete_file(self, agent_instance_id: int, user_id: str, filepath: str) -> None:
        """Delete a file or directory from the workspace/ directory."""
        workspace = self.get_workspace_path(agent_instance_id, user_id)
        target = (workspace / filepath).resolve()
        if not target.is_relative_to(workspace.resolve()):
            raise ValueError("filepath must be within the workspace directory")
        if target.is_file():
            target.unlink()
        elif target.is_dir():
            shutil.rmtree(target)
        else:
            raise FileNotFoundError(f"file not found: {filepath}")

    def list_files(self, agent_instance_id: int, user_id: str) -> list[dict[str, Any]]:
        """List all files under the workspace/ directory, returning relative paths and sizes."""
        workspace = self.get_workspace_path(agent_instance_id, user_id)
        if not workspace.exists():
            return []
        entries: list[dict[str, Any]] = []
        for p in sorted(workspace.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(workspace).as_posix()
            if rel.split("/", 1)[0] in _WORKSPACE_HIDDEN_DIRS:
                continue
            try:
                size_kb = round(p.stat().st_size / 1024, 1)
            except Exception:
                size_kb = 0
            entries.append({"path": rel, "size_kb": size_kb})
        return entries

    def resolve_workspace_file(self, agent_instance_id: int, user_id: str, filepath: str) -> Path:
        """Resolve a workspace-relative path to an absolute path with traversal protection."""
        workspace = self.get_workspace_path(agent_instance_id, user_id)
        target = (workspace / filepath).resolve()
        if not target.is_relative_to(workspace.resolve()):
            raise ValueError("filepath must be within the workspace directory")
        return target

    # ---- turn-scoped operations (report, conversation) ---------- #

    def write_report(
        self,
        agent_instance_id: int,
        user_id: str,
        turn_id: int,
        filename: str,
        content: str,
        *,
        encoding: str = "utf-8",
    ) -> Path:
        """Write a report markdown file to the report/ directory under the turn path."""
        turn_path = self._get_turn_path(agent_instance_id, user_id, turn_id)
        target = turn_path / "report" / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding=encoding)
        return target

    def write_conversation(
        self,
        agent_instance_id: int,
        user_id: str,
        turn_id: int,
        content: str,
        *,
        encoding: str = "utf-8",
    ) -> Path:
        """Write conversation.json under the turn path."""
        turn_path = self._get_turn_path(agent_instance_id, user_id, turn_id)
        target = turn_path / "conversation.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            content = json.dumps(json.loads(content), ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            pass
        target.write_text(content, encoding=encoding)
        return target

    def read_conversation(self, agent_instance_id: int, user_id: str, turn_id: int, *, encoding: str = "utf-8") -> str | None:
        """Read conversation.json from the turn path. Returns None if not found."""
        turn_path = self._get_turn_path(agent_instance_id, user_id, turn_id)
        target = turn_path / "conversation.json"
        if not target.exists():
            return None
        return target.read_text(encoding=encoding)

    def list_turn_ids(self, agent_instance_id: int, user_id: str) -> list[int]:
        """List all turn IDs for the given agent instance + user, sorted ascending."""
        turn_dir = self._get_user_path(agent_instance_id, user_id) / "turn"
        if not turn_dir.exists():
            return []
        ids: list[int] = []
        for d in turn_dir.iterdir():
            if d.is_dir():
                try:
                    ids.append(int(d.name))
                except ValueError:
                    continue
        return sorted(ids)


CHAT_FS = ChatFS(root=_CHAT_ROOT)


def storage_pvc_root() -> str:
    """Return the root the sandbox PVC mounts (the chat workspace root).

    Every path the sandbox sees lives under the chat root: the workspace and
    result dirs are native to it, and skill runtimes are *copied* into it at
    workspace-init time (see ``workspace_init._stage_skill_runtime_for_workspace``).
    The skills/knowledge/playbook roots are never mounted into the sandbox, so
    the PVC root is exactly the chat root — each sandbox mount is then scoped by
    its ``sub_path`` relative to this directory.

    Override only if the PVC is mounted at a different path than the chat root
    via ``RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT``.
    """
    root = str(_CHAT_ROOT).rstrip("/") or "/"
    _LOGGER.debug("storage_pvc_root=%s", root)
    return root


def parse_skill_frontmatter(content: str) -> dict[str, Any]:
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}

    # Find the closing ---
    end_idx = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}

    import yaml

    yaml_block = "\n".join(lines[1:end_idx])
    try:
        data = yaml.safe_load(yaml_block)
    except yaml.YAMLError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if v is not None}
