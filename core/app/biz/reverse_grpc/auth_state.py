from __future__ import annotations

import grpc

import app.pb.authstate.reverse_rpc as pb


class ReverseAuthStateServiceError(RuntimeError):
    """A non-domain failure crossing the auth-state reverse RPC boundary."""


class ReverseAuthStateNotFoundError(ReverseAuthStateServiceError):
    """The backend reported a missing auth state."""


def _translate(operation: str, exc: grpc.RpcError) -> ReverseAuthStateServiceError:
    code = exc.code() if hasattr(exc, "code") else None
    detail = exc.details() if hasattr(exc, "details") else str(exc)
    message = f"ReverseAuthStateService.{operation} failed: {detail}"
    if code == grpc.StatusCode.NOT_FOUND:
        return ReverseAuthStateNotFoundError(message)
    return ReverseAuthStateServiceError(message)


AUTH_STATE_STATUS_UNKNOWN = pb.AuthStateStatus.UNKNOWN
AUTH_STATE_STATUS_VALID = pb.AuthStateStatus.VALID
AUTH_STATE_STATUS_EXPIRED = pb.AuthStateStatus.EXPIRED
AUTH_STATE_STATUS_DISABLED = pb.AuthStateStatus.DISABLED


class ReverseAuthStateService:
    """Core-side client for reusable browser authentication state."""

    _instance: ReverseAuthStateService | None = None

    @classmethod
    def get_instance(cls) -> ReverseAuthStateService:
        if cls._instance is None:
            cls._instance = ReverseAuthStateService()
        return cls._instance

    def initialize(self, rgrpc_channel: grpc.Channel) -> None:
        self.stub = pb.ReverseAuthStateRpcStub(rgrpc_channel)

    def _require_stub(self) -> pb.ReverseAuthStateRpcStub:
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseAuthStateService is not initialized")
        return self.stub

    def get_auth_state(self, account_key: str, site_host: str) -> pb.GetAuthStateResponse:
        try:
            return self._require_stub().rpc_get_auth_state(
                pb.GetAuthStateRequest(account_key=account_key, site_host=site_host)
            )
        except grpc.RpcError as exc:
            raise _translate("get_auth_state", exc) from exc

    def upsert_auth_state(
        self,
        account_key: str,
        site_host: str,
        state_blob_path: str,
        status: int = AUTH_STATE_STATUS_VALID,
        expires_at: int = 0,
        last_validated_at: int = 0,
        metadata: str = "",
    ) -> int:
        try:
            response = self._require_stub().rpc_upsert_auth_state(
                pb.UpsertAuthStateRequest(
                    account_key=account_key,
                    site_host=site_host,
                    state_blob_path=state_blob_path,
                    status=status,
                    expires_at=expires_at,
                    last_validated_at=last_validated_at,
                    metadata=metadata,
                )
            )
            return response.id
        except grpc.RpcError as exc:
            raise _translate("upsert_auth_state", exc) from exc

    def mark_auth_state_expired(self, account_key: str, site_host: str) -> None:
        try:
            self._require_stub().rpc_mark_auth_state_expired(
                pb.MarkAuthStateExpiredRequest(account_key=account_key, site_host=site_host)
            )
        except grpc.RpcError as exc:
            raise _translate("mark_auth_state_expired", exc) from exc
