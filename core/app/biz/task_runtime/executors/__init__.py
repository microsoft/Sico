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

"""Execution backends for the task runtime.

This package is the single import surface for everything on the *execution* side
of the runtime. The orchestration side (``TaskManager``) depends only on the
:class:`Executor` protocol and holds a :class:`DispatchRouter`.
"""

from __future__ import annotations

from .base import DispatchRouter, Executor
from .tool_executor import ToolExecutor
from .skill_executor import SkillExecutor
from .sub_agent import (
    CapabilityCall,
    CapabilityInvoker,
    ExecutorCapabilityInvoker,
    FinalAnswer,
    Observation,
    SubAgentAction,
    SubAgentExecutor,
    SubAgentLLM,
    SubAgentState,
)

__all__ = [
    "CapabilityCall",
    "CapabilityInvoker",
    "DispatchRouter",
    "Executor",
    "ExecutorCapabilityInvoker",
    "FinalAnswer",
    "ToolExecutor",
    "Observation",
    "SkillExecutor",
    "SubAgentAction",
    "SubAgentExecutor",
    "SubAgentLLM",
    "SubAgentState",
]
