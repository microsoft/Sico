# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from __future__ import annotations

import collections
import functools
from collections.abc import Callable
from typing import TypeVar

import grpc

import app.pb.taskruntime.reverse_rpc as pb
from app.biz.task_runtime.config import _task_runtime_reverse_rpc_timeout_seconds


class ReverseTaskRuntimeServiceError(RuntimeError):
    """Generic error for any non-domain failure crossing the reverse RPC boundary."""


class ReverseTaskRuntimeNotFoundError(ReverseTaskRuntimeServiceError):
    """The backend reported a missing entity (gRPC NotFound)."""


class ReverseTaskRuntimeStaleError(ReverseTaskRuntimeServiceError):
    """The backend reported a fencing/state precondition failure (gRPC FailedPrecondition)."""


class ReverseTaskRuntimeAlreadyExistsError(ReverseTaskRuntimeServiceError):
    """The backend reported a duplicate-key collision (gRPC AlreadyExists).

    Most commonly raised on ``create_run`` when two callers race on the same
    ``idempotency_key``. The caller should re-issue ``lookup_idempotent`` and
    reuse the prior run.
    """


_T = TypeVar("_T")


def _translate_rpc_error(operation: str, exc: grpc.RpcError) -> ReverseTaskRuntimeServiceError:
    """Map a gRPC status to the matching typed exception.

    Production backends should always return real ``status.Error`` results; we keep
    the broad fallback so callers always see a meaningful subclass rather than
    leaking the raw RpcError into business code.
    """
    code = exc.code() if hasattr(exc, "code") else None
    detail = exc.details() if hasattr(exc, "details") else str(exc)
    message = f"ReverseTaskRuntimeService.{operation} failed: {detail}"
    if code == grpc.StatusCode.NOT_FOUND:
        return ReverseTaskRuntimeNotFoundError(message)
    if code == grpc.StatusCode.FAILED_PRECONDITION:
        return ReverseTaskRuntimeStaleError(message)
    if code == grpc.StatusCode.ALREADY_EXISTS:
        return ReverseTaskRuntimeAlreadyExistsError(message)
    return ReverseTaskRuntimeServiceError(message)


def _wrap_rpc(operation: str) -> Callable[[Callable[..., _T]], Callable[..., _T]]:
    """Decorator that translates gRPC errors and legacy payload-encoded codes uniformly."""

    def decorator(fn: Callable[..., _T]) -> Callable[..., _T]:
        @functools.wraps(fn)
        def wrapper(self: "ReverseTaskRuntimeService", *args, **kwargs) -> _T:
            try:
                resp = fn(self, *args, **kwargs)
            except grpc.RpcError as exc:
                raise _translate_rpc_error(operation, exc) from exc
            # Legacy payload-encoded errors. Modern backends never set code != 0,
            # but we keep the check during the migration window so a partially
            # updated server still surfaces problems instead of being ignored.
            if resp is not None and getattr(resp, "code", 0) != 0:
                msg = getattr(resp, "msg", "unknown backend error")
                if "stale worker token" in msg:
                    raise ReverseTaskRuntimeStaleError(
                        f"ReverseTaskRuntimeService.{operation} failed: {msg}"
                    )
                raise ReverseTaskRuntimeServiceError(
                    f"ReverseTaskRuntimeService.{operation} failed: {msg}"
                )
            return resp

        return wrapper

    return decorator


class _ClientCallDetails(
    collections.namedtuple(
        "_ClientCallDetails",
        ("method", "timeout", "metadata", "credentials", "wait_for_ready", "compression"),
    ),
    grpc.ClientCallDetails,
):
    """Mutable stand-in for grpc's immutable ClientCallDetails (interceptor use)."""


class _DefaultDeadlineInterceptor(grpc.UnaryUnaryClientInterceptor):
    """Apply a default per-call deadline to every reverse RPC that lacks one.

    A reverse RPC with no deadline blocks its caller forever if the call wedges;
    the batch-heartbeat beater is the dangerous case, since one parked
    ``heartbeat_batch`` freezes liveness for the whole batch. Stamping a default
    timeout turns an indefinite hang into a fast ``DEADLINE_EXCEEDED`` the caller
    already handles, so the next beater tick recovers. An explicit caller-set
    timeout is always preserved.
    """

    def __init__(self, timeout_seconds: float) -> None:
        self._timeout = timeout_seconds

    def intercept_unary_unary(self, continuation, client_call_details, request):
        if client_call_details.timeout is None:
            client_call_details = _ClientCallDetails(
                client_call_details.method,
                self._timeout,
                client_call_details.metadata,
                client_call_details.credentials,
                getattr(client_call_details, "wait_for_ready", None),
                getattr(client_call_details, "compression", None),
            )
        return continuation(client_call_details, request)


