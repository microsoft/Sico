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

from enum import Enum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field

import app.pb.conversation.chat as pb
import app.schemas.common.common as commonschemas

class ChatContentType(int, Enum):
    UNKNOWN = 0
    TEXT = 1
    FUNCTION_CALL = 2
    FUNCTION_RESULT = 3
    END = 5
    PLAYBOOK_INGESTION = 6
    PLAN = 7
    KEEPALIVE = 8
    ERROR = 9

    @classmethod
    def from_pb(cls, pb_value: pb.ChatContentType) -> "ChatContentType":
        return cls(pb_value.value)

    def to_pb(self) -> pb.ChatContentType:
        return pb.ChatContentType(self.value)

class FunctionContext(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    result: str = Field("", description="The result of the function execution")
    exception: str = Field("", description="The exception message if the function execution failed")

    @classmethod
    def from_pb(cls, pb_obj: pb.FunctionContext) -> Self:
        return cls(
            result=pb_obj.result,
            exception=pb_obj.exception,
        )

    def to_pb(self) -> pb.FunctionContext:
        pb_obj = pb.FunctionContext()
        pb_obj.result = self.result
        pb_obj.exception = self.exception
        return pb_obj

class ChatContent(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    type: ChatContentType = Field(ChatContentType.UNKNOWN, description="The type of the chat content")
    content: str = Field("", description="The actual content, e.g. text message or function call details")
    function_context: FunctionContext = Field(
        default_factory=FunctionContext,
        alias="functionContext",
        description="Additional context if the content is related to a function call"
    )
    attachments: list[commonschemas.Attachment] = Field(
        default_factory=list, description="List of attachments associated with this content"
    )

    @classmethod
    def from_pb(cls, pb_obj: pb.ChatContent) -> Self:
        return cls(
            type=ChatContentType.from_pb(pb_obj.type),
            content=pb_obj.content,
            function_context=FunctionContext.from_pb(pb_obj.function_context) if pb_obj.function_context else FunctionContext(),
            attachments=[commonschemas.Attachment.from_pb(att) for att in pb_obj.attachments],
        )

    def to_pb(self) -> pb.ChatContent:
        pb_obj = pb.ChatContent()
        pb_obj.type = self.type.to_pb()
        pb_obj.content = self.content
        pb_obj.function_context = self.function_context.to_pb() if self.function_context else None
        pb_obj.attachments.extend([att.to_pb() for att in self.attachments])
        return pb_obj

class ChatResponse(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    content: ChatContent = Field(default_factory=ChatContent, description="The main content of the chat response")
    timestamp: int = Field(0, description="The timestamp of the response in milliseconds")
    is_final: bool = Field(False, alias="isFinal", description="Indicates if this is the final response in a stream of responses")
    is_internal: bool = Field(
        False,
        alias="isInternal",
        description="Indicates if this response is for internal use and should not be exposed to end users"
    )

    @classmethod
    def from_pb(cls, pb_obj: pb.ChatResponse) -> Self:
        return cls(
            content=ChatContent.from_pb(pb_obj.content) if pb_obj.content else ChatContent(),
            timestamp=pb_obj.timestamp,
            is_final=pb_obj.is_final,
            is_internal=pb_obj.is_internal,
        )

    def to_pb(self) -> pb.ChatResponse:
        pb_obj = pb.ChatResponse()
        pb_obj.content = self.content.to_pb() if self.content else None
        pb_obj.timestamp = self.timestamp
        pb_obj.is_final = self.is_final
        pb_obj.is_internal = self.is_internal
        return pb_obj

class TopicMessage(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    conversation_id: int = Field(0, alias="conversationId", description="The ID of the conversation this message belongs to")
    turn_id: int = Field(0, alias="turnId", description="The ID of the turn this message belongs to")
    seq: int = Field(0, description="The sequence number of this message within the turn, used for ordering messages")
    chat_response: ChatResponse = Field(
        default_factory=ChatResponse,
        alias="chatResponse",
        description="The actual chat response content"
    )

    @classmethod
    def from_pb(cls, pb_obj: pb.TopicMessage) -> Self:
        return cls(
            conversation_id=pb_obj.conversation_id,
            turn_id=pb_obj.turn_id,
            seq=pb_obj.seq,
            chat_response=ChatResponse.from_pb(pb_obj.chat_response) if pb_obj.chat_response else ChatResponse(),
        )

    def to_pb(self) -> pb.TopicMessage:
        pb_obj = pb.TopicMessage()
        pb_obj.conversation_id = self.conversation_id
        pb_obj.turn_id = self.turn_id
        pb_obj.seq = self.seq
        pb_obj.chat_response = self.chat_response.to_pb() if self.chat_response else None
        return pb_obj
