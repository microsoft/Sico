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
