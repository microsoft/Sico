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

"""Per-run execution lifecycle.

:class:`RunCoordinator` drives a single :class:`TaskRun` from claim to terminal
state: it validates the execution policy, acquires the sandbox (via
:class:`SandboxCoordinator`), runs the executor while mirroring progress (via
the :class:`RuntimeProgressPort`), races user cancellation, persists the terminal
result, and releases the sandbox. It owns the per-run stage timing (:class:`RunClock`)
that lands on :attr:`TaskResult.metrics`. It also hosts the scheduler callbacks
``cancel_queued`` and ``prepare_retry``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from .context import TurnContext
from .time_utils import now_ms as _now_ms

from .models import TERMINAL_STATUSES, PlanCancellationRequested
from .run_support import is_plan_cancelled, wait_for_plan_cancelled
from .run_support import STAGE_EXECUTE, STAGE_SANDBOX_ACQUIRE, STAGE_SANDBOX_RELEASE, RunClock
from .config import _reuse_wait_timeout_seconds
from .executors.base import Executor
from .results import ensure_cancelled_state, ensure_result_persisted
from .models import ErrorClass, TaskResult, TaskRun, TaskStatus
from .policy import validate_execution_mode
from .progress_port import RuntimeProgressPort
from .results import blocked_result, cancelled_result, failed_result
from .results import build_policy_denied_result
from .sandbox_coordinator import SandboxCoordinator
from .sandbox import SandboxNoCapacityError, SandboxUnhealthyError
from .scheduler import _internal_failure_result
from .state_machine import publish_run_transition, transition_run
from .store import RETRYABLE_TERMINAL_STATUSES, RunStore, StaleWorkerError

_LOGGER = logging.getLogger(__name__)


class RunCoordinator:
    """Execute one run end-to-end and surface its terminal result."""

    def __init__(
        self,
        store: RunStore,
        executor: Executor,
        progress: RuntimeProgressPort,
        sandbox: SandboxCoordinator,
    ) -> None:
        self._store = store
        self._executor = executor
        self._progress = progress
        self._sandbox = sandbox

    # -- scheduler entrypoints ----------------------------------------------

    async def execute(self, ctx: TurnContext, run: TaskRun) -> TaskResult:
        if run.status in TERMINAL_STATUSES:
            detail = await self._store.get_task_detail(run.run_id, "summary")
            if detail.result is not None:
                await self._progress.mark_run_terminal(ctx, run, detail.result)
                return detail.result
        if run._runtime_reuse:
            return await self._wait_for_existing_run(ctx, run)
        return await self._execute_run_once(ctx, run)

    async def cancel_queued(self, ctx: TurnContext, run: TaskRun, reason: str) -> TaskResult:
        return await self._mark_run_cancelled(ctx, run, reason)

    async def prepare_retry(self, ctx: TurnContext, run: TaskRun, result: TaskResult) -> TaskRun | None:
        backoff_seconds = max(0, run.execution_policy.retry.backoff_seconds)
        if backoff_seconds:
            await asyncio.sleep(backoff_seconds)
        next_run = await self._store.get_run(run.run_id)
        # Bind the compare-and-set baseline to the attempt THIS retry decision was
        # made for (``run.attempt``). If the fresh row is no longer that exact
        # retryable-terminal attempt — already retried by another path, reopened,
        # cancelled, or swept — the decision is stale: return None so the scheduler
        # records the prior result instead of over-retrying past max_attempts.
        if next_run.status not in RETRYABLE_TERMINAL_STATUSES or next_run.attempt != run.attempt:
            _LOGGER.warning(
                "task_runtime.run %s can no longer be reopened for retry "
                "(status=%s, stored_attempt=%d, decided_attempt=%d); recording prior result",
                run.run_id,
                next_run.status.value,
                next_run.attempt,
                run.attempt,
            )
            return None
        expected_attempt = run.attempt
        prior_status = next_run.status
        next_run.attempt = expected_attempt + 1
        next_run.worker_id = None
        next_run.fencing_token = ""
        next_run.sandbox = None
        next_run.sandbox_released = False
        next_run.lease_outcome = ""
        # Re-queueing begins a fresh attempt: stamp a new enqueue time so age-based
        # staleness checks and started_at fallbacks measure THIS attempt rather than
        # the run's first enqueue.
        next_run.queued_at = _now_ms()
        next_run.started_at = None
        next_run.heartbeat_at = None
        next_run.ended_at = None
        # Reset the failed attempt's progress so the requeued run does not carry
        # a stale "latest progress" line into detail / recovery views.
        next_run.latest_progress_message = ""
        next_run.latest_progress_at = 0
        next_run.last_error_class = result.error_class
        next_run.last_error = result.error_message
        # Reopen the SAME run row (terminal -> queued) under a CAS guard instead of
        # creating a sibling row, so every batch_item_index keeps exactly one run
        # row and the result/progress counts stay correct by construction. Any
        # failure to reopen — a CAS rejection or a backend/network error — degrades
        # to "no retry": the run stays in its prior terminal state and the scheduler
        # records that result, so one run's failed retry never aborts its siblings.
        # If a reopen commits server-side but the client sees an error, the row is
        # left QUEUED while the scheduler records the prior terminal result; the
        # batch-finalization sweep reconciles that orphan back to the recorded
        # result, so counts stay correct.
        try:
            # Apply QUEUED in memory but DEFER the event until the reopen persists,
            # so a rejected reopen never emits a phantom FAILED -> QUEUED transition.
            transition_run(next_run, TaskStatus.QUEUED, publish_event=False)
            await self._store.reopen_run_for_retry(next_run, expected_attempt=expected_attempt)
        except StaleWorkerError:
            # Expected: the run is no longer reopenable at this attempt (a concurrent
            # or duplicate reopen, cancellation, or sweep).
            _LOGGER.warning(
                "task_runtime.run %s could not be reopened for retry at attempt %d; recording prior result",
                run.run_id,
                expected_attempt,
            )
            return None
        except Exception:
            # Unexpected: a backend / network failure while persisting the reopen.
            # One run's failed retry must not abort the whole batch, so fall back
            # to recording its prior terminal result. (asyncio.CancelledError is a
            # BaseException and still propagates, so turn cancellation is unaffected.)
            _LOGGER.warning(
                "task_runtime.run %s reopen for retry failed unexpectedly at attempt %d; recording prior result",
                run.run_id,
                expected_attempt,
                exc_info=True,
            )
            return None
        # Reopen committed: it is now safe to announce the FAILED -> QUEUED transition.
        publish_run_transition(next_run, from_status=prior_status)
        await self._progress.mark_retry_pending(ctx, next_run)
        return next_run

    async def _mark_run_cancelled(self, ctx: TurnContext, run: TaskRun, reason: str) -> TaskResult:
        result = cancelled_result(run, reason)
        try:
            token = await self._store.claim_run(run.run_id, "task-manager")
            await self._store.write_result(run.run_id, result, token)
        except StaleWorkerError:
            with contextlib.suppress(Exception):
                await self._store.cancel_run(run.run_id, reason)
        with contextlib.suppress(Exception):
            run = await self._store.get_run(run.run_id)
        await self._progress.mark_run_terminal(ctx, run, result)
        return result

    # -- reuse path ---------------------------------------------------------

    async def _wait_for_existing_run(self, ctx: TurnContext, run: TaskRun) -> TaskResult:
        started_at = _now_ms()
        wait_timeout = _reuse_wait_timeout_seconds(run)
        deadline = time.monotonic() + wait_timeout
        while time.monotonic() < deadline:
            detail = await self._store.get_task_detail(run.run_id, "summary")
            if detail.result is not None:
                await self._progress.mark_run_terminal(ctx, detail.run, detail.result)
                return detail.result
            if detail.run.status in TERMINAL_STATUSES:
                break
            await asyncio.sleep(0.5)
        now_ms = _now_ms()
        result = TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.BLOCKED,
            title=run.spec.title,
            summary=f"Timed out waiting for prior run {run.run_id} to finish.",
            error_class=ErrorClass.TRANSIENT,
            error_message=f"Timed out waiting for prior run after {wait_timeout}s.",
            started_at=started_at,
            ended_at=now_ms,
            duration_ms=now_ms - started_at,
        )
        await self._progress.mark_run_terminal(ctx, run, result)
        return result

    # -- main execution path ------------------------------------------------

    async def _execute_run_once(self, ctx: TurnContext, run: TaskRun) -> TaskResult:  # noqa: PLR0911, PLR0915
        clock = RunClock()
        terminal_result: TaskResult | None = None
        sandbox_released = False
        if await is_plan_cancelled(ctx):
            return await self._mark_run_cancelled(ctx, run, "Task cancelled before execution.")
        policy_error = validate_execution_mode(run.spec, run.execution_policy)
        if policy_error is not None:
            result = build_policy_denied_result(run, f"Task denied by policy: {policy_error.value}")
            token = await self._store.claim_run(run.run_id, "task-manager")
            await self._store.write_result(run.run_id, result, token)
            await self._progress.mark_run_terminal(ctx, run, result)
            return result
        await self._progress.run_stage(
            ctx,
            run,
            stage="workspace",
        )
        lease_outcome = "clean"
        try:
            if run.spec.required_sandbox:
                await self._progress.run_stage(
                    ctx,
                    run,
                    stage="runner",
                )
                with clock.measure(STAGE_SANDBOX_ACQUIRE):
                    await self._sandbox.acquire(ctx, run)
            if await is_plan_cancelled(ctx):
                result = await self._mark_run_cancelled(ctx, run, "Task cancelled after resource acquisition.")
                terminal_result = result
                lease_outcome = "dirty"
                return result
            result = await self._execute_with_progress(ctx, run, clock)
            terminal_result = result
            if result.status != TaskStatus.COMPLETED:
                lease_outcome = "dirty"
            await self._progress.mark_run_terminal(ctx, run, result)
            return result
        except SandboxNoCapacityError as exc:
            result = blocked_result(run, str(exc), ErrorClass.SANDBOX_NO_CAPACITY)
            token = await self._store.claim_run(run.run_id, "task-manager")
            await self._store.write_result(run.run_id, result, token)
            terminal_result = result
            await self._progress.mark_run_terminal(ctx, run, result)
            return result
        except SandboxUnhealthyError as exc:
            lease_outcome = "dirty"
            result = failed_result(run, str(exc), ErrorClass.SANDBOX_UNHEALTHY)
            token = await self._store.claim_run(run.run_id, "task-manager")
            await self._store.write_result(run.run_id, result, token)
            terminal_result = result
            await self._progress.mark_run_terminal(ctx, run, result)
            return result
        except PlanCancellationRequested:
            lease_outcome = "dirty"
            result = await self._mark_run_cancelled(ctx, run, "Task cancelled by user.")
            terminal_result = result
            return result
        except asyncio.CancelledError:
            lease_outcome = "dirty"
            raise
        except Exception as exc:
            lease_outcome = "dirty"
            result = _internal_failure_result(run, exc)
            with contextlib.suppress(Exception):
                result = await ensure_result_persisted(self._store, run, result)
            terminal_result = result
            with contextlib.suppress(Exception):
                await self._progress.mark_run_terminal(ctx, run, result)
            return result
        finally:
            with clock.measure(STAGE_SANDBOX_RELEASE):
                sandbox_released = await self._sandbox.release(ctx, run, lease_outcome)
            if terminal_result is not None:
                terminal_result = self._attach_metrics(terminal_result, clock)
                await self._progress.mark_run_terminal(
                    ctx,
                    run,
                    terminal_result,
                    sandbox_released=sandbox_released,
                    lease_outcome=lease_outcome,
                )

    async def _execute_with_progress(self, ctx: TurnContext, run: TaskRun, clock: RunClock) -> TaskResult:
        if run.spec.required_sandbox:
            await self._progress.run_stage(
                ctx,
                run,
                stage="execute",
            )
        else:
            await self._progress.run_stage(ctx, run, stage="runner")
            await self._progress.run_stage(ctx, run, stage="execute")
        progress_stop = asyncio.Event()
        progress_task = asyncio.create_task(self._progress.mirror_run_progress(ctx, run, progress_stop))
        executor_task = asyncio.create_task(self._executor.run(run, self._store))
        cancel_task = asyncio.create_task(wait_for_plan_cancelled(ctx))
        execute_started = time.monotonic()
        try:
            done, _ = await asyncio.wait({executor_task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
            if cancel_task in done and cancel_task.result():
                await self._progress.run_stage(ctx, run, stage="execute")
                executor_task.cancel()
                try:
                    result = await executor_task
                except asyncio.CancelledError:
                    result = cancelled_result(run, "Task cancelled by user.")
                except StaleWorkerError:
                    result = cancelled_result(run, "Task cancelled by user.")
                if result.status == TaskStatus.CANCELLED:
                    with contextlib.suppress(Exception):
                        await self._store.cancel_run(run.run_id, "Task cancelled by user.")
            else:
                result = await executor_task
        finally:
            clock.record(STAGE_EXECUTE, int((time.monotonic() - execute_started) * 1000))
            if not executor_task.done():
                executor_task.cancel()
                with contextlib.suppress(Exception, asyncio.CancelledError):
                    await executor_task
            cancel_task.cancel()
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await cancel_task
            progress_stop.set()
            with contextlib.suppress(Exception):
                await progress_task
        result = self._attach_metrics(result, clock)
        if result.status == TaskStatus.CANCELLED:
            await ensure_cancelled_state(self._store, run, result)
        else:
            result = await ensure_result_persisted(self._store, run, result)
        if result.primary_artifact is not None:
            await self._progress.run_stage(ctx, run, stage="upload")
        return result

    @staticmethod
    def _attach_metrics(result: TaskResult, clock: RunClock) -> TaskResult:
        metrics = clock.as_metrics()
        if not metrics:
            return result
        return result.model_copy(update={"metrics": {**result.metrics, **metrics}})
