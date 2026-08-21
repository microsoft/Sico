from dataclasses import dataclass

import grpc

import app.pb.sandbox.reverse_rpc as pb


class ReverseSandboxServiceError(RuntimeError):
    def __init__(self, operation: str, backend_message: str, hint: str = ""):
        self.operation = operation
        self.backend_message = backend_message
        self.hint = hint

        message = f"ReverseSandboxService.{operation} failed: {backend_message}"
        if hint:
            message = f"{message}. Hint: {hint}."
        super().__init__(message)


@dataclass
class SandboxInfo:
    sandbox_id: str
    type: str
    status: str
    endpoint: str
    vnc_url: str
    docs_url: str
    display_name: str

    @classmethod
    def from_pb(cls, info: pb.InstanceSandboxInfo) -> "SandboxInfo":
        return cls(
            sandbox_id=info.sandbox_id,
            type=info.type,
            status=info.status,
            endpoint=info.endpoint,
            vnc_url=info.vnc_url,
            docs_url=info.docs_url,
            display_name=info.display_name,
        )


@dataclass
class ApplySandboxResult:
    applied: bool
    applied_sandbox_id: str
    endpoint: str
    provider_base_url: str
    device_id: str
    display_name: str
    vnc_url: str
    os: str
    provider_type: str
    message: str


class ReverseSandboxService:
    _instance: "ReverseSandboxService" = None

    @classmethod
    def get_instance(cls) -> "ReverseSandboxService":
        if cls._instance is None:
            cls._instance = ReverseSandboxService()
        return cls._instance

    def initialize(self, rgrpc_channel: grpc.Channel):
        self.stub = pb.ReverseSandboxRpcStub(rgrpc_channel)

    @staticmethod
    def _build_error_hint(operation: str, backend_message: str) -> str:
        normalized = (backend_message or "").strip().lower()
        if not normalized:
            return ""

        if operation == "get_instance_sandboxes":
            if (
                "failed to load sandbox status" in normalized
                or "failed to parse existing lease" in normalized
                or "unexpected end of json input" in normalized
                or "invalid character" in normalized
            ):
                return "backend sandbox assignment state may be inconsistent or temporarily unavailable"

        if operation == "apply_sandbox":
            if "failed to load sandbox resources" in normalized or "sandbox resource snapshot" in normalized:
                return "backend sandbox inventory may be stale or temporarily unavailable"

        return ""

    def _raise_on_error(self, operation: str, resp) -> None:
        code = getattr(resp, "code", 0)
        if code == 0:
            return

        backend_message = getattr(resp, "msg", "unknown backend error")
        raise ReverseSandboxServiceError(
            operation=operation,
            backend_message=backend_message,
            hint=self._build_error_hint(operation, backend_message),
        )

    def apply_sandbox(self, instance_id: str, sandbox_type: str) -> ApplySandboxResult:
        """
        Acquire a sandbox of the given type for the instance.
        Returns whether acquisition succeeded and the acquired sandbox ID.
        """
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseSandboxService is not initialized")
        if not sandbox_type:
            raise ValueError("sandbox_type is required")

        resp = self.stub.rpc_apply_sandbox(
            pb.ApplySandboxRequest(
                instance_id=instance_id,
                type=sandbox_type,
            )
        )
        self._raise_on_error("apply_sandbox", resp)
        return ApplySandboxResult(
            applied=resp.applied,
            applied_sandbox_id=resp.applied_sandbox_id,
            endpoint=resp.endpoint,
            provider_base_url=resp.provider_base_url,
            device_id=resp.device_id,
            display_name=resp.display_name,
            vnc_url=resp.vnc_url,
            os=resp.os,
            provider_type=resp.provider_type,
            message=resp.msg,
        )

    def release_sandbox(self, instance_id: str, sandbox_id: str) -> None:
        """
        Release a sandbox for the instance.
        """
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseSandboxService is not initialized")

        resp = self.stub.rpc_release_sandbox(
            pb.ReleaseSandboxRequest(
                instance_id=instance_id,
                sandbox_id=sandbox_id,
            )
        )
        self._raise_on_error("release_sandbox", resp)

    def reset_sandbox(self, instance_id: str, sandbox_id: str) -> None:
        """
        Soft-reset a sandbox (e.g. close apps, go home for emulator).
        The lease and assignment are preserved. Validates that the sandbox
        is assigned to the given instance before resetting.
        """
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseSandboxService is not initialized")

        resp = self.stub.rpc_reset_sandbox(
            pb.ResetSandboxRequest(
                instance_id=instance_id,
                sandbox_id=sandbox_id,
            )
        )
        self._raise_on_error("reset_sandbox", resp)

    def get_instance_sandboxes(self, instance_id: str, sandbox_type: str = "") -> list[SandboxInfo]:
        """
        Get all sandboxes assigned to an instance with type and status.
        If sandbox_type is empty, returns all types.
        """
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseSandboxService is not initialized")

        resp = self.stub.rpc_get_instance_sandboxes(
            pb.GetInstanceSandboxesRequest(
                instance_id=instance_id,
                type=sandbox_type,
            )
        )
        self._raise_on_error("get_instance_sandboxes", resp)
        return [SandboxInfo.from_pb(sb) for sb in resp.sandboxes]
