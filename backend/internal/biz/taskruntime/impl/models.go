// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package impl

import "gorm.io/datatypes"

type taskRuntimeBatchRow struct {
	ID                   uint64         `gorm:"column:id;primaryKey"`
	BatchID              string         `gorm:"column:batch_id"`
	ParentConversationID int64          `gorm:"column:parent_conversation_id"`
	ParentTurnID         int64          `gorm:"column:parent_turn_id"`
	ParentToolCallID     *int64         `gorm:"column:parent_tool_call_id"`
	Status               string         `gorm:"column:status"`
	Reason               string         `gorm:"column:reason"`
	JoinStrategy         string         `gorm:"column:join_strategy"`
	TotalCount           int            `gorm:"column:total_count"`
	CountsJSON           datatypes.JSON `gorm:"column:counts_json"`
	BatchJSON            datatypes.JSON `gorm:"column:batch_json"`
	CreatedAt            uint64         `gorm:"column:created_at"`
	UpdatedAt            uint64         `gorm:"column:updated_at"`
	LivenessAt           *uint64        `gorm:"column:liveness_at"`
	EndedAt              *uint64        `gorm:"column:ended_at"`
	CancellationReason   string         `gorm:"column:cancellation_reason"`
}

func (taskRuntimeBatchRow) TableName() string { return "t_task_runtime_batch" }

type taskRuntimeRunRow struct {
	ID                    uint64         `gorm:"column:id;primaryKey"`
	RunID                 string         `gorm:"column:run_id"`
	BatchID               string         `gorm:"column:batch_id"`
	ParentConversationID  int64          `gorm:"column:parent_conversation_id"`
	ParentTurnID          int64          `gorm:"column:parent_turn_id"`
	BatchItemIndex        int            `gorm:"column:batch_item_index"`
	TaskID                string         `gorm:"column:task_id"`
	IdempotencyKey        string         `gorm:"column:idempotency_key"`
	Status                string         `gorm:"column:status"`
	Attempt               int            `gorm:"column:attempt"`
	Executor              string         `gorm:"column:executor"`
	WorkerID              string         `gorm:"column:worker_id"`
	FencingToken          string         `gorm:"column:fencing_token"`
	QueuedAt              uint64         `gorm:"column:queued_at"`
	StartedAt             *uint64        `gorm:"column:started_at"`
	EndedAt               *uint64        `gorm:"column:ended_at"`
	LastErrorClass        string         `gorm:"column:last_error_class"`
	LastError             string         `gorm:"column:last_error"`
	RunJSON               datatypes.JSON `gorm:"column:run_json"`
	ResultJSON            datatypes.JSON `gorm:"column:result_json"`
	LatestProgressMessage string         `gorm:"column:latest_progress_message"`
	LatestProgressAt      uint64         `gorm:"column:latest_progress_at"`
	CreatedAt             uint64         `gorm:"column:created_at"`
	UpdatedAt             uint64         `gorm:"column:updated_at"`
}

func (taskRuntimeRunRow) TableName() string { return "t_task_runtime_run" }
