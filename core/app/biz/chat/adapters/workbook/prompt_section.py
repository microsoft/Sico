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

"""Workbook-aware chat prompt sections.

Registered automatically when the workbook adapter package is imported. Adds
two sections to the chat orchestration's context bundle:

* ``case_source_resolution`` — intent / source / candidates JSON for messages
  that mention case IDs.
* ``prior_parsed_workbook_sources`` — structured prior-turn workbook sources
  so ``delegate`` with ``kind="workbook"`` can target them without re-parsing.
"""

from __future__ import annotations

from app.biz.chat.prompt_sections import (
    PromptSectionContext,
    register_prompt_section_provider,
)

from .manifests import (
    render_case_source_resolution_section,
    render_prior_parsed_workbook_sources_section,
)


def _workbook_prompt_sections(context: PromptSectionContext) -> dict[str, str]:
    chat_request = context.chat_request
    message = chat_request.message.content or ""
    attachments = list(chat_request.message.attachments) + list(chat_request.agent_attachments)
    attachment_names = tuple(attachment.name for attachment in attachments)
    return {
        "case_source_resolution": render_case_source_resolution_section(
            context.workspace,
            message,
            current_attachment_names=attachment_names,
        ),
        "prior_parsed_workbook_sources": render_prior_parsed_workbook_sources_section(context.workspace, message),
    }


register_prompt_section_provider(_workbook_prompt_sections)
