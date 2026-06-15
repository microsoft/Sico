package dal

import "fmt"

func terminalBatchStatuses() []string {
	return []string{statusCompleted, statusPartial, statusFailed, statusCancelled, statusTimedOut, statusBlocked}
}

func isActiveBatchStatus(status string) bool {
	return status == statusQueued || status == statusRunning
}

func terminalRunStatuses() []string {
	return []string{statusCompleted, statusFailed, statusCancelled, statusTimedOut, statusBlocked}
}

// retryableTerminalRunStatuses lists the terminal run statuses a run may be
// reopened from for another attempt. COMPLETED and CANCELLED are deliberately
// excluded — a recorded success or user cancellation is absorbing and must
// never be re-run.
func retryableTerminalRunStatuses() []string {
	return []string{statusFailed, statusTimedOut, statusBlocked}
}

func containsStatus(statuses []string, status string) bool {
	for _, terminalStatus := range statuses {
		if status == terminalStatus {
			return true
		}
	}

	return false
}

func shouldClearResultForRunUpdate(status string) bool {
	return status == statusQueued || status == statusRunning
}

func ensureToken(row *runRow, tokenPayload string) error {
	tokenJSON, err := decodeJSONValue[fencingTokenPayload](tokenPayload, labelTokenJSON)
	if err != nil {
		return err
	}
	if row.FencingToken == "" || row.FencingToken != tokenJSON.Token {
		return fmt.Errorf("%w: run %s", ErrStaleToken, row.RunID)
	}

	return nil
}

func ensureClaimable(row *runRow) error {
	if row.Status == statusQueued {
		return nil
	}

	return fmt.Errorf("%w: run %s is %s and cannot be claimed", ErrStaleToken, row.RunID, row.Status)
}

// ensureReopenable is the compare-and-set guard for ReopenRunForRetry: the
// locked row must still be in a retryable terminal status AND hold exactly the
// attempt the caller observed, so two concurrent (or stale) reopen requests can
// never bump the same run twice.
func ensureReopenable(row *runRow, expectedAttempt int32) error {
	if !containsStatus(retryableTerminalRunStatuses(), row.Status) {
		return fmt.Errorf("%w: run %s is %s and cannot be reopened for retry", ErrStaleToken, row.RunID, row.Status)
	}
	if row.Attempt != expectedAttempt {
		return fmt.Errorf("%w: run %s attempt %d does not match expected %d",
			ErrStaleToken, row.RunID, row.Attempt, expectedAttempt)
	}

	return nil
}

// ensureReopenPayload defends the reopen entry point against a caller payload
// that would change run identity or break the queued/attempt contract. The only
// fields a reopen may legitimately change are run state (status, attempt,
// last_error); identity, idempotency, and batch placement are invariant across
// attempts of the same run, and a fresh queued attempt must carry no leftover
// worker/fencing/timestamps. Violations surface as ErrStaleToken so a malformed
// reopen degrades to "not reopened" (the prior terminal result is preserved)
// rather than corrupting the row.
func ensureReopenPayload(existing, incoming *runRow, expectedAttempt int32) error {
	if incoming.Status != statusQueued {
		return fmt.Errorf(
			"%w: reopen payload for run %s must be queued, got %s",
			ErrStaleToken, existing.RunID, incoming.Status,
		)
	}
	if incoming.Attempt != expectedAttempt+1 {
		return fmt.Errorf(
			"%w: reopen payload for run %s must advance attempt to %d, got %d",
			ErrStaleToken, existing.RunID, expectedAttempt+1, incoming.Attempt,
		)
	}
	if incoming.WorkerID != "" || incoming.FencingToken != "" || incoming.StartedAt != nil || incoming.EndedAt != nil {
		return fmt.Errorf(
			"%w: reopen payload for run %s must clear worker/fencing/timestamps",
			ErrStaleToken, existing.RunID)
	}
	if incoming.BatchID != existing.BatchID ||
		incoming.IdempotencyKey != existing.IdempotencyKey ||
		incoming.BatchItemIndex != existing.BatchItemIndex ||
		incoming.TaskID != existing.TaskID ||
		incoming.ParentConversationID != existing.ParentConversationID ||
		incoming.ParentTurnID != existing.ParentTurnID {
		return fmt.Errorf("%w: reopen payload for run %s must not change identity fields", ErrStaleToken, existing.RunID)
	}

	return nil
}
