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

package impl

const (
	labelBatchJSON  = "batch_json"
	labelRunJSON    = "run_json"
	labelResultJSON = "result_json"
	labelTokenJSON  = "token_json"
)

const (
	jsonKeyAttempt               = "attempt"
	jsonKeyBatchID               = "batch_id"
	jsonKeyBatchItemIndex        = "batch_item_index"
	jsonKeyCancellationReason    = "cancellation_reason"
	jsonKeyCounts                = "counts"
	jsonKeyCreatedAt             = "created_at"
	jsonKeyEndedAt               = "ended_at"
	jsonKeyExecutor              = "executor"
	jsonKeyFencingToken          = "fencing_token"
	jsonKeyIdempotencyKey        = "idempotency_key"
	jsonKeyIssuedAt              = "issued_at"
	jsonKeyLastError             = "last_error"
	jsonKeyLastErrorClass        = "last_error_class"
	jsonKeyLatestProgressAt      = "latest_progress_at"
	jsonKeyLatestProgressMessage = "latest_progress_message"
	jsonKeyParentConversationID  = "parent_conversation_id"
	jsonKeyParentToolCallID      = "parent_tool_call_id"
	jsonKeyParentTurnID          = "parent_turn_id"
	jsonKeyQueuedAt              = "queued_at"
	jsonKeyReason                = "reason"
	jsonKeyRunID                 = "run_id"
	jsonKeyStartedAt             = "started_at"
	jsonKeyStatus                = "status"
	jsonKeyJoinStrategy          = "join_strategy"
	jsonKeyTotalCount            = "total_count"
	jsonKeyToken                 = "token"
	jsonKeyUpdatedAt             = "updated_at"
	jsonKeyWorkerID              = "worker_id"
)

const (
	columnAttempt               = "attempt"
	columnBatchID               = "batch_id"
	columnBatchItemIndex        = "batch_item_index"
	columnBatchJSON             = "batch_json"
	columnCancellationReason    = "cancellation_reason"
	columnCountsJSON            = "counts_json"
	columnCreatedAt             = "created_at"
	columnEndedAt               = "ended_at"
	columnExecutor              = "executor"
	columnFencingToken          = "fencing_token"
	columnId                    = "id"
	columnIdempotencyKey        = "idempotency_key"
	columnJoinStrategy          = "join_strategy"
	columnLastError             = "last_error"
	columnLastErrorClass        = "last_error_class"
	columnLatestProgressAt      = "latest_progress_at"
	columnLatestProgressMessage = "latest_progress_message"
	columnLivenessAt            = "liveness_at"
	columnParentConversationID  = "parent_conversation_id"
	columnParentToolCallID      = "parent_tool_call_id"
	columnParentTurnID          = "parent_turn_id"
	columnQueuedAt              = "queued_at"
	columnReason                = "reason"
	columnResultJSON            = "result_json"
	columnRunID                 = "run_id"
	columnRunJSON               = "run_json"
	columnStartedAt             = "started_at"
	columnStatus                = "status"
	columnTaskID                = "task_id"
	columnTotalCount            = "total_count"
	columnUpdatedAt             = "updated_at"
	columnWorkerID              = "worker_id"
)

const (
	statusCompleted = "completed"
	statusPartial   = "partial"
	statusBlocked   = "blocked"
	statusCancelled = "cancelled"
	statusFailed    = "failed"
	statusQueued    = "queued"
	statusRunning   = "running"
	statusTimedOut  = "timed_out"
)

const taskRuntimeRecoveryResultPrefix = "task_runtime_recovery_batch:"

const (
	joinStrategyPartialOK = "partial_ok"
	responseSuccess       = "success"
	viewArtifacts         = "artifacts"
	viewSummary           = "summary"
)
