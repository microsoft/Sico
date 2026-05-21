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

"""Document extraction abstractions and factory."""

import logging
import os

from app.document.base import DocExtractor

__all__ = ["DocExtractor", "build_doc_extractor"]


def build_doc_extractor(logger: logging.Logger) -> DocExtractor | None:
    """Build a :class:`DocExtractor` based on the ``DOC_EXTRACTOR`` env var.

    Supported values:
    - ``markitdown``: Local extraction via the *markitdown* library.

    Returns ``None`` when the selected extractor cannot be initialised.
    """
    extractor_type = os.getenv("DOC_EXTRACTOR", "markitdown").strip().lower()

    if extractor_type == "markitdown":
        from app.document.markitdown import MarkitdownDocExtractor

        logger.info("Using markitdown document extractor")
        return MarkitdownDocExtractor()

    logger.error("Unknown DOC_EXTRACTOR value: %s", extractor_type)
    return None
