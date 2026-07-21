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

"""Workbook-aware workspace-init hooks.

Registered automatically when the workbook adapter package is imported.

* Archives newly downloaded workbook attachments into the structured
  case-source store (``workspace/case_sources/parsed_documents/``) used by
  :mod:`extract_workbook_cases`.
"""

from __future__ import annotations

from app.biz.chat.workspace_init_hooks import (
    AttachmentHookContext,
    register_attachment_hook,
)

from .archive import archive_workbook_attachment_source
from .workbook_cases import SUPPORTED_WORKBOOK_SUFFIXES, workbook_case_sources, workbook_manifest


def _workbook_attachment_hook(context: AttachmentHookContext) -> None:
    if context.path.suffix.lower() not in SUPPORTED_WORKBOOK_SUFFIXES or context.agent_instance_id <= 0 or context.turn_id <= 0:
        return
    manifest = workbook_manifest(context.path)
    if not manifest:
        return
    sources = workbook_case_sources(context.path, manifest)
    if not sources:
        return
    archive_workbook_attachment_source(
        agent_instance_id=context.agent_instance_id,
        username=context.username,
        conversation_id=context.conversation_id,
        file_path=f"attachments/{context.name}",
        data_rows=int(manifest.get("runnable_data_rows") or manifest.get("total_data_rows") or 0),
        workbook_manifest=manifest,
        workbook_case_sources=sources,
    )


register_attachment_hook(_workbook_attachment_hook)
