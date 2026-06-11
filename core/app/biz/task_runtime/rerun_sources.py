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

from typing import Any

RERUN_SOURCES_DIR = "rerun_sources"
RERUN_SOURCE_SCHEMA_VERSION = 1
RERUN_SOURCE_INLINE_MAX_CHARS = 60000

_RERUN_TASK_FIELDS = (
    "task_id",
    "title",
    "kind",
    "instructions",
    "skill_name",
    "entrypoint",
    "tool_name",
    "args",
    "metadata",
    "required_sandbox",
    "idempotency_key",
)
_PLATFORM_METADATA_KEYS = {"capability", "display"}


def compact_rerun_source_payload(source: dict[str, Any]) -> dict[str, Any]:
    compact = dict(source)
    tasks = source.get("tasks")
    if isinstance(tasks, list):
        compact["tasks"] = [compact_rerun_task_payload(task) if isinstance(task, dict) else task for task in tasks]
    return compact


def compact_rerun_task_payload(task: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    for key in _RERUN_TASK_FIELDS:
        if key not in task:
            continue
        value = compact_rerun_metadata(task[key]) if key == "metadata" else task[key]
        if _is_empty_rerun_value(value):
            continue
        compact[key] = value
    return compact


def compact_rerun_metadata(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    return {
        str(key): value
        for key, value in metadata.items()
        if key not in _PLATFORM_METADATA_KEYS and not _is_empty_rerun_value(value)
    }


def _is_empty_rerun_value(value: Any) -> bool:
    return value is None or value == "" or value == {} or value == []
