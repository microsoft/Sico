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

"""Sandbox reservation / acquisition / release lifecycle.

:class:`SandboxCoordinator` owns everything about a run's sandbox lease: it
reserves + acquires + resets the sandbox (emitting stage UI through the
:class:`RuntimeProgressPort`), publishes the ACQUIRED_SANDBOX deliverable card, and
releases the lease through its three variants (:meth:`release` with retries,
:meth:`release_stale` for cross-instance fallback, :meth:`release_many` for
bulk cleanup). It holds its own (lazily created) lease manager and its own set
of background cleanup tasks.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from .context import TurnContext

from .models import (
    SANDBOX_STAGE_ACQUIRE,
    SANDBOX_STAGE_CAPACITY_WAIT,
    SANDBOX_STAGE_READY,
    SANDBOX_STAGE_RESET,
    TERMINAL_STATUSES,
    PlanCancellationRequested,
)
from .run_support import await_unless_plan_cancelled, is_plan_cancelled, wait_for_plan_cancelled
from .config import _sandbox_release_attempts
from .models import (
    ReservationToken,
    SandboxLeaseRef,
    SandboxRequirement,
    TaskRun,
    TaskStatus,
)
from .progress_events import (
    DeliverableSpec,
    acquired_sandbox_replace_key,
    sandbox_display_name,
)
from .progress_port import RuntimeProgressPort
from .sandbox import ReverseGrpcSandboxLeaseManager, SandboxLeaseManager
from .store import RunStore

_LOGGER = logging.getLogger(__name__)


class SandboxCoordinator:
    """Manage the sandbox lease lifecycle for individual runs."""

    def __init__(
        self,
        store: RunStore,
        progress: RuntimeProgressPort,
        lease_manager: SandboxLeaseManager | None = None,
    ) -> None:
        self._store = store
        self._progress = progress
        self.lease_manager = lease_manager
        self._background_tasks: set[asyncio.Task] = set()

    # -- acquisition --------------------------------------------------------

    async def acquire(self, ctx: TurnContext, run: TaskRun) -> None:
        if self.lease_manager is None:
            self.lease_manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=ctx.agent_instance_id)
        requirement = run.spec.required_sandbox
        if requirement is None:
            return
        if await is_plan_cancelled(ctx):
            raise PlanCancellationRequested
        await self._progress.run_stage(
            ctx,
            run,
            stage=SANDBOX_STAGE_CAPACITY_WAIT,
        )
        reservation = await await_unless_plan_cancelled(
            ctx,
            self.lease_manager.reserve(SandboxRequirement(type=requirement), run.run_id),
        )
        if await is_plan_cancelled(ctx):
            raise PlanCancellationRequested
        await self._progress.run_stage(
            ctx,
            run,
            stage=SANDBOX_STAGE_ACQUIRE,
        )
        run.sandbox = await self._acquire_reserved_sandbox(ctx, reservation)
        run.sandbox_released = False
        run.lease_outcome = ""
        await self._store.update_run(run)
        if await is_plan_cancelled(ctx):
            raise PlanCancellationRequested
        await self._publish_acquired_sandbox(ctx, run)
        await self._progress.run_stage(
            ctx,
            run,
            stage=SANDBOX_STAGE_RESET,
        )
        try:
            await self.lease_manager.reset(run.sandbox)
        except Exception as exc:
            if await is_plan_cancelled(ctx):
                raise PlanCancellationRequested from exc
            _LOGGER.warning(
                "sandbox acquire reset failed; continuing run_id=%s sandbox_id=%s error=%s",
                run.run_id,
                run.sandbox.sandbox_id,
                exc,
                exc_info=True,
            )
        if await is_plan_cancelled(ctx):
            raise PlanCancellationRequested
        await self._store.update_run(run)
        await self._progress.run_stage(
            ctx,
            run,
            stage=SANDBOX_STAGE_READY,
        )

    async def _acquire_reserved_sandbox(self, ctx: TurnContext, reservation: ReservationToken) -> SandboxLeaseRef:
        if self.lease_manager is None:
            raise RuntimeError("sandbox lease manager is not initialized")
        acquire_task = asyncio.create_task(self.lease_manager.acquire(reservation))
        cancel_task = asyncio.create_task(wait_for_plan_cancelled(ctx))
        try:
            done, _ = await asyncio.wait({acquire_task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
            if acquire_task in done:
                return acquire_task.result()
            if cancel_task in done and cancel_task.result():
                self._release_acquired_sandbox_later(acquire_task)
                raise PlanCancellationRequested
            return await acquire_task
        finally:
            cancel_task.cancel()
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await cancel_task

    def _release_acquired_sandbox_later(self, acquire_task: asyncio.Task[SandboxLeaseRef]) -> None:
        async def cleanup() -> None:
            try:
                lease = await acquire_task
            except asyncio.CancelledError:
                return
            except Exception:
                _LOGGER.debug("cancelled sandbox acquire finished without a lease", exc_info=True)
                return
            if self.lease_manager is None:
                return
            try:
                await self.lease_manager.release(lease, "dirty")  # type: ignore[arg-type]
            except Exception:
                _LOGGER.warning(
                    "late sandbox release after cancelled acquire failed sandbox_id=%s",
                    lease.sandbox_id,
                    exc_info=True,
                )

        cleanup_task = asyncio.create_task(cleanup())
        self._background_tasks.add(cleanup_task)
        cleanup_task.add_done_callback(self._background_tasks.discard)

    async def _publish_acquired_sandbox(self, ctx: TurnContext, run: TaskRun) -> None:
        if run.sandbox is None:
            return
        tool_call_id = run.parent_tool_call_id or run.plan_batch_call_id or 0
        if not tool_call_id:
            return
        deliverable = DeliverableSpec.acquired_sandbox(
            sandbox_id=run.sandbox.sandbox_id,
            sandbox_type=run.sandbox.type,
            endpoint=run.sandbox.endpoint,
            provider_base_url=run.sandbox.provider_base_url,
            device_id=run.sandbox.device_id,
            display_name=sandbox_display_name(run.sandbox),
            vnc_url=run.sandbox.vnc_url,
        )
        await self._progress.publish_deliverable(
            ctx,
            tool_call_id,
            deliverable,
            replace_key=acquired_sandbox_replace_key,
        )

    # -- release variants ---------------------------------------------------

    async def release(self, ctx: TurnContext, run: TaskRun, lease_outcome: str) -> bool:
        if run.sandbox is None or self.lease_manager is None:
            return False
        attempts = _sandbox_release_attempts()
        for attempt in range(1, attempts + 1):
            try:
                await self._progress.run_stage(
                    ctx,
                    run,
                    stage="release",
                )
                await self.lease_manager.release(run.sandbox, lease_outcome)  # type: ignore[arg-type]
                await self._set_run_sandbox_release_state(run, released=True, lease_outcome=lease_outcome)
                return True
            except Exception:
                _LOGGER.warning(
                    "sandbox release failed run_id=%s sandbox_id=%s attempt=%s/%s",
                    run.run_id,
                    run.sandbox.sandbox_id,
                    attempt,
                    attempts,
                    exc_info=True,
                )
                if attempt < attempts:
                    await asyncio.sleep(min(2.0, float(attempt)))
        await self._set_run_sandbox_release_state(run, released=False, lease_outcome=lease_outcome)
        return False

    async def release_stale(self, run: TaskRun) -> bool:
        if run.sandbox is None:
            return False
        lease_outcome = run.lease_outcome or "dirty"
        try:
            lease_manager = self._stale_run_sandbox_manager(run)
            await lease_manager.release(run.sandbox, lease_outcome)  # type: ignore[arg-type]
            released = True
        except Exception:
            _LOGGER.warning(
                "stale run sandbox release failed run_id=%s sandbox_id=%s",
                run.run_id,
                run.sandbox.sandbox_id,
                exc_info=True,
            )
            released = False
        run.sandbox_released = released
        run.lease_outcome = lease_outcome
        with contextlib.suppress(Exception):
            current = await self._store.get_run(run.run_id)
            current.sandbox_released = released
            current.lease_outcome = lease_outcome
            await self._store.update_run(current)
        return released

    async def release_many(self, runs: list[TaskRun]) -> None:
        for run in runs:
            if run.status in TERMINAL_STATUSES and run.status != TaskStatus.CANCELLED:
                continue
            if run.sandbox is None or run.sandbox_released:
                continue
            run.lease_outcome = run.lease_outcome or "dirty"
            await self.release_stale(run)

    # -- batch-level helpers ------------------------------------------------

    async def available_count(self, ctx: TurnContext, sandbox_type: str) -> int | None:
        if self.lease_manager is None:
            self.lease_manager = ReverseGrpcSandboxLeaseManager(agent_instance_id=ctx.agent_instance_id)
        counter = getattr(self.lease_manager, "available_count", None)
        if not callable(counter):
            return None
        try:
            return max(0, int(await counter(sandbox_type)))
        except Exception:
            _LOGGER.warning("failed to inspect available %s sandboxes", sandbox_type, exc_info=True)
            return None

    async def cleanup_batch(self, ctx: TurnContext, batch) -> None:
        if not batch.sandbox_type or self.lease_manager is None:
            return
        try:
            runs = await self._store.list_batch_runs(batch.batch_id)
        except Exception:
            return
        for run in runs:
            if run.sandbox is None:
                continue
            if run.sandbox_released and run.status in TERMINAL_STATUSES:
                continue
            lease_outcome = run.lease_outcome or ("clean" if run.status == TaskStatus.COMPLETED else "dirty")
            released = await self.release(ctx, run, lease_outcome)
            try:
                detail = await self._store.get_task_detail(run.run_id, "summary")
            except Exception:
                detail = None
            if detail is not None and detail.result is not None:
                await self._progress.mark_run_terminal(
                    ctx,
                    run,
                    detail.result,
                    sandbox_released=released,
                    lease_outcome=lease_outcome,
                )

    async def _set_run_sandbox_release_state(self, run: TaskRun, *, released: bool, lease_outcome: str) -> None:
        run.sandbox_released = released
        run.lease_outcome = lease_outcome
        with contextlib.suppress(Exception):
            current = await self._store.get_run(run.run_id)
            current.sandbox_released = released
            current.lease_outcome = lease_outcome
            await self._store.update_run(current)

    def _stale_run_sandbox_manager(self, run: TaskRun) -> SandboxLeaseManager:
        if self.lease_manager is not None:
            manager_agent_instance_id = getattr(self.lease_manager, "agent_instance_id", "")
            if not manager_agent_instance_id or str(manager_agent_instance_id) == str(run.agent_instance_id):
                return self.lease_manager
        return ReverseGrpcSandboxLeaseManager(agent_instance_id=run.agent_instance_id)
