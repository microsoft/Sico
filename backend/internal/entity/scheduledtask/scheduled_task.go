// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package scheduledtask

import (
	"gorm.io/gorm"

	commondto "sico-backend/internal/transport/http/dto/common"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	scheduledtaskdto "sico-backend/internal/transport/http/dto/scheduledtask"
)

type RunStatus int32

const (
	RunStatusClaimed   RunStatus = 1
	RunStatusRunning   RunStatus = 2
	RunStatusSucceeded RunStatus = 3
	RunStatusFailed    RunStatus = 4
)

type ScheduledTask struct {
	ID              int64                                    `gorm:"column:id;primaryKey;autoIncrement"`
	Name            string                                   `gorm:"column:name"`
	Enabled         bool                                     `gorm:"column:enabled"`
	AgentInstanceID int64                                    `gorm:"column:agent_instance_id"`
	CreatorUsername string                                   `gorm:"column:creator_username"`
	Message         string                                   `gorm:"column:message"`
	Attachments     []*commondto.Attachment                  `gorm:"column:attachments;serializer:json"`
	ExtraInfo       *scheduledtaskdto.ScheduledTaskExtraInfo `gorm:"column:extra_info;serializer:json"`
	CronExpression  string                                   `gorm:"column:cron_expression"`
	Timezone        string                                   `gorm:"column:timezone"`
	NextRunAt       int64                                    `gorm:"column:next_run_at"`
	LastRunAt       int64                                    `gorm:"column:last_run_at"`
	CreatedAt       int64                                    `gorm:"column:created_at;autoCreateTime:milli"`
	UpdatedAt       int64                                    `gorm:"column:updated_at;autoUpdateTime:milli"`
	DeletedAt       gorm.DeletedAt                           `gorm:"column:deleted_at"`
}

func (*ScheduledTask) TableName() string { return "t_scheduled_task" }

type Run struct {
	ID                 int64         `gorm:"column:id;primaryKey;autoIncrement"`
	ScheduledTaskID    int64         `gorm:"column:scheduled_task_id"`
	ScheduledFor       int64         `gorm:"column:scheduled_for"`
	Status             RunStatus     `gorm:"column:status"`
	SubmissionID       string        `gorm:"column:submission_id"`
	ConversationID     int64         `gorm:"column:conversation_id"`
	ErrorMessage       string        `gorm:"column:error_message"`
	ExtraInfo          *RunExtraInfo `gorm:"column:extra_info;serializer:json"`
	NotificationSentAt int64         `gorm:"column:notification_sent_at"`
	StartedAt          int64         `gorm:"column:started_at"`
	FinishedAt         int64         `gorm:"column:finished_at"`
	LeaseExpiresAt     int64         `gorm:"column:lease_expires_at"`
	CreatedAt          int64         `gorm:"column:created_at;autoCreateTime:milli"`
	UpdatedAt          int64         `gorm:"column:updated_at;autoUpdateTime:milli"`
}

func (*Run) TableName() string { return "t_scheduled_task_run" }

type RunExtraInfo struct {
	Task                *commondto.ScheduledTaskDigest `json:"task,omitempty"`
	ReceiverUsername    string                         `json:"receiverUsername,omitempty"`
	Timezone            string                         `json:"timezone,omitempty"`
	PlanStatus          conversationdto.PlanStatus     `json:"planStatus"`
	NotificationID      int64                          `json:"notificationId,omitempty"`
	SendEmailOnComplete bool                           `json:"sendEmailOnComplete,omitempty"`
}