class ReverseTaskRuntimeService:
    _instance: "ReverseTaskRuntimeService" = None

    @classmethod
    def get_instance(cls) -> "ReverseTaskRuntimeService":
        if cls._instance is None:
            cls._instance = ReverseTaskRuntimeService()
        return cls._instance

    def initialize(self, rgrpc_channel: grpc.Channel) -> None:
        # Bound every task-runtime reverse RPC with a default deadline so a wedged
        # call can never block its caller indefinitely (see
        # ``_DefaultDeadlineInterceptor``). Scoped to this stub's channel view so
        # other reverse services keep their own semantics.
        deadlined_channel = grpc.intercept_channel(
            rgrpc_channel,
            _DefaultDeadlineInterceptor(_task_runtime_reverse_rpc_timeout_seconds()),
        )
        self.stub = pb.ReverseTaskRuntimeRpcStub(deadlined_channel)

    def _require_stub(self) -> pb.ReverseTaskRuntimeRpcStub:
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseTaskRuntimeService is not initialized")
        return self.stub

    @_wrap_rpc("create_batch")
    def create_batch(self, batch_json: str) -> None:
        return self._require_stub().rpc_create_batch(pb.CreateBatchRequest(batch_json=batch_json))

    @_wrap_rpc("update_batch")
    def update_batch(self, batch_json: str) -> None:
        return self._require_stub().rpc_update_batch(pb.UpdateBatchRequest(batch_json=batch_json))

    @_wrap_rpc("get_batch")
    def get_batch(self, batch_id: str) -> pb.GetBatchResponse:
        return self._require_stub().rpc_get_batch(pb.GetBatchRequest(batch_id=batch_id))

    @_wrap_rpc("create_run")
    def create_run(self, run_json: str) -> None:
        return self._require_stub().rpc_create_run(pb.CreateRunRequest(run_json=run_json))

    @_wrap_rpc("update_run")
    def update_run(self, run_json: str) -> None:
        return self._require_stub().rpc_update_run(pb.UpdateRunRequest(run_json=run_json))

    @_wrap_rpc("reopen_run_for_retry")
    def reopen_run_for_retry(self, run_json: str, expected_attempt: int) -> None:
        return self._require_stub().rpc_reopen_run_for_retry(
            pb.ReopenRunForRetryRequest(run_json=run_json, expected_attempt=expected_attempt)
        )

    @_wrap_rpc("lookup_idempotent")
    def lookup_idempotent(self, idempotency_key: str) -> pb.GetRunResponse:
        return self._require_stub().rpc_lookup_idempotent(
            pb.LookupIdempotentRequest(idempotency_key=idempotency_key)
        )

    @_wrap_rpc("claim_run")
    def claim_run(self, run_id: str, worker_id: str) -> pb.ClaimRunResponse:
        return self._require_stub().rpc_claim_run(pb.ClaimRunRequest(run_id=run_id, worker_id=worker_id))

    @_wrap_rpc("heartbeat_batch")
    def heartbeat_batch(self, batch_id: str) -> None:
        return self._require_stub().rpc_heartbeat_batch(pb.HeartbeatBatchRequest(batch_id=batch_id))

    @_wrap_rpc("set_run_progress")
    def set_run_progress(self, run_id: str, message: str, ts: int) -> None:
        return self._require_stub().rpc_set_run_progress(
            pb.SetRunProgressRequest(run_id=run_id, message=message, ts=ts)
        )

    @_wrap_rpc("write_result")
    def write_result(self, run_id: str, result_json: str, token_json: str) -> None:
        return self._require_stub().rpc_write_result(
            pb.WriteResultRequest(run_id=run_id, result_json=result_json, token_json=token_json)
        )

    @_wrap_rpc("cancel_batch")
    def cancel_batch(self, batch_id: str, reason: str) -> None:
        return self._require_stub().rpc_cancel_batch(
            pb.CancelBatchRequest(batch_id=batch_id, reason=reason)
        )

    @_wrap_rpc("cancel_run")
    def cancel_run(self, run_id: str, reason: str) -> None:
        return self._require_stub().rpc_cancel_run(pb.CancelRunRequest(run_id=run_id, reason=reason))

    @_wrap_rpc("get_run")
    def get_run(self, run_id: str) -> pb.GetRunResponse:
        return self._require_stub().rpc_get_run(pb.GetRunRequest(run_id=run_id))

    @_wrap_rpc("get_task_detail")
    def get_task_detail(self, run_id: str, view: str) -> pb.GetTaskDetailResponse:
        return self._require_stub().rpc_get_task_detail(
            pb.GetTaskDetailRequest(run_id=run_id, view=view)
        )

    @_wrap_rpc("list_batch_runs")
    def list_batch_runs(self, batch_id: str) -> pb.ListBatchRunsResponse:
        return self._require_stub().rpc_list_batch_runs(pb.ListBatchRunsRequest(batch_id=batch_id))

    @_wrap_rpc("list_batches_by_turn")
    def list_batches_by_turn(
        self,
        parent_conversation_id: int,
        parent_turn_id: int,
        active_only: bool = False,
    ) -> pb.ListBatchesByTurnResponse:
        return self._require_stub().rpc_list_batches_by_turn(
            pb.ListBatchesByTurnRequest(
                parent_conversation_id=parent_conversation_id,
                parent_turn_id=parent_turn_id,
                active_only=active_only,
            )
        )

    @_wrap_rpc("sweep_stale_runs")
    def sweep_stale_runs(self, before_ts: int) -> pb.SweepStaleRunsResponse:
        return self._require_stub().rpc_sweep_stale_runs(
            pb.SweepStaleRunsRequest(before_ts=before_ts)
        )
