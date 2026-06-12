package dal

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBatchRowFromJSONRequiresBatchID(t *testing.T) {
	_, err := batchRowFromJSON(`{"parent_conversation_id":1}`)
	if err == nil {
		t.Fatal("expected error when batch_id is missing")
	}
}

func TestBatchRowFromJSONAppliesDefaults(t *testing.T) {
	row, err := batchRowFromJSON(`{"batch_id":"b1","total_count":2}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if row.Status != statusQueued {
		t.Fatalf("expected default status %q, got %q", statusQueued, row.Status)
	}
	if row.JoinStrategy != joinStrategyPartialOK {
		t.Fatalf("expected default join_strategy %q, got %q", joinStrategyPartialOK, row.JoinStrategy)
	}
	if row.CreatedAt == 0 {
		t.Fatal("CreatedAt should be auto-populated when omitted")
	}
	if row.UpdatedAt == 0 {
		t.Fatal("UpdatedAt should be auto-populated when omitted")
	}
	if row.LivenessAt == nil || *row.LivenessAt != row.CreatedAt {
		t.Fatalf("LivenessAt should be seeded to CreatedAt, got %v (created=%d)", row.LivenessAt, row.CreatedAt)
	}
}

func TestBatchRowFromJSONPreservesProvidedTimestamps(t *testing.T) {
	row, err := batchRowFromJSON(`{"batch_id":"b1","created_at":111,"updated_at":222}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if row.CreatedAt != 111 || row.UpdatedAt != 222 {
		t.Fatalf("timestamps should be preserved, got created=%d updated=%d", row.CreatedAt, row.UpdatedAt)
	}
	if row.LivenessAt == nil || *row.LivenessAt != 111 {
		t.Fatalf("LivenessAt should be seeded to CreatedAt, got %v", row.LivenessAt)
	}
}

func TestRunRowFromJSONRequiresRunAndBatchID(t *testing.T) {
	if _, err := runRowFromJSON(`{"batch_id":"b1","spec":{"task_id":"t"}}`); err == nil {
		t.Fatal("expected error when run_id is missing")
	}
	if _, err := runRowFromJSON(`{"run_id":"r1","spec":{"task_id":"t"}}`); err == nil {
		t.Fatal("expected error when batch_id is missing")
	}
}

func TestRunRowFromJSONAppliesDefaults(t *testing.T) {
	row, err := runRowFromJSON(`{"run_id":"r1","batch_id":"b1","spec":{"task_id":"t","title":"x","kind":"tool"}}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if row.Status != statusQueued {
		t.Fatalf("expected default status, got %q", row.Status)
	}
	if row.Attempt != 1 {
		t.Fatalf("expected default attempt=1, got %d", row.Attempt)
	}
	if row.QueuedAt == 0 {
		t.Fatal("QueuedAt should default to CreatedAt when omitted")
	}
	if row.TaskID != "t" {
		t.Fatalf("expected TaskID lifted from spec, got %q", row.TaskID)
	}
}

func TestRunRowFromJSONCarriesIdempotencyKey(t *testing.T) {
	payload := `{"run_id":"r1","batch_id":"b1","idempotency_key":"abc","spec":{"task_id":"t","title":"x","kind":"tool"}}`
	row, err := runRowFromJSON(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if row.IdempotencyKey != "abc" {
		t.Fatalf("expected idempotency_key=abc, got %q", row.IdempotencyKey)
	}
}

func TestStaleRunJSONIncludesCoreFields(t *testing.T) {
	row := runRow{
		RunID:    "r1",
		BatchID:  "b1",
		Status:   "running",
		WorkerID: "w1",
		QueuedAt: 21,
	}
	got := staleRunJSON(row)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(got), &decoded); err != nil {
		t.Fatalf("staleRunJSON output is not valid JSON: %v", err)
	}
	for _, key := range []string{"run_id", "batch_id", "status", "worker_id", "queued_at"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("staleRunJSON missing field %q in %s", key, got)
		}
	}
}

func TestStaleBatchJSONCanTriggerBatchFinalization(t *testing.T) {
	got := staleBatchJSON(batchRow{BatchID: "batch-1", Status: statusRunning})
	var decoded map[string]any
	if err := json.Unmarshal([]byte(got), &decoded); err != nil {
		t.Fatalf("staleBatchJSON output is not valid JSON: %v", err)
	}
	assertStringField(t, decoded, jsonKeyRunID, "")
	assertStringField(t, decoded, jsonKeyBatchID, "batch-1")
	assertStringField(t, decoded, jsonKeyStatus, statusRunning)
}

func TestTerminalBatchStatusesIncludePartialRecoveryState(t *testing.T) {
	statuses := map[string]bool{}
	for _, status := range terminalBatchStatuses() {
		statuses[status] = true
	}
	for _, status := range []string{
		statusCompleted, statusPartial, statusFailed,
		statusCancelled, statusTimedOut, statusBlocked,
	} {
		if !statuses[status] {
			t.Fatalf("terminal batch statuses should include %q", status)
		}
	}
}

func TestStaleRunStartedAtIgnoresZeroStartedAt(t *testing.T) {
	zero := int64(0)
	row := &runRow{QueuedAt: 1_000, StartedAt: &zero}
	if got := staleRunStartedAt(row, 2_000); got != 1_000 {
		t.Fatalf("expected queued_at fallback, got %d", got)
	}
	if got := staleRunStartedAt(&runRow{}, 2_000); got != 2_000 {
		t.Fatalf("expected now fallback, got %d", got)
	}
}

func TestStaleRunDurationRequiresTrustedStartedAt(t *testing.T) {
	zero := int64(0)
	if _, ok := staleRunDuration(&runRow{QueuedAt: 1_000, StartedAt: &zero}, 2_000); ok {
		t.Fatal("zero started_at should not produce duration_ms")
	}
	startedAt := int64(1_000)
	duration, ok := staleRunDuration(&runRow{QueuedAt: 500, StartedAt: &startedAt}, 2_000)
	if !ok || duration != 1_000 {
		t.Fatalf("expected trusted started_at duration=1000, got duration=%d ok=%v", duration, ok)
	}
}

func TestCanonicalRunJSONUsesRowIdentifiers(t *testing.T) {
	payload := `{"run_id":"stale-json-run","batch_id":"old-batch","parent_turn_id":1,` +
		`"spec":{"task_id":"t","title":"x","kind":"tool"}}`
	row := runRow{
		RunID:                "row-run",
		BatchID:              "row-batch",
		ParentConversationID: 7,
		ParentTurnID:         8,
		BatchItemIndex:       2,
		IdempotencyKey:       "idem",
		Status:               statusQueued,
		Attempt:              1,
		RunJSON:              jsonBytes(payload),
	}
	got := canonicalRunJSON(row)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(got), &decoded); err != nil {
		t.Fatalf("canonicalRunJSON output is not valid JSON: %v", err)
	}
	assertStringField(t, decoded, jsonKeyRunID, "row-run")
	assertStringField(t, decoded, jsonKeyBatchID, "row-batch")
	assertStringField(t, decoded, jsonKeyIdempotencyKey, "idem")
	if decoded[jsonKeyParentConversationID] != float64(7) || decoded[jsonKeyParentTurnID] != float64(8) {
		t.Fatalf("parent identifiers were not canonicalized: %v", decoded)
	}
	if decoded[jsonKeyBatchItemIndex] != float64(2) {
		t.Fatalf("batch item index was not canonicalized: %v", decoded[jsonKeyBatchItemIndex])
	}
}

func TestCanonicalBatchJSONUsesRowTerminalStatus(t *testing.T) {
	endedAt := int64(456)
	parentToolCallID := int64(2)
	row := batchRow{
		BatchID:              "batch-1",
		ParentConversationID: 7,
		ParentTurnID:         8,
		ParentToolCallID:     &parentToolCallID,
		Status:               statusCancelled,
		Reason:               "cancelled by user",
		JoinStrategy:         joinStrategyPartialOK,
		TotalCount:           52,
		CountsJSON:           jsonBytes(`{"completed":51,"cancelled":1}`),
		BatchJSON:            jsonBytes(`{"batch_id":"batch-1","status":"running","ended_at":null}`),
		CreatedAt:            123,
		UpdatedAt:            456,
		EndedAt:              &endedAt,
		CancellationReason:   "Acceptance client interrupted before completion.",
	}

	got := canonicalBatchJSON(row)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(got), &decoded); err != nil {
		t.Fatalf("canonicalBatchJSON output is not valid JSON: %v", err)
	}
	assertStringField(t, decoded, jsonKeyBatchID, "batch-1")
	assertStringField(t, decoded, jsonKeyStatus, statusCancelled)
	assertStringField(t, decoded, jsonKeyCancellationReason, "Acceptance client interrupted before completion.")
	if decoded[jsonKeyParentConversationID] != float64(7) || decoded[jsonKeyParentTurnID] != float64(8) {
		t.Fatalf("parent identifiers were not canonicalized: %v", decoded)
	}
	if decoded[jsonKeyParentToolCallID] != float64(2) || decoded[jsonKeyTotalCount] != float64(52) {
		t.Fatalf("batch metadata was not canonicalized: %v", decoded)
	}
}

// liveness_at is a backend-only column: it is bumped by HeartbeatBatch and must
// never be serialized into batch_json, because the core BatchRecord forbids
// unknown fields and would reject the payload on the next update_batch round-trip.
func TestCanonicalBatchJSONOmitsLivenessAt(t *testing.T) {
	liveness := int64(999)
	row := batchRow{
		BatchID:    "batch-1",
		Status:     statusRunning,
		BatchJSON:  jsonBytes(`{"batch_id":"batch-1","status":"running"}`),
		CreatedAt:  123,
		UpdatedAt:  456,
		LivenessAt: &liveness,
	}
	got := canonicalBatchJSON(row)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(got), &decoded); err != nil {
		t.Fatalf("canonicalBatchJSON output is not valid JSON: %v", err)
	}
	if _, ok := decoded["liveness_at"]; ok {
		t.Fatalf("liveness_at must not be serialized into batch_json: %v", decoded)
	}
}

func TestMarshalJSONPanicsOnUnsupportedType(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("marshalJSON should panic on unsupported types (e.g. channels)")
		}
		// The panic message should at least mention the package prefix so the
		// stack trace is easy to grep for during postmortems.
		msg, _ := r.(string)
		if !strings.Contains(msg, "taskruntime: marshalJSON failed") {
			t.Fatalf("unexpected panic payload: %v", r)
		}
	}()
	marshalJSON(map[string]any{"ch": make(chan int)})
}

func assertStringField(t *testing.T, decoded map[string]any, key string, want string) {
	t.Helper()
	if got, _ := decoded[key].(string); got != want {
		t.Fatalf("expected %s=%q, got %q", key, want, got)
	}
}
