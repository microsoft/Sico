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
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field

import app.pb.conversation.plan as pb


class ToolType(int, Enum):
    UNKNOWN = 0
    BUILTIN = 1

    @classmethod
    def from_pb(cls, pb_value: pb.ToolType) -> "ToolType":
        return cls(pb_value.value)

    def to_pb(self) -> pb.ToolType:
        return pb.ToolType(self.value)

class ToolDeliverableType(int, Enum):
    UNKNOWN = 0
    MARKDOWN = 1
    FILE = 2
    WEB_PREVIEW_URL = 3
    ACQUIRED_SANDBOX = 5

    @classmethod
    def from_pb(cls, pb_value: pb.ToolDeliverableType) -> "ToolDeliverableType":
        return cls(pb_value.value)

    def to_pb(self) -> pb.ToolDeliverableType:
        return pb.ToolDeliverableType(self.value)

class ToolDeliverableAcquiredSandbox(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    sandbox_id: str = Field("", alias="sandboxId")
    sandbox_type: str = Field("", alias="sandboxType")
    endpoint: str = Field("", alias="endpoint")
    provider_base_url: str = Field("", alias="providerBaseUrl")
    device_id: str = Field("", alias="deviceId")
    display_name: str = Field("", alias="displayName")
    vnc_url: str = Field("", alias="vncUrl")

    @classmethod
    def from_pb(cls, pb_obj: pb.ToolDeliverableAcquiredSandbox) -> Self:
        return cls(
            sandbox_id=pb_obj.sandbox_id,
            sandbox_type=pb_obj.sandbox_type,
            endpoint=pb_obj.endpoint,
            provider_base_url=pb_obj.provider_base_url,
            device_id=pb_obj.device_id,
            display_name=pb_obj.display_name,
            vnc_url=pb_obj.vnc_url,
        )

    def to_pb(self) -> pb.ToolDeliverableAcquiredSandbox:
        pb_obj = pb.ToolDeliverableAcquiredSandbox()
        pb_obj.sandbox_id = self.sandbox_id
        pb_obj.sandbox_type = self.sandbox_type
        pb_obj.endpoint = self.endpoint
        pb_obj.provider_base_url = self.provider_base_url
        pb_obj.device_id = self.device_id
        pb_obj.display_name = self.display_name
        pb_obj.vnc_url = self.vnc_url
        return pb_obj

class ToolDeliverable(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    type: ToolDeliverableType = Field(ToolDeliverableType.UNKNOWN, alias="type")
    markdown_content: str = Field("", alias="markdownContent")
    markdown_title: str = Field("", alias="markdownTitle")
    file_url: str = Field("", alias="fileUrl")
    file_name: str = Field("", alias="fileName")
    web_preview_sas_url: str = Field("", alias="webPreviewSasUrl")
    acquired_sandbox: ToolDeliverableAcquiredSandbox = Field(
        default_factory=ToolDeliverableAcquiredSandbox, alias="acquiredSandbox")

    @classmethod
    def from_pb(cls, pb_obj: pb.ToolDeliverable) -> Self:
        return cls(
            type=ToolDeliverableType.from_pb(pb_obj.type),
            markdown_content=pb_obj.markdown_content,
            markdown_title=pb_obj.markdown_title,
            file_url=pb_obj.file_url,
            file_name=pb_obj.file_name,
            web_preview_sas_url=pb_obj.web_preview_sas_url,
            acquired_sandbox=ToolDeliverableAcquiredSandbox.from_pb(pb_obj.acquired_sandbox) if pb_obj.acquired_sandbox else None,
        )

    def to_pb(self) -> pb.ToolDeliverable:
        pb_obj = pb.ToolDeliverable()
        pb_obj.type = self.type.to_pb()
        pb_obj.markdown_content = self.markdown_content
        pb_obj.markdown_title = self.markdown_title
        pb_obj.file_url = self.file_url
        pb_obj.file_name = self.file_name
        pb_obj.web_preview_sas_url = self.web_preview_sas_url
        if self.acquired_sandbox:
            pb_obj.acquired_sandbox = self.acquired_sandbox.to_pb()
        return pb_obj


class ToolExecutionInfo(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    tool_type: ToolType = Field(ToolType.UNKNOWN, alias="toolType")
    builtin_tool_name: str = Field("", alias="builtinToolName")

    @classmethod
    def from_pb(cls, pb_obj: pb.ToolExecutionInfo) -> Self:
        return cls(
            tool_type=ToolType.from_pb(pb_obj.tool_type),
            builtin_tool_name=pb_obj.builtin_tool_name,
        )

    def to_pb(self) -> pb.ToolExecutionInfo:
        pb_obj = pb.ToolExecutionInfo()
        pb_obj.tool_type = self.tool_type.to_pb()
        pb_obj.builtin_tool_name = self.builtin_tool_name
        return pb_obj

class ToolCallRunningListItemStatus(int, Enum):
    UNKNOWN = 0
    PENDING = 1
    RUNNING = 2
    DONE = 3
    FAILED = 4
    CANCELLED = 5

    @classmethod
    def from_pb(cls, pb_value: pb.ToolCallRunningListItemStatus) -> "ToolCallRunningListItemStatus":
        return cls(pb_value.value)

    def to_pb(self) -> pb.ToolCallRunningListItemStatus:
        return pb.ToolCallRunningListItemStatus(self.value)

class ToolCallRunningListItem(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    name: str = Field("", alias="name")
    status: ToolCallRunningListItemStatus = Field(ToolCallRunningListItemStatus.UNKNOWN, alias="status")

    @classmethod
    def from_pb(cls, pb_obj: pb.ToolCallRunningListItem) -> Self:
        return cls(
            name=pb_obj.name,
            status=ToolCallRunningListItemStatus.from_pb(pb_obj.status),
        )

    def to_pb(self) -> pb.ToolCallRunningListItem:
        pb_obj = pb.ToolCallRunningListItem()
        pb_obj.name = self.name
        pb_obj.status = self.status.to_pb()
        return pb_obj

class ToolCallStatus(int, Enum):
    UNKNOWN = 0
    RUNNING = 1
    FAILED = 2
    SUCCESSFUL = 3
    FAILED_ANALYZING = 4
    FAILED_ANALYZED = 5
    RETRY_RUNNING = 6
    RETRY_SUCCESSFUL = 7
    RETRY_FAILED = 8

    @classmethod
    def from_pb(cls, pb_value: pb.ToolCallStatus) -> "ToolCallStatus":
        return cls(pb_value.value)

    def to_pb(self) -> pb.ToolCallStatus:
        return pb.ToolCallStatus(self.value)

class ToolCall(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    tool_name: str = Field("", alias="toolName")
    message: str = Field("", alias="message")
    running_list: list[ToolCallRunningListItem] = Field(default_factory=list, alias="runningList")
    execution_info: ToolExecutionInfo = Field(default_factory=ToolExecutionInfo, alias="executionInfo")
    deliverables: list[ToolDeliverable] = Field(default_factory=list, alias="deliverables")
    tool_call_id: int = Field(0, alias="toolCallId")
    batch_calls: list["ToolCall"] = Field(default_factory=list, alias="batchCalls")
    batch_item_index: int = Field(0, alias="batchItemIndex")
    tool_call_status: ToolCallStatus = Field(ToolCallStatus.RUNNING, alias="toolCallStatus")

    @classmethod
    def from_pb(cls, pb_obj: pb.ToolCall) -> Self:
        return cls(
            tool_name=pb_obj.tool_name,
            message=pb_obj.message,
            running_list=[ToolCallRunningListItem.from_pb(item) for item in pb_obj.running_list],
            execution_info=ToolExecutionInfo.from_pb(pb_obj.execution_info) if pb_obj.execution_info else ToolExecutionInfo(),
            deliverables=[ToolDeliverable.from_pb(d) for d in pb_obj.deliverables],
            tool_call_id=pb_obj.tool_call_id,
            batch_calls=[ToolCall.from_pb(bc) for bc in pb_obj.batch_calls] if pb_obj.batch_calls else [],
            batch_item_index=pb_obj.batch_item_index if pb_obj.batch_item_index else 0,
            tool_call_status=ToolCallStatus.from_pb(pb_obj.tool_call_status),
        )

    def to_pb(self) -> pb.ToolCall:
        pb_obj = pb.ToolCall()
        pb_obj.tool_name = self.tool_name
        pb_obj.message = self.message
        pb_obj.running_list.extend([item.to_pb() for item in self.running_list])
        pb_obj.execution_info = self.execution_info.to_pb() if self.execution_info else None
        pb_obj.deliverables.extend([d.to_pb() for d in self.deliverables])
        pb_obj.tool_call_id = self.tool_call_id
        pb_obj.batch_calls.extend([bc.to_pb() for bc in self.batch_calls])
        pb_obj.batch_item_index = self.batch_item_index
        pb_obj.tool_call_status = self.tool_call_status.to_pb()
        return pb_obj

    def remove_execution_info(self) -> Self:
        new_tool_call = self.model_copy(deep=True)
        new_tool_call.execution_info = ToolExecutionInfo()
        for batch_call in new_tool_call.batch_calls:
            batch_call.execution_info = ToolExecutionInfo()
        return new_tool_call

    def to_cancelled(self) -> Self:
        new_tool_call = self.model_copy(deep=True)
        for item in new_tool_call.running_list:
            if item.status not in [ToolCallRunningListItemStatus.DONE, ToolCallRunningListItemStatus.FAILED]:
                item.status = ToolCallRunningListItemStatus.CANCELLED
        new_tool_call.batch_calls = [bc.to_cancelled() for bc in new_tool_call.batch_calls]
        return new_tool_call

class PlanStepStatus(int, Enum):
    UNKNOWN = 0
    PENDING = 1
    IN_PROGRESS = 2
    COMPLETED = 3
    FAILED = 4
    REQUIRE_HUMAN_INPUT = 5
    CANCELLED = 6

    @classmethod
    def from_pb(cls, pb_value: pb.PlanStepStatus) -> "PlanStepStatus":
        return cls(pb_value.value)

    def to_pb(self) -> pb.PlanStepStatus:
        return pb.PlanStepStatus(self.value)

    @classmethod
    def from_string(cls, s: str) -> "PlanStepStatus":
        s = s.lower()
        v = {
            "pending": PlanStepStatus.PENDING,
            "in_progress": PlanStepStatus.IN_PROGRESS,
            "completed": PlanStepStatus.COMPLETED,
            "failed": PlanStepStatus.FAILED,
            "require_human_input": PlanStepStatus.REQUIRE_HUMAN_INPUT,
            "cancelled": PlanStepStatus.CANCELLED,
        }
        return v.get(s, PlanStepStatus.UNKNOWN)

    def to_string(self) -> str:
        v = {1: "pending", 2: "in_progress", 3: "completed", 4: "failed", 5: "require_human_input", 6: "cancelled"}
        return v.get(self.value, "unknown")

class PlanStep(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    title: str = Field("", alias="title")
    tool_calls: list[ToolCall] = Field(default_factory=list, alias="toolCalls")
    status: PlanStepStatus = Field(PlanStepStatus.UNKNOWN, alias="status")

    @classmethod
    def from_pb(cls, pb_obj: pb.PlanStep) -> Self:
        return cls(
            title=pb_obj.title,
            tool_calls=[ToolCall.from_pb(tc) for tc in pb_obj.tool_calls],
            status=PlanStepStatus.from_pb(pb_obj.status),
        )

    def to_pb(self) -> pb.PlanStep:
        pb_obj = pb.PlanStep()
        pb_obj.title = self.title
        pb_obj.tool_calls.extend([tc.to_pb() for tc in self.tool_calls])
        pb_obj.status = self.status.to_pb()
        return pb_obj

class PlanExtra(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    username: str = Field("", alias="username")
    agent_instance_id: int = Field(0, alias="agentInstanceId")
    agent_id: str = Field("", alias="agentId")
    turn_id: int = Field(0, alias="turnId")
    project_id: int = Field(0, alias="projectId")
    conversation_id: int = Field(0, alias="conversationId")
    updated_at: int = Field(0, alias="updatedAt")

    @classmethod
    def from_pb(cls, pb_obj: pb.PlanExtra) -> Self:
        return cls(
            username=pb_obj.username,
            agent_instance_id=pb_obj.agent_instance_id,
            agent_id=pb_obj.agent_id,
            turn_id=pb_obj.turn_id,
            project_id=pb_obj.project_id,
            conversation_id=pb_obj.conversation_id,
            updated_at=pb_obj.updated_at,
        )

    def to_pb(self) -> pb.PlanExtra:
        pb_obj = pb.PlanExtra()
        pb_obj.username = self.username
        pb_obj.agent_instance_id = self.agent_instance_id
        pb_obj.agent_id = self.agent_id
        pb_obj.turn_id = self.turn_id
        pb_obj.project_id = self.project_id
        pb_obj.conversation_id = self.conversation_id
        pb_obj.updated_at = self.updated_at
        return pb_obj

class PlanStatus(int, Enum):
    UNKNOWN = 0
    NO_PLAN = 1
    RUNNING = 2
    COMPLETED = 3
    FAILED = 4
    REQUIRE_HUMAN_INPUT = 5
    CANCELLED = 6

    @classmethod
    def from_pb(cls, pb_value: pb.PlanStatus) -> "PlanStatus":
        return cls(pb_value.value)

    def to_pb(self) -> pb.PlanStatus:
        return pb.PlanStatus(self.value)

class Plan(BaseModel):
    model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
    title: str = Field("", alias="title")
    steps: list[PlanStep] = Field(default_factory=list, alias="steps")
    extra: PlanExtra = Field(default_factory=PlanExtra, alias="extra")

    @classmethod
    def from_pb(cls, pb_obj: pb.Plan) -> Self:
        return cls(
            title=pb_obj.title,
            steps=[PlanStep.from_pb(s) for s in pb_obj.steps],
            extra=PlanExtra.from_pb(pb_obj.extra) if pb_obj.extra else PlanExtra(),
        )

    def to_pb(self) -> pb.Plan:
        pb_obj = pb.Plan()
        pb_obj.title = self.title
        pb_obj.steps.extend([s.to_pb() for s in self.steps])
        pb_obj.extra = self.extra.to_pb() if self.extra else None
        return pb_obj

    def remove_tool_calls(self) -> Self:
        new_plan = self.model_copy(deep=True)
        for step in new_plan.steps:
            step.tool_calls = []
        return new_plan

    def remove_tool_execution_info(self) -> Self:
        new_plan = self.model_copy(deep=True)
        for step in new_plan.steps:
            step.tool_calls = [tc.remove_execution_info() for tc in step.tool_calls]
        return new_plan

    def to_dict_with_status_as_string(self) -> dict[str, Any]:
        plan_dict = self.model_dump(by_alias=True)
        for step in plan_dict.get("steps", []):
            status_value = step.get("status")
            if isinstance(status_value, int):
                step["status"] = PlanStepStatus(status_value).to_string()
        return plan_dict

    def get_plan_status_from_step_status(self):
        # if no steps, mark as completed
        if not self.steps:
            return PlanStatus.COMPLETED

        any_condition = {
            PlanStepStatus.UNKNOWN: PlanStatus.UNKNOWN,
            PlanStepStatus.REQUIRE_HUMAN_INPUT: PlanStatus.REQUIRE_HUMAN_INPUT,
            PlanStepStatus.FAILED: PlanStatus.FAILED,
            PlanStepStatus.CANCELLED: PlanStatus.CANCELLED,
        }

        for step_status, plan_status in any_condition.items():
            if any(s.status == step_status for s in self.steps):
                return plan_status

        # if all steps COMPLETED status, mark as COMPLETED
        if all(s.status == PlanStepStatus.COMPLETED for s in self.steps):
            return PlanStatus.COMPLETED

        # otherwise mark as RUNNING
        return PlanStatus.RUNNING

    def is_cancelled(self):
        return self.get_plan_status_from_step_status() == PlanStatus.CANCELLED

    def get_tool_call(self, tool_call_id: int) -> ToolCall | None:
        for step in self.steps:
            for tool_call in step.tool_calls:
                if tool_call.tool_call_id == tool_call_id:
                    return tool_call
                for batch_call in tool_call.batch_calls:
                    if batch_call.tool_call_id == tool_call_id:
                        return batch_call
        return None

    def to_cancelled(self) -> Self:
        new_plan = self.model_copy(deep=True)
        # mark the first step that is not completed nor failed as cancelled
        flag = False
        for step in new_plan.steps:
            if not flag and step.status not in [PlanStepStatus.COMPLETED, PlanStepStatus.FAILED]:
                step.status = PlanStepStatus.CANCELLED
                flag = True
            step.tool_calls = [tc.to_cancelled() for tc in step.tool_calls]
        return new_plan

    def mark_finished(self) -> Self:
        if self.is_cancelled():
            return self
        # if there is a "require_human_input" step, return as is
        if any(s.status == PlanStepStatus.REQUIRE_HUMAN_INPUT for s in self.steps):
            return self
        # mark any "in_progress" as "completed", and remove all "pending"
        new_plan = self.model_copy(deep=True)
        new_steps = []
        for step in new_plan.steps:
            if step.status == PlanStepStatus.IN_PROGRESS:
                step.status = PlanStepStatus.COMPLETED
                new_steps.append(step)
            elif step.status == PlanStepStatus.PENDING:
                continue
            else:
                new_steps.append(step)
        new_plan.steps = new_steps
        return new_plan
