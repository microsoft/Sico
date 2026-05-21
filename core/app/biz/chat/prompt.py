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
from enum import StrEnum
from pathlib import Path

_LOGGER = logging.getLogger(__name__)

class PromptFile(StrEnum):
    SYSTEM = "chat_system_prompt.md"
    RECOMMENDATION_TASK = "recommendation_task_gen_prompt.md"

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"

def read_prompt_file(filename: str | Path) -> str:
    path = _PROMPT_DIR / filename
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        _LOGGER.warning("Prompt file not found; using fallback", extra={"file": str(path)})
        return "You are a helpful AI assistant.\n\n"

def compose_system_prompt(prompt: PromptFile, **kwargs) -> str:
    base_prompt = read_prompt_file(prompt)
    # format with {{key}} to value in kwargs
    # cannot directly use str.format because it uses {...} not {{...}}
    for key, value in kwargs.items():
        placeholder = "{{" + key + "}}"
        base_prompt = base_prompt.replace(placeholder, str(value))
    return base_prompt
