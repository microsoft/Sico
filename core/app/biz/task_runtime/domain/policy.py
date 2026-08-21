"""Runtime execution-policy resolution.

This belongs to the domain layer because it derives a persisted execution policy
solely from a prepared task specification.

The ``executor`` it stamps is a coarse execution-semantics marker
(``in_process`` vs ``command_backend``); the concrete backend host
(local / docker / k8s) is resolved independently by
:func:`app.biz.task_runtime.execution.command.selection.select_backend`.
"""

from __future__ import annotations

from .models import ErrorClass, RetryPolicy, TaskExecutionPolicy, TaskSpec
from ..execution.resources import spec_uses_command_backend


def _resolve_policy(task: TaskSpec) -> TaskExecutionPolicy:
    timeout_seconds = int(task.args.get("timeout_seconds") or 600)
    # Anything lowered to a CommandSpec runs outside this process and is worth a
    # second attempt on a transient/timeout failure. This is a coarse
    # pre-resolution guess: the authoritative environment declaration is the
    # capability descriptor, which the executor re-checks before invoking a
    # handler.
    needs_command_backend = bool(task.required_sandbox) or spec_uses_command_backend(task)
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
    if task.required_sandbox and policy.executor == "in_process":
        return ErrorClass.POLICY_DENY
    return None
