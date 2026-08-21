"""
Integration utilities for the experience learning framework.

This module provides utilities for integrating experience learning capabilities
with external agentic systems and custom agents.
"""

from . import default_parser  # noqa: F401  -- side-effect: register default parser
from .dw_registry import get_dw_parser, register_default_parser, register_dw_parser

__all__ = [
    "get_dw_parser",
    "register_default_parser",
    "register_dw_parser",
]
