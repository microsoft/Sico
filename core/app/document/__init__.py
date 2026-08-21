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
