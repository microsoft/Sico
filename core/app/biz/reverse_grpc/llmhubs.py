import grpc

import app.pb.llmhubs.reverse_rpc as pb


class ReverseLLMHubService:
    _instance: "ReverseLLMHubService" = None

    @classmethod
    def get_instance(cls) -> "ReverseLLMHubService":
        if cls._instance is None:
            cls._instance = ReverseLLMHubService()
        return cls._instance

    def initialize(self, rgrpc_channel: grpc.Channel):
        self.stub = pb.ReverseLlmHubRpcStub(rgrpc_channel)

    def upload_artifact(
        self,
        *,
        content: bytes,
        filename: str,
        content_type: str,
        path_prefix: str,
        artifact_type: str,
    ) -> pb.UploadArtifactData:
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseLLMHubService is not initialized")

        resp = self.stub.rpc_upload_artifact(pb.UploadArtifactRequest(
            content=content,
            filename=filename,
            content_type=content_type,
            path_prefix=path_prefix,
            artifact_type=artifact_type,
        ))
        if resp.code != 0:
            raise RuntimeError(f"Failed to upload artifact: {resp.msg}")
        if resp.data is None:
            raise RuntimeError("Failed to upload artifact: empty response data")
        return resp.data
