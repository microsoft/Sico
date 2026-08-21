from __future__ import annotations

import grpc

import app.pb.casereplay.reverse_rpc as pb


class ReverseCaseReplayServiceError(RuntimeError):
    """A non-domain failure crossing the case-replay reverse RPC boundary."""


class ReverseCaseReplayNotFoundError(ReverseCaseReplayServiceError):
    """The backend reported a missing case replay or replay version."""


def _translate(operation: str, exc: grpc.RpcError) -> ReverseCaseReplayServiceError:
    code = exc.code() if hasattr(exc, "code") else None
    detail = exc.details() if hasattr(exc, "details") else str(exc)
    message = f"ReverseCaseReplayService.{operation} failed: {detail}"
    if code == grpc.StatusCode.NOT_FOUND:
        return ReverseCaseReplayNotFoundError(message)
    return ReverseCaseReplayServiceError(message)


class ReverseCaseReplayService:
    """Core-side client for versioned testcase replay actions."""

    _instance: ReverseCaseReplayService | None = None

    @classmethod
    def get_instance(cls) -> ReverseCaseReplayService:
        if cls._instance is None:
            cls._instance = ReverseCaseReplayService()
        return cls._instance

    def initialize(self, rgrpc_channel: grpc.Channel) -> None:
        self.stub = pb.ReverseCaseReplayRpcStub(rgrpc_channel)

    def _require_stub(self) -> pb.ReverseCaseReplayRpcStub:
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseCaseReplayService is not initialized")
        return self.stub

    def get_active_case_replay(
        self, case_id: str, site_host: str, platform: str
    ) -> pb.GetActiveCaseReplayResponse:
        try:
            return self._require_stub().rpc_get_active_case_replay(
                pb.GetActiveCaseReplayRequest(case_id=case_id, site_host=site_host, platform=platform)
            )
        except grpc.RpcError as exc:
            raise _translate("get_active_case_replay", exc) from exc

    def get_or_create_case_replay(
        self, case_id: str, site_host: str, platform: str
    ) -> pb.GetOrCreateCaseReplayResponse:
        try:
            return self._require_stub().rpc_get_or_create_case_replay(
                pb.GetOrCreateCaseReplayRequest(case_id=case_id, site_host=site_host, platform=platform)
            )
        except grpc.RpcError as exc:
            raise _translate("get_or_create_case_replay", exc) from exc

    def create_case_replay_version(
        self,
        case_replay_id: int,
        version: str,
        actions_blob_path: str = "",
        metadata: str = "",
        activate: bool = False,
    ) -> int:
        try:
            response = self._require_stub().rpc_create_case_replay_version(
                pb.CreateCaseReplayVersionRequest(
                    case_replay_id=case_replay_id,
                    version=version,
                    actions_blob_path=actions_blob_path,
                    metadata=metadata,
                    activate=activate,
                )
            )
            return response.version_id
        except grpc.RpcError as exc:
            raise _translate("create_case_replay_version", exc) from exc

    def set_case_replay_version_actions(self, version_id: int, actions_blob_path: str) -> None:
        try:
            self._require_stub().rpc_set_case_replay_version_actions(
                pb.SetCaseReplayVersionActionsRequest(
                    version_id=version_id,
                    actions_blob_path=actions_blob_path,
                )
            )
        except grpc.RpcError as exc:
            raise _translate("set_case_replay_version_actions", exc) from exc

    def activate_case_replay_version(self, case_replay_id: int, version_id: int) -> None:
        try:
            self._require_stub().rpc_activate_case_replay_version(
                pb.ActivateCaseReplayVersionRequest(
                    case_replay_id=case_replay_id,
                    version_id=version_id,
                )
            )
        except grpc.RpcError as exc:
            raise _translate("activate_case_replay_version", exc) from exc

    def mark_case_replay_stale(self, case_replay_id: int) -> None:
        try:
            self._require_stub().rpc_mark_case_replay_stale(
                pb.MarkCaseReplayStaleRequest(case_replay_id=case_replay_id)
            )
        except grpc.RpcError as exc:
            raise _translate("mark_case_replay_stale", exc) from exc
