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

"""Plan-file persistence and locking under each chat user's workspace.

Split out of :mod:`app.storage.fs` so the plan read/write/cancel concerns —
including the Redis-backed exclusive lock used to serialize concurrent
writers across processes — live in one focused module.

``PlanFS`` is constructed with a callable resolving the user directory path, so
it stays decoupled from :class:`app.storage.fs.ChatFS` while storing plan files
next to the turn's ``conversation.json``.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable
from pathlib import Path

from app.utils.cache import Cache

UserPathResolver = Callable[[int, str], Path]


class PlanFS:
    """Filesystem + lock helpers for the per-turn ``plan.json`` and cancel marker.

    Methods accept ``conversation_id`` for call-site compatibility, but storage
    remains turn-scoped under ``user/<user>/turn/<turn_id>/`` so ``plan.json``
    lives beside ``conversation.json``. Method names omit the ``plan`` prefix
    because the class itself is plan-scoped — call sites read as
    ``CHAT_FS.plan.read(...)``, ``CHAT_FS.plan.write_lock(...)`` etc.
    """

    def __init__(self, get_user_path: UserPathResolver) -> None:
        self._get_user_path = get_user_path

    # ---- paths --------------------------------------------------------- #

    def _get_dir(self, agent_instance_id: int, user_id: str, turn_id: int, conversation_id: int = 0) -> Path:
        user_path = self._get_user_path(agent_instance_id, user_id)
        return user_path / "turn" / str(turn_id)

    def _get_path(self, agent_instance_id: int, user_id: str, turn_id: int, conversation_id: int = 0) -> Path:
        return self._get_dir(agent_instance_id, user_id, turn_id, conversation_id) / "plan.json"

    def _get_cancel_marker_path(self, agent_instance_id: int, user_id: str, turn_id: int, conversation_id: int = 0) -> Path:
        return self._get_dir(agent_instance_id, user_id, turn_id, conversation_id) / "plan_cancelled"

    def _get_lock_name(self, agent_instance_id: int, user_id: str, turn_id: int, conversation_id: int = 0) -> str:
        """Stable Redis lock key for the plan file of a given turn.

        The actual Redis key used by ``Cache.lock`` is ``lock:<this name>``.
        """
        return f"plan:{agent_instance_id}:{user_id}:{turn_id}"

    # ---- locks --------------------------------------------------------- #

    def read_lock(self, agent_instance_id: int, user_id: str, turn_id: int, *, timeout: int, conversation_id: int = 0):
        """Context manager acquiring an exclusive lock on the plan for reading.

        Backed by Redis (``Cache.lock``) so it serializes across processes within a pod
        and (in the future) across pods sharing the same Redis. We use the same exclusive
        lock for both reads and writes — RW separation is not necessary for this workload.
        """
        return Cache.lock(
            self._get_lock_name(agent_instance_id, user_id, turn_id, conversation_id),
            timeout=timeout,
        )

    def write_lock(self, agent_instance_id: int, user_id: str, turn_id: int, *, timeout: int, conversation_id: int = 0):
        """Context manager acquiring an exclusive lock on the plan for writing.

        See :meth:`read_lock` for details — same lock, same key.
        """
        return Cache.lock(
            self._get_lock_name(agent_instance_id, user_id, turn_id, conversation_id),
            timeout=timeout,
        )

    # ---- read / write / exists ---------------------------------------- #

    def read(
        self,
        agent_instance_id: int,
        user_id: str,
        turn_id: int,
        *,
        encoding: str = "utf-8",
        conversation_id: int = 0,
    ) -> str:
        path = self._get_path(agent_instance_id, user_id, turn_id, conversation_id)
        return path.read_text(encoding=encoding)

    def write(
        self,
        agent_instance_id: int,
        user_id: str,
        turn_id: int,
        content: str,
        *,
        encoding: str = "utf-8",
        conversation_id: int = 0,
    ) -> Path:
        path = self._get_path(agent_instance_id, user_id, turn_id, conversation_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: write to a unique temp file in the same directory, then os.replace().
        # Using a unique name (pid + random suffix via tempfile.mkstemp) means concurrent
        # writers — even if they bypass ``write_lock`` — never clobber each other's
        # in-flight temp file. ``os.replace`` is atomic on the same filesystem on both
        # POSIX and Windows, so readers always see a fully written file.
        fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding=encoding) as fh:
                fh.write(content)
            os.replace(tmp_path, path)
        except BaseException:
            # Best-effort cleanup of the orphan temp file on failure.
            try:
                tmp_path.unlink()
            except FileNotFoundError:
                pass
            raise
        return path

    def exists(self, agent_instance_id: int, user_id: str, turn_id: int, *, conversation_id: int = 0) -> bool:
        return self._get_path(agent_instance_id, user_id, turn_id, conversation_id).exists()

    # ---- cancel marker ------------------------------------------------- #

    def write_cancelled_marker(self, agent_instance_id: int, user_id: str, turn_id: int, *, conversation_id: int = 0) -> Path:
        """Write an empty ``plan_cancelled`` marker file for the given turn."""
        path = self._get_cancel_marker_path(agent_instance_id, user_id, turn_id, conversation_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
        return path

    def is_cancelled(self, agent_instance_id: int, user_id: str, turn_id: int, *, conversation_id: int = 0) -> bool:
        """Check whether the ``plan_cancelled`` marker exists for the given turn."""
        return self._get_cancel_marker_path(agent_instance_id, user_id, turn_id, conversation_id).exists()
