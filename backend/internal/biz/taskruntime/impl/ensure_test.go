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

import (
	"strings"
	"testing"
)

func TestEnsureTokenAcceptsMatchingToken(t *testing.T) {
	row := &taskRuntimeRunRow{RunID: "r1", FencingToken: "tok-abc"}
	payload := `{"run_id":"r1","token":"tok-abc","issued_at":1}`
	if err := ensureToken(row, payload); err != nil {
		t.Fatalf("expected nil for matching token, got %v", err)
	}
}

func TestEnsureTokenRejectsMismatch(t *testing.T) {
	row := &taskRuntimeRunRow{RunID: "r1", FencingToken: "tok-current"}
	payload := `{"run_id":"r1","token":"tok-old","issued_at":1}`
	err := ensureToken(row, payload)
	if err == nil {
		t.Fatal("expected stale token error, got nil")
	}
	if !IsStaleToken(err) {
		t.Fatalf("expected stale-token sentinel, got %v", err)
	}
}

func TestEnsureTokenRejectsEmptyServerToken(t *testing.T) {
	// A run that has never been claimed has an empty FencingToken; presenting any
	// token must be rejected (otherwise an attacker could write results to a run
	// they never claimed).
	row := &taskRuntimeRunRow{RunID: "r1", FencingToken: ""}
	payload := `{"run_id":"r1","token":"anything","issued_at":1}`
	err := ensureToken(row, payload)
	if !IsStaleToken(err) {
		t.Fatalf("expected stale-token sentinel for unclaimed run, got %v", err)
	}
}

func TestEnsureTokenSurfaceMalformedJSON(t *testing.T) {
	row := &taskRuntimeRunRow{RunID: "r1", FencingToken: "tok-x"}
	err := ensureToken(row, "not-json")
	if err == nil {
		t.Fatal("expected error for malformed token payload")
	}
	if IsStaleToken(err) {
		t.Fatalf("malformed JSON should not masquerade as a stale-token error, got %v", err)
	}
}

func TestEnsureClaimableAllowsQueued(t *testing.T) {
	row := &taskRuntimeRunRow{RunID: "r1", Status: statusQueued}
	if err := ensureClaimable(row); err != nil {
		t.Fatalf("queued run should be claimable, got %v", err)
	}
}

func TestEnsureClaimableRejectsTerminalStatuses(t *testing.T) {
	for _, status := range []string{statusRunning, "completed", "failed", "cancelled", "timed_out", "blocked"} {
		row := &taskRuntimeRunRow{RunID: "r1", Status: status}
		err := ensureClaimable(row)
		if err == nil {
			t.Fatalf("status %q must not be claimable", status)
		}
		if !IsStaleToken(err) {
			t.Fatalf(
				"status %q should surface a stale-token sentinel for FailedPrecondition mapping, got %v",
				status,
				err,
			)
		}
		if !strings.Contains(err.Error(), status) {
			t.Fatalf("error message should mention the offending status %q: %v", status, err)
		}
	}
}

func TestEnsureReopenableAllowsRetryableTerminalAtExpectedAttempt(t *testing.T) {
	for _, status := range []string{statusFailed, statusTimedOut, statusBlocked} {
		row := &taskRuntimeRunRow{RunID: "r1", Status: status, Attempt: 1}
		if err := ensureReopenable(row, 1); err != nil {
			t.Fatalf("status %q at the expected attempt should be reopenable, got %v", status, err)
		}
	}
}

func TestEnsureReopenableRejectsNonRetryableStatuses(t *testing.T) {
	// QUEUED/RUNNING are not terminal; COMPLETED/CANCELLED are absorbing. None of
	// them may be reopened for another attempt.
	for _, status := range []string{statusQueued, statusRunning, "completed", "cancelled"} {
		row := &taskRuntimeRunRow{RunID: "r1", Status: status, Attempt: 1}
		err := ensureReopenable(row, 1)
		if err == nil {
			t.Fatalf("status %q must not be reopenable", status)
		}
		if !IsStaleToken(err) {
			t.Fatalf(
				"status %q should surface a stale-token sentinel "+
					"for FailedPrecondition mapping, got %v", status, err)
		}
	}
}

func TestEnsureReopenableRejectsAttemptMismatch(t *testing.T) {
	// Compare-and-set guard: a stale or duplicate reopen that observed a different
	// attempt must be rejected so one run can never be bumped to two new attempts.
	row := &taskRuntimeRunRow{RunID: "r1", Status: statusFailed, Attempt: 2}
	err := ensureReopenable(row, 1)
	if err == nil {
		t.Fatal("attempt mismatch must be rejected")
	}
	if !IsStaleToken(err) {
		t.Fatalf("attempt mismatch should surface a stale-token sentinel, got %v", err)
	}
}

func reopenExisting() *taskRuntimeRunRow {
	return &taskRuntimeRunRow{
		RunID:                "r1",
		BatchID:              "b1",
		IdempotencyKey:       "key-1",
		BatchItemIndex:       3,
		TaskID:               "t1",
		ParentConversationID: 10,
		ParentTurnID:         2,
		Status:               statusFailed,
		Attempt:              1,
	}
}

