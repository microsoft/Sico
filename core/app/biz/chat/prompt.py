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
    "task": (_BASE_PROMPT_FILE, "task_rules.md"),
}

# Optional override directory for hot-reloading prompts without redeploying.
# When ``CHAT_PROMPTS_DIR`` points at a writable location (defaults to
# ``/mnt/storage/chat/prompts``), any prompt file present there wins over the
# packaged copy, and edits are picked up on the next read - no image rebuild or
# pod restart required.
_PROMPT_DIR_ENV = "CHAT_PROMPTS_DIR"

# Cache of resolved-path -> (mtime, text). Keeps repeated reads cheap while
# still reflecting on-disk edits: a changed mtime invalidates the entry.
_PROMPT_CACHE: dict[str, tuple[float, str]] = {}


def _override_prompt_dir() -> Path | None:
    raw = os.getenv(_PROMPT_DIR_ENV, "/mnt/storage/chat/prompts").strip()
    return Path(raw) if raw else None


def _resolve_prompt_path(filename: str | Path) -> Path:
    """Resolve a prompt filename to a concrete path.

    If ``CHAT_PROMPTS_DIR`` is set and contains the file, that override copy is
    used so prompts can be hot-updated on a mounted volume. Otherwise fall back
    to the packaged ``prompts/`` directory.
    """
    override_dir = _override_prompt_dir()
    if override_dir is not None:
        candidate = override_dir / filename
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            _LOGGER.warning("Failed to stat override prompt; using packaged copy", extra={"file": str(candidate)})
    return _PROMPT_DIR / filename


def _render_template(text: str, **kwargs) -> str:
    replacements = {"sico_port": os.getenv("SICO_PORT", "8080"), **kwargs}
    text = text.replace("{SICO_PORT}", str(replacements["sico_port"]))
    for key, value in replacements.items():
        text = text.replace("{{" + key + "}}", str(value))
    return text


def read_prompt_file(filename: str | Path, *, fallback: str = "You are a helpful AI assistant.\n\n") -> str:
    path = _resolve_prompt_path(filename)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        _LOGGER.warning("Prompt file not found; using fallback", extra={"file": str(path)})
        return fallback

    key = str(path)
    cached = _PROMPT_CACHE.get(key)
    if cached is not None and cached[0] == mtime:
        return cached[1]

    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        _LOGGER.warning("Prompt file not readable; using fallback", extra={"file": str(path)})
        return fallback

    _PROMPT_CACHE[key] = (mtime, text)
    return text


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
