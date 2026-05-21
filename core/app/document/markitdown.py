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

"""Markitdown-based document extractor."""

import logging
from pathlib import Path

from app.document.base import DocExtractor

_LOGGER = logging.getLogger(__name__)

_SUMMARY_MAX_TOKENS = 1024
_SUMMARY_MAX_INPUT_LENGTH = 50000
_SUMMARY_PROMPT_PATH = Path(__file__).parent / "prompts" / "summarize.txt"


async def _generate_summary_via_llm(full_text: str) -> str:
    """Generate a summary of the document using an LLM."""
    if not full_text.strip():
        return ""

    from app.llmhubs import generate
    from app.llmhubs.request_builder import build_llm_request

    text = full_text[:_SUMMARY_MAX_INPUT_LENGTH] if len(full_text) > _SUMMARY_MAX_INPUT_LENGTH else full_text
    prompt_template = _SUMMARY_PROMPT_PATH.read_text(encoding="utf-8")
    prompt = prompt_template.format(text=text)
    messages = [{"role": "user", "content": prompt}]
    request = build_llm_request(messages, max_tokens=_SUMMARY_MAX_TOKENS)

    try:
        response = await generate(request)
        return response.text.strip()
    except Exception as exc:
        _LOGGER.warning("LLM summary generation failed, returning empty summary: %s", exc)
        return ""


class MarkitdownDocExtractor(DocExtractor):
    """Document extractor using the open-source *markitdown* library."""

    async def extract(self, file_path: str) -> tuple[str, str]:
        _LOGGER.info("Extracting document via markitdown file_path=%s", file_path)
        from markitdown import MarkItDown

        md = MarkItDown()
        result = md.convert(file_path)
        full_text = result.text_content or ""
        summary = await _generate_summary_via_llm(full_text)
        return full_text, summary
