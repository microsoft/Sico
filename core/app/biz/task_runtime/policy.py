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

"""Runtime execution-policy resolution.

Lives at the task_runtime root so the manager can reach it directly.

The ``executor`` it stamps is a coarse execution-semantics marker
(``in_process`` vs ``command_backend``); the concrete backend host
(local / docker / k8s) is resolved independently by
:func:`app.biz.task_runtime.executors.command_backend.select_backend`.
"""

from __future__ import annotations

from .models import ErrorClass, RetryPolicy, SkillDispatch, TaskExecutionPolicy, TaskSpec


def _resolve_policy(task: TaskSpec) -> TaskExecutionPolicy:
    timeout_seconds = int(task.args.get("timeout_seconds") or 600)
    is_skill = isinstance(task.dispatch, SkillDispatch)
    needs_command_backend = bool(task.required_sandbox) or is_skill
    executor = "command_backend" if needs_command_backend else "in_process"
    if needs_command_backend:
        retry = RetryPolicy(
            max_attempts=2,
            retry_on=[ErrorClass.TRANSIENT, ErrorClass.SANDBOX_UNHEALTHY, ErrorClass.TIMEOUT],
        )
    else:
        retry = RetryPolicy()
    return TaskExecutionPolicy(
        timeout_seconds=timeout_seconds,
        executor=executor,
        retry=retry,
        trust_level="platform_signed",
    )


def validate_execution_mode(task: TaskSpec, policy: TaskExecutionPolicy) -> ErrorClass | None:
    # Sub-agent dispatch is a first-class executor path (DispatchRouter →
    # SubAgentExecutor) that enforces its own capability allow-list, so it is
    # not checked here.
    if task.required_sandbox is not None and policy.executor == "in_process":
        return ErrorClass.POLICY_DENY
    return None
