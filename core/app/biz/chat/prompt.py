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

import logging
import os
from enum import StrEnum
from pathlib import Path

_LOGGER = logging.getLogger(__name__)


class PromptFile(StrEnum):
    SYSTEM = "chat_system_prompt.md"
    INTENT_CHECK = "intent_check_system_prompt.md"
    RECOMMENDATION_TASK = "recommendation_task_gen_prompt.md"
    SESSION_TITLE = "session_title_gen_prompt.md"
    COMPACTION_SUMMARIZATION = "compaction_summarization_prompt.md"
    RETRY_CONTINUATION = "retry_continuation_prompt.md"


_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
_BASE_PROMPT_FILE = PromptFile.SYSTEM.value
_PROMPT_FRAGMENTS_BY_MODE = {
    "fast": (_BASE_PROMPT_FILE, "fast_rules.md"),
    "inspect": (_BASE_PROMPT_FILE, "inspect_rules.md"),
    "task": (_BASE_PROMPT_FILE, "task_rules.md"),
}


def _render_template(text: str, **kwargs) -> str:
    replacements = {"sico_port": os.getenv("SICO_PORT", "8080"), **kwargs}
    text = text.replace("{SICO_PORT}", str(replacements["sico_port"]))
    for key, value in replacements.items():
        text = text.replace("{{" + key + "}}", str(value))
    return text


def read_prompt_file(filename: str | Path, *, fallback: str = "You are a helpful AI assistant.\n\n") -> str:
    path = _PROMPT_DIR / filename
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        _LOGGER.warning("Prompt file not found; using fallback", extra={"file": str(path)})
        return fallback


def render_prompt_file(prompt: PromptFile | str | Path, *, fallback: str = "", **kwargs) -> str:
    return _render_template(read_prompt_file(prompt, fallback=fallback), **kwargs)


def compose_system_prompt(
    *,
    prompt_mode: str = "task",
    name: str = "",
    role_name: str = "",
    project_name: str = "",
    skills_section: str = "",
) -> str:
    normalized_mode = str(prompt_mode).lower()
    fragment_files = _PROMPT_FRAGMENTS_BY_MODE.get(normalized_mode)
    if fragment_files is None:
        _LOGGER.warning("Unknown chat prompt mode; falling back to task mode", extra={"prompt_mode": prompt_mode})
        fragment_files = _PROMPT_FRAGMENTS_BY_MODE["task"]

    template_vars = {
        "name": name or "Sico",
        "role_name": role_name or "AI assistant",
        "project_name": project_name or "this",
    }

    fragments: list[str] = []
    for index, filename in enumerate(fragment_files):
        fallback = "You are a helpful AI assistant.\n\n" if index == 0 else ""
        fragment = read_prompt_file(filename, fallback=fallback).strip()
        if fragment:
            fragments.append(_render_template(fragment, **template_vars))

    if skills_section := skills_section.strip():
        fragments.append(skills_section)

    return "\n\n".join(fragments).strip() + "\n"
