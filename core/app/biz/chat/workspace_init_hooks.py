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

"""Hook registry for chat workspace initialization.

Adapters (workbook, future PDF/image processors, etc.) can register:

* **History subdirectories** — per-turn directory names that should be copied
  from the prior-turn chat-fs store into the workspace ``history/`` tree.
* **Attachment hooks** — callbacks invoked after each attachment is downloaded
  into ``workspace/attachments/`` so adapters can index or archive it.

Keeps ``workspace_init`` free of adapter-specific imports.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class AttachmentHookContext:
    path: Path
    name: str
    attachment_type: str
    agent_instance_id: int
    username: str
    turn_id: int


AttachmentHook = Callable[[AttachmentHookContext], None]

_HISTORY_SUBDIRS: list[str] = []
_ATTACHMENT_HOOKS: list[AttachmentHook] = []


def register_history_subdir(name: str) -> None:
    if name and name not in _HISTORY_SUBDIRS:
        _HISTORY_SUBDIRS.append(name)


def iter_history_subdirs() -> tuple[str, ...]:
    return tuple(_HISTORY_SUBDIRS)


def register_attachment_hook(hook: AttachmentHook) -> None:
    if hook not in _ATTACHMENT_HOOKS:
        _ATTACHMENT_HOOKS.append(hook)


def dispatch_attachment_hooks(context: AttachmentHookContext) -> None:
    for hook in list(_ATTACHMENT_HOOKS):
        try:
            hook(context)
        except Exception:
            _LOGGER.exception("workspace_init attachment hook failed: %s", getattr(hook, "__name__", hook))
