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

"""Post-parse hook registry for the ``parse_document`` tool.

Modules outside ``app.tools`` (e.g. the workbook adapter) register callables
that receive the parse result and can:

* perform side effects (archiving, indexing, downstream notifications), and
* contribute extra fields to the tool response plus message stats.

The registry keeps ``parse_document`` itself free of domain-specific imports.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.tools.common import ToolContext

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class ParseDocumentHookContext:
    ctx: ToolContext
    file_path: str
    abs_path: Path
    full_markdown_path: str
    full_text: str
    summary: str


@dataclass
class ParseDocumentExtras:
    response_fields: dict[str, Any] = field(default_factory=dict)
    message_stats: list[str] = field(default_factory=list)


ParseDocumentHook = Callable[[ParseDocumentHookContext], ParseDocumentExtras | None]

_HOOKS: list[ParseDocumentHook] = []


def register_post_parse_hook(hook: ParseDocumentHook) -> None:
    if hook not in _HOOKS:
        _HOOKS.append(hook)


def unregister_post_parse_hook(hook: ParseDocumentHook) -> None:
    if hook in _HOOKS:
        _HOOKS.remove(hook)


def dispatch_post_parse_hooks(context: ParseDocumentHookContext) -> ParseDocumentExtras:
    merged = ParseDocumentExtras()
    for hook in list(_HOOKS):
        try:
            extras = hook(context)
        except Exception:
            _LOGGER.exception("parse_document post-parse hook failed: %s", getattr(hook, "__name__", hook))
            continue
        if extras is None:
            continue
        merged.response_fields.update(extras.response_fields)
        merged.message_stats.extend(extras.message_stats)
    return merged
