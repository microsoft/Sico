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

from pydantic import BaseModel, Field

import app.pb.conversation.msg as pb
from app.pb.conversation.chat import ChatContentType, FunctionContext
from app.schemas.common.common import Attachment

__all__ = ["Message", "MessageExtraInfo"]

class MessageExtraInfo(BaseModel):
    # No fields. Reserve for future use.

    @classmethod
    def from_pb(cls, pb_obj: pb.MessageExtraInfo) -> Self:
        return cls()

    def to_pb(self) -> pb.MessageExtraInfo:
        pb_obj = pb.MessageExtraInfo()
        return pb_obj

class Message(BaseModel):
    id: int = Field(0, description="Unique identifier of the message")
    turn_id: int = Field(0, description="Identifier of the turn this message belongs to")
    conversation_id: int = Field(0, description="Identifier of the conversation this message belongs to")
    username: str = Field("", description="Username of the message sender")
    agent_instance_id: int = Field(0, description="Associated agent instance ID, 0 if not sent by an agent")
    role: str = Field("", description="Role of the message sender (e.g., user, assistant, system)")
    content_type: ChatContentType = Field(ChatContentType.UNKNOWN, description="Type of the message content")
    content: str = Field("", description="Content of the message")
    function_context: FunctionContext = Field(
        default_factory=FunctionContext, description="Function context if content_type is FUNCTION_CALL")
    ext: MessageExtraInfo = Field(default_factory=MessageExtraInfo, description="Extra information for the message")
    attachments: list[Attachment] = Field(default_factory=list, description="List of attachments associated with the message")
    created_at: int = Field(0, description="Creation timestamp in milliseconds")
    updated_at: int = Field(0, description="Last update timestamp in milliseconds")

    @classmethod
    def from_pb(cls, pb_obj: pb.Message) -> Self:
        return cls(
            id=pb_obj.id,
            turn_id=pb_obj.turn_id,
            conversation_id=pb_obj.conversation_id,
            username=pb_obj.username,
            agent_instance_id=pb_obj.agent_instance_id,
            role=pb_obj.role,
            content_type=pb_obj.content_type,
            content=pb_obj.content,
            function_context=pb_obj.function_context if pb_obj.function_context is not None else FunctionContext(),
            ext=MessageExtraInfo.from_pb(pb_obj.ext) if pb_obj.ext is not None else MessageExtraInfo(),
            attachments=[Attachment.from_pb(att) for att in pb_obj.attachments],
            created_at=pb_obj.created_at,
            updated_at=pb_obj.updated_at,
        )

    def to_pb(self) -> pb.Message:
        pb_obj = pb.Message()
        pb_obj.id = self.id
        pb_obj.turn_id = self.turn_id
        pb_obj.conversation_id = self.conversation_id
        pb_obj.username = self.username
        pb_obj.agent_instance_id = self.agent_instance_id
        pb_obj.role = self.role
        pb_obj.content_type = self.content_type
        pb_obj.content = self.content
        pb_obj.function_context = self.function_context
        pb_obj.ext = self.ext.to_pb()
        pb_obj.attachments.extend([att.to_pb() for att in self.attachments])
        pb_obj.created_at = self.created_at
        pb_obj.updated_at = self.updated_at
        return pb_obj
