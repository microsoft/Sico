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
