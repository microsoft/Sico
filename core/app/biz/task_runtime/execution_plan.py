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

"""Transient batch execution-planning models.

These are scheduling inputs computed by the submitter just before a batch runs;
they are *not* persisted and *not* part of the rendering layer. The submitter
derives concurrency lanes and per-sandbox-OS resource gates from them, then
folds a representative summary into the persisted :class:`BatchRecord`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SandboxTypePlan:
    """Per-sandbox-OS capacity slice of a batch's execution plan.

    A single batch can mix tasks bound to different sandbox OSes (e.g. an
    ``android`` run next to a ``windows`` run) plus sandbox-free tasks. Each OS
    leases from its own machine fleet, so its concurrency must be gated against
    *its own* idle capacity — never collapsed onto a single representative,
    which would throttle one fleet by another's saturation.
    """

    sandbox_type: str
    task_count: int
    concurrency: int
    available_count: int | None = None


@dataclass(frozen=True)
class BatchExecutionPlan:
    total_count: int
    concurrency: int
    planned_batch_sizes: tuple[int, ...]
    # ``sandbox_plans`` is the authoritative per-type breakdown that drives the
    # scheduler's resource gate. The scalar ``sandbox_*`` fields below are a
    # representative summary (primary/highest-priority bucket + aggregates) kept
    # for the persisted ``BatchRecord`` projection and the batch-level fallback
    # caption; they must never be used to size concurrency on their own.
    sandbox_type: str | None = None
    sandbox_task_count: int = 0
    sandbox_concurrency: int | None = None
    available_sandbox_count: int | None = None
    sandbox_plans: tuple[SandboxTypePlan, ...] = ()