func reopenPayload() *taskRuntimeRunRow {
	// A well-formed next-attempt payload: same identity, queued, attempt+1.
	return &taskRuntimeRunRow{
		RunID:                "r1",
		BatchID:              "b1",
		IdempotencyKey:       "key-1",
		BatchItemIndex:       3,
		TaskID:               "t1",
		ParentConversationID: 10,
		ParentTurnID:         2,
		Status:               statusQueued,
		Attempt:              2,
	}
}

func TestEnsureReopenPayloadAcceptsWellFormedNextAttempt(t *testing.T) {
	if err := ensureReopenPayload(reopenExisting(), reopenPayload(), 1); err != nil {
		t.Fatalf("well-formed reopen payload should be accepted, got %v", err)
	}
}

func TestEnsureReopenPayloadRejectsNonQueuedStatus(t *testing.T) {
	p := reopenPayload()
	p.Status = statusRunning
	if err := ensureReopenPayload(reopenExisting(), p, 1); !IsStaleToken(err) {
		t.Fatalf("non-queued reopen payload must be rejected as stale, got %v", err)
	}
}

func TestEnsureReopenPayloadRejectsWrongAttempt(t *testing.T) {
	p := reopenPayload()
	p.Attempt = 3 // expected is 1+1=2
	if err := ensureReopenPayload(reopenExisting(), p, 1); !IsStaleToken(err) {
		t.Fatalf("reopen payload with the wrong next attempt must be rejected, got %v", err)
	}
}

func TestEnsureReopenPayloadRejectsStaleRunState(t *testing.T) {
	// A fresh queued attempt must carry no leftover worker / fencing / timestamps,
	// so a caller bug can never persist a "queued" row that still looks claimed.
	started := uint64(5)
	mutators := map[string]func(*taskRuntimeRunRow){
		"worker_id":     func(p *taskRuntimeRunRow) { p.WorkerID = "worker-9" },
		"fencing_token": func(p *taskRuntimeRunRow) { p.FencingToken = "tok" },
		"started_at":    func(p *taskRuntimeRunRow) { p.StartedAt = &started },
		"ended_at":      func(p *taskRuntimeRunRow) { p.EndedAt = &started },
	}
	for field, mutate := range mutators {
		p := reopenPayload()
		mutate(p)
		if err := ensureReopenPayload(reopenExisting(), p, 1); !IsStaleToken(err) {
			t.Fatalf("stale run-state field %q must be rejected, got %v", field, err)
		}
	}
}

func TestEnsureReopenPayloadRejectsIdentityChange(t *testing.T) {
	// Each identity field, mutated one at a time, must be rejected so a reopen can
	// never re-home a run to a different batch slot / idempotency key / parent.
	mutators := map[string]func(*taskRuntimeRunRow){
		"batch_id":               func(p *taskRuntimeRunRow) { p.BatchID = "other" },
		"idempotency_key":        func(p *taskRuntimeRunRow) { p.IdempotencyKey = "other" },
		"batch_item_index":       func(p *taskRuntimeRunRow) { p.BatchItemIndex = 9 },
		"task_id":                func(p *taskRuntimeRunRow) { p.TaskID = "other" },
		"parent_conversation_id": func(p *taskRuntimeRunRow) { p.ParentConversationID = 99 },
		"parent_turn_id":         func(p *taskRuntimeRunRow) { p.ParentTurnID = 99 },
	}
	for field, mutate := range mutators {
		p := reopenPayload()
		mutate(p)
		if err := ensureReopenPayload(reopenExisting(), p, 1); !IsStaleToken(err) {
			t.Fatalf("changing identity field %q must be rejected, got %v", field, err)
		}
	}
}

func TestDuplicateRunCreateMatchesExistingRequiresSameIdempotencyKey(t *testing.T) {
	existing := taskRuntimeRunRow{RunID: "run-1", BatchID: "batch-1", IdempotencyKey: "key-1"}

	if !duplicateRunCreateMatchesExisting(existing,
		taskRuntimeRunRow{RunID: "run-1", BatchID: "batch-1", IdempotencyKey: " key-1 "},
	) {
		t.Fatal("expected exact run/idempotency retry to be accepted")
	}
	if duplicateRunCreateMatchesExisting(existing,
		taskRuntimeRunRow{RunID: "run-1", BatchID: "batch-1", IdempotencyKey: "key-2"},
	) {
		t.Fatal("same run_id with a different idempotency key must be treated as a collision")
	}
	if duplicateRunCreateMatchesExisting(existing,
		taskRuntimeRunRow{RunID: "run-2", BatchID: "batch-1", IdempotencyKey: "key-1"},
	) {
		t.Fatal("same idempotency key with a different run_id must be treated as a collision")
	}
	if duplicateRunCreateMatchesExisting(existing,
		taskRuntimeRunRow{RunID: "run-1", BatchID: "batch-2", IdempotencyKey: "key-1"},
	) {
		t.Fatal("same run_id and idempotency key in a different batch must be treated as a collision")
	}
	if duplicateRunCreateMatchesExisting(
		taskRuntimeRunRow{RunID: "run-1", BatchID: "batch-1"},
		taskRuntimeRunRow{RunID: "run-1", BatchID: "batch-1"},
	) {
		t.Fatal("empty idempotency keys must not be silently accepted")
	}
}
