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

"""Task runtime — durable batch execution for agent tool/skill/sub-agent runs.

This package's **public API** is exactly the names re-exported here:

- Entrypoints: :class:`TaskManager`, :func:`default_task_manager`,
  :func:`set_task_manager_factory`, :func:`cancel_turn_task_runtime_once`,
  :func:`run_task_runtime_startup_reconciler`.
- Extension points (protocols a host implements/injects): :class:`RunStore`
  (persistence), :class:`Executor` (execution backend).
- Domain models: the dataclasses/enums describing a batch, run, spec and result.

Everything else (``submitter``, ``run_coordinator``, ``scheduler``, ``progress``,
``rendering``, ``store`` implementations, ``executors`` concrete backends, …) is
an internal implementation detail and may change without notice. Import from the
submodules only if you are extending the runtime itself.
"""

from .executors.base import Executor
from .manager import (
    TaskManager,
    cancel_turn_task_runtime_once,
    default_task_manager,
    run_task_runtime_startup_reconciler,
    set_task_manager_factory,
)
from .models import (
    ArtifactRef,
    BatchRecord,
    BatchResult,
    BatchResultDigest,
    BatchStatus,
    ErrorClass,
    TaskResult,
    TaskResultDigest,
    TaskRun,
    TaskSpec,
    TaskStatus,
    compute_idempotency_key,
)
from .store import RunStore

__all__ = [
    # Entrypoints
    "TaskManager",
    "default_task_manager",
    "set_task_manager_factory",
    "cancel_turn_task_runtime_once",
    "run_task_runtime_startup_reconciler",
    # Extension points (protocols)
    "RunStore",
    "Executor",
    # Domain models
    "ArtifactRef",
    "BatchRecord",
    "BatchResult",
    "BatchResultDigest",
    "BatchStatus",
    "ErrorClass",
    "TaskResult",
    "TaskResultDigest",
    "TaskRun",
    "TaskSpec",
    "TaskStatus",
    "compute_idempotency_key",
]
