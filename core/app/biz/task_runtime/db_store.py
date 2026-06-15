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

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable
from typing import TYPE_CHECKING, Any

from .models import ArtifactRef, BatchRecord, FencingToken, StaleRun, TaskDetail, TaskResult, TaskRun, TaskStatus
from .store import IdempotencyCollisionError, StaleWorkerError, TaskDetailView
from .time_utils import now_ms as _now_ms

if TYPE_CHECKING:
    from app.biz.reverse_grpc.taskruntime import ReverseTaskRuntimeService


class DBRunStore:
    def __init__(self, service: ReverseTaskRuntimeService | None = None) -> None:
        if service is None:
            from app.biz.reverse_grpc.taskruntime import ReverseTaskRuntimeService

            service = ReverseTaskRuntimeService.get_instance()
        self.service = service

    async def create_batch(self, batch: BatchRecord) -> None:
        await asyncio.to_thread(self.service.create_batch, batch.model_dump_json())

    async def update_batch(self, batch: BatchRecord) -> None:
        await asyncio.to_thread(self.service.update_batch, batch.model_dump_json())

    async def get_batch(self, batch_id: str) -> BatchRecord:
        resp = await asyncio.to_thread(self.service.get_batch, batch_id)
        if not resp.found:
            raise FileNotFoundError(f"batch not found: {batch_id}")
        return BatchRecord.model_validate_json(resp.batch_json)

    async def create_run(self, run: TaskRun) -> None:
        from app.biz.reverse_grpc.taskruntime import ReverseTaskRuntimeAlreadyExistsError

        try:
            await asyncio.to_thread(self.service.create_run, run.model_dump_json())
        except ReverseTaskRuntimeAlreadyExistsError as exc:
            # UNIQUE(idempotency_key) collision: another concurrent caller won the race.
            # Surface a domain error so the manager can re-lookup and reuse the prior run.
            raise IdempotencyCollisionError(str(exc)) from exc

    async def update_run(self, run: TaskRun) -> None:
        await asyncio.to_thread(self.service.update_run, run.model_dump_json())

    async def reopen_run_for_retry(self, run: TaskRun, *, expected_attempt: int) -> None:
        from app.biz.reverse_grpc.taskruntime import ReverseTaskRuntimeStaleError

        try:
            await asyncio.to_thread(self.service.reopen_run_for_retry, run.model_dump_json(), expected_attempt)
        except ReverseTaskRuntimeStaleError as exc:
            # The run is no longer in a retryable terminal state at the expected
            # attempt (a concurrent/duplicate reopen already fired, or it was
            # cancelled/swept). Surface the domain error so prepare_retry records
            # the prior result as terminal instead of re-queueing.
            raise StaleWorkerError(str(exc)) from exc

    async def lookup_idempotent(self, idempotency_key: str) -> TaskRun | None:
        resp = await asyncio.to_thread(self.service.lookup_idempotent, idempotency_key)
        if not resp.found:
            return None
        return _task_run_from_json(resp.run_json)

    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken:
        from app.biz.reverse_grpc.taskruntime import ReverseTaskRuntimeStaleError

        try:
            resp = await asyncio.to_thread(self.service.claim_run, run_id, worker_id)
        except ReverseTaskRuntimeStaleError as exc:
            # `ensureClaimable` reports unclaimable runs via FailedPrecondition. The
            # FileRunStore raises StaleWorkerError here so callers (e.g. retry loops)
            # already know how to handle it; mirror that contract for the DB path.
            raise StaleWorkerError(str(exc)) from exc
        return FencingToken.model_validate_json(resp.token_json)

    async def heartbeat_batch(self, batch_id: str) -> None:
        # Single non-locking UPDATE on the backend: bumps the batch-level liveness
        # signal (t_task_runtime_batch.liveness_at) so the sweeper does not reclaim
        # any of the batch's still-active runs while this process is alive. One O(1)
        # write per interval regardless of how many runs the batch holds.
        await asyncio.to_thread(self.service.heartbeat_batch, batch_id)

    async def set_progress(self, run_id: str, message: str, *, ts: int | None = None) -> None:
        # Fire-and-forget projection: the backend handler runs as a single UPDATE
        # without taking the run row lock, so concurrent heartbeats/claims cannot
        # block this. Out-of-order writes are dropped via the WHERE ts <= ? clause.
        now_ms = ts if ts is not None else _now_ms()
        await asyncio.to_thread(self.service.set_run_progress, run_id, message[:1000], now_ms)

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        await self._translate_stale_token(
            asyncio.to_thread(self.service.write_result, run_id, result.model_dump_json(), token.model_dump_json())
        )

    async def cancel_batch(self, batch_id: str, reason: str) -> None:
        await asyncio.to_thread(self.service.cancel_batch, batch_id, reason)

    async def cancel_run(self, run_id: str, reason: str) -> None:
        await asyncio.to_thread(self.service.cancel_run, run_id, reason)

    async def get_run(self, run_id: str) -> TaskRun:
        resp = await asyncio.to_thread(self.service.get_run, run_id)
        if not resp.found:
            raise FileNotFoundError(f"run not found: {run_id}")
        return _task_run_from_json(resp.run_json)

    async def get_task_detail(self, run_id: str, view: TaskDetailView) -> TaskDetail:
        resp = await asyncio.to_thread(self.service.get_task_detail, run_id, view)
        if not resp.found:
            raise FileNotFoundError(f"run not found: {run_id}")
        run = _task_run_from_json(resp.run_json)
        result = TaskResult.model_validate_json(resp.result_json) if resp.result_json else None
        if run.status not in {
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
            TaskStatus.TIMED_OUT,
            TaskStatus.BLOCKED,
        }:
            result = None
        artifacts = [] if result is None or not resp.artifacts_json else result_artifacts(resp.artifacts_json)
        return TaskDetail(
            run=run,
            result=result,
            view=view,
            content=resp.content,
            artifacts=artifacts if result is None else result.artifacts,
        )

    async def list_batch_runs(self, batch_id: str) -> list[TaskRun]:
        resp = await asyncio.to_thread(self.service.list_batch_runs, batch_id)
        return [_task_run_from_json(item) for item in resp.runs_json]

    async def list_batches_by_turn(
        self,
        parent_conversation_id: int,
        parent_turn_id: int,
        *,
        active_only: bool = False,
    ) -> list[BatchRecord]:
        resp = await asyncio.to_thread(
            self.service.list_batches_by_turn,
            parent_conversation_id,
            parent_turn_id,
            active_only,
        )
        return [BatchRecord.model_validate_json(item) for item in resp.batches_json]

    async def sweep_stale(self, before_ts: int) -> list[StaleRun]:
        resp = await asyncio.to_thread(self.service.sweep_stale_runs, before_ts)
        return [StaleRun.model_validate_json(item) for item in resp.stale_runs_json]

    async def _translate_stale_token(self, awaitable: Awaitable[Any]) -> None:
        from app.biz.reverse_grpc.taskruntime import ReverseTaskRuntimeServiceError, ReverseTaskRuntimeStaleError

        try:
            await awaitable
        except ReverseTaskRuntimeStaleError as exc:
            # The backend uses gRPC FailedPrecondition for stale-token / state-changed
            # conditions; surface them as the domain-level StaleWorkerError so callers
            # can retry by re-claiming.
            raise StaleWorkerError(str(exc)) from exc
        except ReverseTaskRuntimeServiceError as exc:
            # Legacy payload-encoded path: backend still returns Code:1 with a literal
            # "stale worker token" message. Keep the substring check during rollout.
            if "stale worker token" in str(exc):
                raise StaleWorkerError(str(exc)) from exc
            raise


def result_artifacts(payload: str) -> list[ArtifactRef]:
    loaded = json.loads(payload)
    if not isinstance(loaded, list):
        return []
    return [ArtifactRef.model_validate(item) for item in loaded]


def _task_run_from_json(payload: str) -> TaskRun:
    loaded = json.loads(payload)
    # Proto3 string fields default to "" rather than null, so normalize the
    # absent-error sentinel back to None before validating.
    if isinstance(loaded, dict) and loaded.get("last_error_class") == "":
        loaded["last_error_class"] = None
    return TaskRun.model_validate(loaded)
