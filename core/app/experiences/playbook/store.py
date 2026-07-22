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

"""Playbook storage adapter bridging Playbook ↔ StorageFS.

Usage:
    from app.experiences.playbook import PlaybookStore

    store = PlaybookStore()
    store.save(playbook, agent_instance_id=129)
    playbook = store.load(agent_instance_id=129)
"""

from __future__ import annotations

import logging

from app.storage.fs import PLAYBOOK_FS

from .model import Playbook

logger = logging.getLogger(__name__)

_PLAYBOOK_FILENAME = "playbook.json"
_PLAYBOOK_TOON_FILENAME = "playbook.toon"
# resource_id=0 means the "latest" playbook; bump for versioning.
_DEFAULT_RESOURCE_ID = 0


class PlaybookStore:
    """Thin adapter: Playbook ↔ StorageFS.

    Playbooks are stored in the agent-instance scope.
    """

    def __init__(self, resource_id: int = _DEFAULT_RESOURCE_ID) -> None:
        self._resource_id = resource_id

    def _scope_kwargs(self, agent_instance_id: int | None) -> dict[str, int]:
        if agent_instance_id is None:
            return {"agent_instance_id": 0}
        return {"agent_instance_id": agent_instance_id}

    # ---- write --------------------------------------------------------- #
    def save(
        self,
        playbook: Playbook,
        agent_instance_id: int | None = None,
    ) -> str:
        """Persist playbook JSON and companion TOON via StorageFS.

        Returns the absolute path written to.
        """
        content = playbook.dumps()
        scope_kwargs = self._scope_kwargs(agent_instance_id)
        path = PLAYBOOK_FS.write_text(
            self._resource_id,
            _PLAYBOOK_FILENAME,
            content,
            **scope_kwargs,
        )

        try:
            toon_content = playbook.as_prompt() if playbook.bullets() else ""
            PLAYBOOK_FS.write_text(
                resource_id=self._resource_id,
                filename=_PLAYBOOK_TOON_FILENAME,
                content=toon_content,
                **scope_kwargs,
            )
        except ImportError as exc:
            logger.warning("Failed to generate TOON playbook: %s", exc)

        logger.info("Saved playbook (%d bullets) → %s", len(playbook.bullets()), path)
        return str(path)

    # ---- read ---------------------------------------------------------- #
    def load(
        self,
        agent_instance_id: int | None = None,
    ) -> Playbook | None:
        """Load playbook from StorageFS.  Returns None if not found."""
        try:
            text = PLAYBOOK_FS.read_text(
                self._resource_id,
                _PLAYBOOK_FILENAME,
                **self._scope_kwargs(agent_instance_id),
            )
            return Playbook.loads(text)
        except FileNotFoundError:
            logger.info(
                "No playbook found for agent=%s - starting fresh",
                agent_instance_id,
            )
            return None

    # ---- convenience --------------------------------------------------- #
    def load_or_create(
        self,
        agent_instance_id: int | None = None,
    ) -> Playbook:
        """Load existing playbook or return a new empty one."""
        return self.load(agent_instance_id) or Playbook()
