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

from pydantic import BaseModel, Field, field_validator

import app.pb.conversation.api as pb


class RecommendationTaskIcon(int, Enum):
    UNKNOWN = 0
    FALLBACK = 1
    BUILD = 2
    THINK = 3
    WRITE = 4
    RESEARCH = 5

    @classmethod
    def from_pb(cls, pb_value: pb.RecommendationTaskIcon) -> "RecommendationTaskIcon":
        return cls(pb_value.value)

    def to_pb(self) -> pb.RecommendationTaskIcon:
        return pb.RecommendationTaskIcon(self.value)


_ICON_ALIASES = {
    "unknown": RecommendationTaskIcon.UNKNOWN,
    "fallback": RecommendationTaskIcon.FALLBACK,
    "build": RecommendationTaskIcon.BUILD,
    "think": RecommendationTaskIcon.THINK,
    "write": RecommendationTaskIcon.WRITE,
    "research": RecommendationTaskIcon.RESEARCH,
}


class RecommendationTask(BaseModel):
    message: str = Field(..., min_length=1, description="The suggested message text")
    icon: RecommendationTaskIcon = Field(..., description="The icon representing the suggestion")

    @field_validator("message")
    @classmethod
    def _normalize_message(cls, value: str) -> str:
        message = value.strip()
        if not message:
            raise ValueError("message must not be empty")
        return message

    @field_validator("icon", mode="before")
    @classmethod
    def _normalize_icon(cls, value):
        if isinstance(value, str):
            key = value.strip().lower().removeprefix("recommendation_task_icon_")
            return _ICON_ALIASES.get(key, value)
        return value

    @field_validator("icon")
    @classmethod
    def _reject_unknown_icon(cls, value: RecommendationTaskIcon) -> RecommendationTaskIcon:
        if value == RecommendationTaskIcon.UNKNOWN:
            return RecommendationTaskIcon.FALLBACK
        return value

    @classmethod
    def from_pb(cls, pb_obj: pb.RecommendationTask) -> "RecommendationTask":
        return cls(
            message=pb_obj.message,
            icon=RecommendationTaskIcon.from_pb(pb_obj.icon),
        )

    def to_pb(self) -> pb.RecommendationTask:
        pb_obj = pb.RecommendationTask()
        pb_obj.message = self.message
        pb_obj.icon = self.icon.to_pb()
        return pb_obj


class RecommendationTasks(BaseModel):
    tasks: list[RecommendationTask] = Field(..., min_length=3, max_length=3, description="Exactly three recommended tasks")

    @classmethod
    def from_pb(cls, pb_obj: pb.GenerateOnboardRecommendationTasksResponse) -> "RecommendationTasks":
        if not pb_obj.data:
            return cls.model_construct(tasks=[])
        return cls(tasks=[RecommendationTask.from_pb(s) for s in pb_obj.data.tasks])

    def to_pb(self) -> pb.GenerateOnboardRecommendationTasksResponse:
        return pb.GenerateOnboardRecommendationTasksResponse(
            data=pb.GenerateOnboardRecommendationTasksData(tasks=[s.to_pb() for s in self.tasks])
        )
