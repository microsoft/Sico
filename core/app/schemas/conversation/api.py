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

from pydantic import BaseModel, Field

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

class RecommendationTask(BaseModel):
    message: str = Field("", description="The suggested message text")
    icon: RecommendationTaskIcon = Field(RecommendationTaskIcon.UNKNOWN, description="The icon representing the suggestion")

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
    tasks: list[RecommendationTask] = Field(default_factory=list, description="List of recommended tasks")

    @classmethod
    def from_pb(cls, pb_obj: pb.GenerateOnboardRecommendationTasksResponse) -> "RecommendationTasks":
        return cls(
            tasks=[RecommendationTask.from_pb(s) for s in pb_obj.tasks]
        )

    def to_pb(self) -> pb.GenerateOnboardRecommendationTasksResponse:
        pb_obj = pb.GenerateOnboardRecommendationTasksResponse()
        pb_obj.tasks.extend([s.to_pb() for s in self.tasks])
        return pb_obj
