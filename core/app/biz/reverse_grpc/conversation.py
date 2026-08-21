from typing import Self

import grpc
from pydantic import BaseModel, Field

import app.pb.conversation.reverse_rpc as pb
from app.schemas.conversation import Message


class CreateMessageResult(BaseModel):
    id: int = Field(..., description="Unique identifier for the created message")

    @classmethod
    def from_pb(cls, pb_resp: pb.CreateMessageResponse) -> Self:
        return cls(
            id=pb_resp.data.id,
        )


# Singleton
class ReverseConversationService:
    _instance: "ReverseConversationService" = None

    @classmethod
    def get_instance(cls) -> "ReverseConversationService":
        if cls._instance is None:
            cls._instance = ReverseConversationService()
        return cls._instance

    def initialize(self, rgrpc_channel: grpc.Channel):
        self.stub = pb.ReverseConversationRpcStub(rgrpc_channel)

    def create_message(self, message: Message) -> CreateMessageResult:
        '''
        Pass a Message object to create a new message.
        The passed ID, CreatedAt and UpdatedAt fields will be ignored,
        you can just set them to default values.
        The returned CreateMessageResult contains the ID of the created message.
        '''
        resp = self.stub.rpc_create_message(
            pb.CreateMessageRequest(message=message.to_pb()),
        )
        if resp.code != 0:
            raise Exception(f"ReverseConversationService.create_message failed: {resp.msg}")
        return CreateMessageResult.from_pb(resp)

    def list_user_message_by_user_agent_turn_id(self, username: str, agent_instance_id: int, turn_id: int) -> list[Message]:
        '''
        List user messages by username, agent_instance_id and turn_id.
        '''
        resp = self.stub.rpc_list_user_message_by_user_agent_turn_id(
            pb.ListUserMessageByUserAgentTurnIdRequest(
                username=username,
                agent_instance_id=agent_instance_id,
                turn_id=turn_id
            )
        )
        if resp.code != 0:
            raise Exception(f"ReverseConversationService.list_user_message_by_user_agent_turn_id failed: {resp.msg}")
        return [Message.from_pb(msg) for msg in resp.data]

    def update_conversation_title(self, conversation_id: int, title: str) -> None:
        resp = self.stub.rpc_update_conversation_title(
            pb.UpdateConversationTitleRequest(
                conversation_id=conversation_id,
                title=title,
            )
        )
        if resp.code != 0:
            raise Exception(f"ReverseConversationService.update_conversation_title failed: {resp.msg}")
