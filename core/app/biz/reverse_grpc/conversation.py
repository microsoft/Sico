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
        resp = self.stub.rpc_create_message(pb.CreateMessageRequest(
            message=message.to_pb()
        ))
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
