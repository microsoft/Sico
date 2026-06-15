package dal

type taskRuntimeBatchPayload struct {
	BatchID              string         `json:"batch_id"`
	ParentConversationID int64          `json:"parent_conversation_id"`
	ParentTurnID         int64          `json:"parent_turn_id"`
	ParentToolCallID     *int64         `json:"parent_tool_call_id"`
	Status               string         `json:"status"`
	Reason               string         `json:"reason"`
	JoinStrategy         string         `json:"join_strategy"`
	TotalCount           int32          `json:"total_count"`
	Counts               map[string]int `json:"counts"`
	CreatedAt            int64          `json:"created_at"`
	UpdatedAt            int64          `json:"updated_at"`
	EndedAt              *int64         `json:"ended_at"`
	CancellationReason   string         `json:"cancellation_reason"`
}

type taskRuntimeRunPayload struct {
	RunID                string                     `json:"run_id"`
	BatchID              string                     `json:"batch_id"`
	ParentConversationID int64                      `json:"parent_conversation_id"`
	ParentTurnID         int64                      `json:"parent_turn_id"`
	BatchItemIndex       int32                      `json:"batch_item_index"`
	Spec                 taskRuntimeTaskSpecPayload `json:"spec"`
	IdempotencyKey       string                     `json:"idempotency_key"`
	Status               string                     `json:"status"`
	Attempt              int32                      `json:"attempt"`
	Executor             string                     `json:"executor"`
	WorkerID             string                     `json:"worker_id"`
	FencingToken         string                     `json:"fencing_token"`
	QueuedAt             int64                      `json:"queued_at"`
	StartedAt            *int64                     `json:"started_at"`
	EndedAt              *int64                     `json:"ended_at"`
	LastErrorClass       string                     `json:"last_error_class"`
	LastError            string                     `json:"last_error"`
}

type taskRuntimeTaskSpecPayload struct {
	TaskID string `json:"task_id"`
}

type taskRuntimeResultPayload struct {
	Status       string `json:"status"`
	Summary      string `json:"summary"`
	ErrorClass   string `json:"error_class"`
	ErrorMessage string `json:"error_message"`
	EndedAt      *int64 `json:"ended_at"`
	Artifacts    []any  `json:"artifacts"`
}

type fencingTokenPayload struct {
	Token string `json:"token"`
}
