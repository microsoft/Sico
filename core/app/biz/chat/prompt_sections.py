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

"""Prompt-section provider registry for chat orchestration.

Adapters contribute named prompt sections (workbook context, future PDF/image
contexts, etc.) without ``ChatService`` having to import their modules.

Each provider receives a :class:`PromptSectionContext` (the live
``ChatRequest`` plus the resolved workspace path) and returns a mapping of
``section_name -> rendered content``.  An empty string or ``None`` means the
provider has nothing to contribute for this turn.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.pb.conversation.api import ChatRequest

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class PromptSectionContext:
    chat_request: "ChatRequest"
    workspace: Path


PromptSectionProvider = Callable[[PromptSectionContext], dict[str, str] | None]

_PROVIDERS: list[PromptSectionProvider] = []


def register_prompt_section_provider(provider: PromptSectionProvider) -> None:
    if provider not in _PROVIDERS:
        _PROVIDERS.append(provider)


def collect_prompt_sections(context: PromptSectionContext) -> dict[str, str]:
    collected: dict[str, str] = {}
    for provider in list(_PROVIDERS):
        try:
            result = provider(context)
        except Exception:
            _LOGGER.exception("chat prompt section provider failed: %s", getattr(provider, "__name__", provider))
            continue
        if not result:
            continue
        for name, value in result.items():
            if value:
                collected[name] = value
    return collected
