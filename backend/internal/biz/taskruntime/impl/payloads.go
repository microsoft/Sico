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

type taskRuntimeBatchPayload struct {
	BatchID              string         `json:"batch_id"`
	ParentConversationID int64          `json:"parent_conversation_id"`
	ParentTurnID         int64          `json:"parent_turn_id"`
	ParentToolCallID     *int64         `json:"parent_tool_call_id"`
	Status               string         `json:"status"`
	Reason               string         `json:"reason"`
	JoinStrategy         string         `json:"join_strategy"`
	TotalCount           int            `json:"total_count"`
	Counts               map[string]int `json:"counts"`
	CreatedAt            uint64         `json:"created_at"`
	UpdatedAt            uint64         `json:"updated_at"`
	EndedAt              *uint64        `json:"ended_at"`
	CancellationReason   string         `json:"cancellation_reason"`
}

type taskRuntimeRunPayload struct {
	RunID                string                     `json:"run_id"`
	BatchID              string                     `json:"batch_id"`
	ParentConversationID int64                      `json:"parent_conversation_id"`
	ParentTurnID         int64                      `json:"parent_turn_id"`
	BatchItemIndex       int                        `json:"batch_item_index"`
	Spec                 taskRuntimeTaskSpecPayload `json:"spec"`
	IdempotencyKey       string                     `json:"idempotency_key"`
	Status               string                     `json:"status"`
	Attempt              int                        `json:"attempt"`
	Executor             string                     `json:"executor"`
	WorkerID             string                     `json:"worker_id"`
	FencingToken         string                     `json:"fencing_token"`
	QueuedAt             uint64                     `json:"queued_at"`
	StartedAt            *uint64                    `json:"started_at"`
	EndedAt              *uint64                    `json:"ended_at"`
	LastErrorClass       string                     `json:"last_error_class"`
	LastError            string                     `json:"last_error"`
}

type taskRuntimeTaskSpecPayload struct {
	TaskID string `json:"task_id"`
}

type taskRuntimeResultPayload struct {
	Status       string  `json:"status"`
	Summary      string  `json:"summary"`
	ErrorClass   string  `json:"error_class"`
	ErrorMessage string  `json:"error_message"`
	EndedAt      *uint64 `json:"ended_at"`
	Artifacts    []any   `json:"artifacts"`
}

type fencingTokenPayload struct {
	Token string `json:"token"`
}
