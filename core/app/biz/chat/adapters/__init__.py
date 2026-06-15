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

"""Adapter registry for the TASK route's task-builder LLM.

Each adapter converts a structured :class:`AdapterInput` into a
:class:`PreparedTaskBatch` that the TASK route hands directly to
``TaskManager.submit_prepared``.
"""

from __future__ import annotations

from ..types import Adapter
from .general.adapter import GeneralAdapter
from .workbook.adapter import WorkbookAdapter


def build_default_adapters() -> dict[str, Adapter]:
    """Return the per-turn adapter registry, keyed by adapter name."""
    return {
        WorkbookAdapter.name: WorkbookAdapter(),
        GeneralAdapter.name: GeneralAdapter(),
    }


__all__ = ["GeneralAdapter", "WorkbookAdapter", "build_default_adapters"]
