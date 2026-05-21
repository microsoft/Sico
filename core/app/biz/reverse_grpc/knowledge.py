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

import app.pb.knowledge.reverse_rpc as pb


class ReverseKnowledgeService:
    _instance: "ReverseKnowledgeService" = None

    @classmethod
    def get_instance(cls) -> "ReverseKnowledgeService":
        if cls._instance is None:
            cls._instance = ReverseKnowledgeService()
        return cls._instance

    def initialize(self, rgrpc_channel: grpc.Channel):
        self.stub = pb.ReverseKnowledgeRpcStub(rgrpc_channel)

    def list_knowledge_metadata(self, knowledge_ids: list[int]) -> dict[int, pb.KnowledgeMetadata]:
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseKnowledgeService is not initialized")

        resp = self.stub.rpc_list_knowledge_metadata(
            pb.GetKnowledgeMetadataRequest(knowledge_ids=knowledge_ids)
        )
        if resp.code != 0:
            raise RuntimeError(f"Failed to list knowledge metadata: {resp.msg}")

        meta: dict[int, pb.KnowledgeMetadata] = {}
        for item in resp.data:
            meta[item.knowledge_id] = item
        return meta

    def upsert_knowledge_playbook(self, project_id: int, agent_instance_id: int) -> pb.UpsertKnowledgePlaybookResponse:
        """Create or update a knowledge playbook record for the given project and agent instance."""
        if not hasattr(self, "stub"):
            raise RuntimeError("ReverseKnowledgeService is not initialized")

        resp = self.stub.rpc_upsert_knowledge_playbook(
            pb.UpsertKnowledgePlaybookRequest(
                project_id=project_id,
                agent_instance_id=agent_instance_id,
            )
        )
        if resp.code != 0:
            raise RuntimeError(f"Failed to upsert knowledge playbook: {resp.msg}")

        return resp
