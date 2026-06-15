package dal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const taskRuntimeTxMaxAttempts = 3

// TaskDetail is the read model returned by GetTaskDetail: the canonical run
// payload, its raw result payload, and the view-specific rendered content plus
// the artifacts array.
type TaskDetail struct {
	RunJSON       string
	ResultJSON    string
	Content       string
	ArtifactsJSON string
}

// TaskRuntimeDAO owns all task-runtime persistence: the run/batch JSON-blob
// projection, the fencing/compare-and-set guards, and the stale-run sweep. It
// speaks the JSON document contract Core sends over reverse gRPC; the generated
// models back the indexed columns it projects out of those documents.
type TaskRuntimeDAO struct {
	db *gorm.DB
}

func NewTaskRuntimeDAO(db *gorm.DB) *TaskRuntimeDAO {
	return &TaskRuntimeDAO{db: db}
}

func (d *TaskRuntimeDAO) runTransaction(ctx context.Context, fn func(tx *gorm.DB) error) error {
	var err error
	for attempt := 1; attempt <= taskRuntimeTxMaxAttempts; attempt++ {
		err = d.db.WithContext(ctx).Transaction(fn)
		if !isRetryableTransactionError(err) || attempt == taskRuntimeTxMaxAttempts {
			return err
		}
		timer := time.NewTimer(time.Duration(attempt*25) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}

	return err
}

// CreateBatch inserts a batch row. A duplicate batch_id that already exists is
// treated as an idempotent success; a duplicate whose row vanished underneath
// the lookup surfaces as ErrDuplicate.
func (d *TaskRuntimeDAO) CreateBatch(ctx context.Context, batchJSON string) error {
	row, err := batchRowFromJSON(batchJSON)
	if err != nil {
		return err
	}

	if err := d.db.WithContext(ctx).Create(row).Error; err != nil {
		if !isDuplicateKey(err) {
			return err
		}
		var existing batchRow
		lookupErr := d.db.WithContext(ctx).Where(columnBatchID+" = ?", row.BatchID).First(&existing).Error
		if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return ErrDuplicate
		}
		if lookupErr != nil {
			return lookupErr
		}
	}

	return nil
}

// UpdateBatch writes the projected batch columns, guarding against resurrecting
// a batch that already reached a terminal status.
func (d *TaskRuntimeDAO) UpdateBatch(ctx context.Context, batchJSON string) error {
	row, err := batchRowFromJSON(batchJSON)
	if err != nil {
		return err
	}

	query := d.db.WithContext(ctx).
		Model(&batchRow{}).
		Where(columnBatchID+" = ?", row.BatchID)
	query = protectTerminalStatus(query, columnStatus, row.Status, terminalBatchStatuses())
	return query.UpdateColumns(batchUpdateMap(row)).Error
}

// GetBatch returns the canonical batch JSON for batchID. A missing row is a
// normal "not found" (found=false, nil error), matching the reverse-RPC
// contract.
func (d *TaskRuntimeDAO) GetBatch(ctx context.Context, batchID string) (string, bool, error) {
	var row batchRow
	err := d.db.WithContext(ctx).Where(columnBatchID+" = ?", strings.TrimSpace(batchID)).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}

	return canonicalBatchJSON(row), true, nil
}

// CreateRun inserts a run row. A duplicate that matches the existing run's
// identity (run_id + batch_id + idempotency_key) is an idempotent success;
// any other collision surfaces as ErrDuplicate.
func (d *TaskRuntimeDAO) CreateRun(ctx context.Context, runJSON string) error {
	row, err := runRowFromJSON(runJSON)
	if err != nil {
		return err
	}
	if err := d.db.WithContext(ctx).Create(row).Error; err != nil {
		if !isDuplicateKey(err) {
			return err
		}
		var existing runRow
		lookupErr := d.db.WithContext(ctx).Where(columnRunID+" = ?", row.RunID).First(&existing).Error
		if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return ErrDuplicate
		}
		if lookupErr != nil {
			return lookupErr
		}
		if duplicateRunCreateMatchesExisting(existing, *row) {
			return nil
		}
		return ErrDuplicate
	}

	return nil
}

func duplicateRunCreateMatchesExisting(existing, incoming runRow) bool {
	existingKey := strings.TrimSpace(existing.IdempotencyKey)
	incomingKey := strings.TrimSpace(incoming.IdempotencyKey)
	return existing.RunID == incoming.RunID &&
		existing.BatchID == incoming.BatchID &&
		existingKey != "" &&
		existingKey == incomingKey
}

// UpdateRun writes the projected run columns, guarding terminal runs against
// resurrection and clearing a stale result when the run drops back to a
// non-terminal status.
func (d *TaskRuntimeDAO) UpdateRun(ctx context.Context, runJSON string) error {
	row, err := runRowFromJSON(runJSON)
	if err != nil {
		return err
	}

	row.UpdatedAt = nowMS()
	updates := runUpdateMap(row)
	if shouldClearResultForRunUpdate(row.Status) {
		updates[columnResultJSON] = nil
	}
	query := d.db.WithContext(ctx).
		Model(&runRow{}).
		Where(columnRunID+" = ?", row.RunID)
	query = protectTerminalStatus(query, columnStatus, row.Status, terminalRunStatuses())

	return query.UpdateColumns(updates).Error
}

// ReopenRunForRetry re-queues a run that already settled into a retryable
// terminal status (failed / timed_out / blocked) so the scheduler can run
// another attempt. Production persistence keeps terminal runs immutable (see
// protectTerminalStatus / ensureClaimable) so a stale worker can never
// resurrect a settled run; a legitimate retry is the one exception, so it gets
// a dedicated, compare-and-set-guarded entry point instead of relaxing that
// invariant for every writer. The transaction locks the row, asserts it is
// still in a retryable terminal status at the caller's expectedAttempt (so a
// duplicate or stale reopen cannot fire twice), then writes the caller-provided
// next-attempt payload and drops the now-stale terminal result.
func (d *TaskRuntimeDAO) ReopenRunForRetry(ctx context.Context, runJSON string, expectedAttempt int32) error {
	row, err := runRowFromJSON(runJSON)
	if err != nil {
		return err
	}

	return d.runTransaction(ctx, func(tx *gorm.DB) error {
		existing, lockErr := findRun(tx, row.RunID, true)
		if lockErr != nil {
			return lockErr
		}
		if reopenErr := ensureReopenable(existing, expectedAttempt); reopenErr != nil {
			return reopenErr
		}
		if payloadErr := ensureReopenPayload(existing, row, expectedAttempt); payloadErr != nil {
			return payloadErr
		}
		row.UpdatedAt = nowMS()
		updates := runUpdateMap(row)
		// The reopened run is queued again, so neither the prior attempt's
		// terminal result nor its last progress line may linger — task detail,
		// finalization, and recovery views read them back.
		updates[columnResultJSON] = nil
		updates[columnLatestProgressMessage] = ""
		updates[columnLatestProgressAt] = 0
		return tx.Model(&runRow{}).Where(columnRunID+" = ?", row.RunID).UpdateColumns(updates).Error
	})
}

// LookupIdempotent returns the most recent run carrying idempotencyKey. An empty
// key never matches: callers that want a fresh run simply omit the lookup.
func (d *TaskRuntimeDAO) LookupIdempotent(ctx context.Context, idempotencyKey string) (string, bool, error) {
	key := strings.TrimSpace(idempotencyKey)
	if key == "" {
		return "", false, nil
	}

	var row runRow
	err := d.db.WithContext(ctx).
		Where(columnIdempotencyKey+" = ?", key).
		Order(columnId + " DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}

	return canonicalRunJSON(row), true, nil
}

// ClaimRun atomically transitions a queued run to running under a fresh fencing
// token and returns the token payload the worker must present on writes.
func (d *TaskRuntimeDAO) ClaimRun(ctx context.Context, runID, workerID string) (string, error) {
	var tokenJSON string
	err := d.runTransaction(ctx, func(tx *gorm.DB) error {
		row, runJSON, err := lockRun(tx, strings.TrimSpace(runID))
		if err != nil {
			return err
		}
		if err := ensureClaimable(row); err != nil {
			return err
		}

		now := nowMS()
		token := strings.ReplaceAll(uuid.NewString(), "-", "")
		putValue(runJSON, jsonKeyWorkerID, strings.TrimSpace(workerID))
		putValue(runJSON, jsonKeyFencingToken, token)
		putValue(runJSON, jsonKeyStatus, statusRunning)
		if getInt64(runJSON, jsonKeyStartedAt) == 0 {
			putValue(runJSON, jsonKeyStartedAt, now)
		}
		if err := updateRunPayload(tx, row, runJSON, now); err != nil {
			return err
		}
		if err := clearResultForNonTerminalRun(tx, row); err != nil {
			return err
		}
		tokenJSON = string(marshalJSON(map[string]any{
			jsonKeyRunID:    row.RunID,
			jsonKeyToken:    token,
			jsonKeyIssuedAt: now,
		}))
		return nil
	})
	if err != nil {
		return "", err
	}

	return tokenJSON, nil
}

// HeartbeatBatch refreshes a batch's owner-liveness signal in a single
// non-locking UPDATE on the batch row. While the owning core process is alive it
// bumps `liveness_at`; the sweeper gates every still-active run in the batch on
// this one signal (see SweepStaleRuns), so a batch with many queued runs costs
// exactly one write per interval instead of one per queued run. Once the owning
// process dies the heartbeat freezes and the sweeper reclaims the batch's runs
// after the normal threshold. Only QUEUED/RUNNING batches are touched — a batch
// that already reached a terminal status is never resurrected. The backend stamps
// its own clock while the sweeper's beforeTs is computed on core's clock; a fresh
// heartbeat therefore stays clear of the sweep threshold by the full stale margin
// unless the backend clock trails core's by more than that margin — a gap
// NTP-synced clocks never reach in practice.
func (d *TaskRuntimeDAO) HeartbeatBatch(ctx context.Context, batchID string) error {
	id := strings.TrimSpace(batchID)
	if id == "" {
		return fmt.Errorf("batch_id is required")
	}

	now := nowMS()
	return d.db.WithContext(ctx).
		Model(&batchRow{}).
		Where(columnBatchID+" = ?", id).
		Where(columnStatus+" IN ?", []string{statusQueued, statusRunning}).
		UpdateColumns(map[string]any{columnLivenessAt: now, columnUpdatedAt: now}).Error
}

// SetRunProgress writes the latest run progress message as a single UPDATE on
// `latest_progress_message`/`latest_progress_at`. It deliberately avoids the run
// row lock that claim/heartbeat/write_result take, so high-frequency progress
// updates from executors cannot block (or be blocked by) those control RPCs.
// Out-of-order writes (ts <= existing) are silently dropped via the WHERE clause.
func (d *TaskRuntimeDAO) SetRunProgress(ctx context.Context, runID, message string, ts int64) error {
	id := strings.TrimSpace(runID)
	if id == "" {
		return fmt.Errorf("run_id is required")
	}
	if ts == 0 {
		ts = nowMS()
	}

	updates := map[string]any{
		columnLatestProgressMessage: truncateProgressMessage(message),
		columnLatestProgressAt:      ts,
		columnUpdatedAt:             nowMS(),
	}

	return d.db.WithContext(ctx).
		Model(&runRow{}).
		Where(columnRunID+" = ?", id).
		Where(columnLatestProgressAt+" <= ?", ts).
		UpdateColumns(updates).Error
}

// WriteResult validates the worker's fencing token, projects the terminal
// result back into the run payload, and persists the raw result JSON.
func (d *TaskRuntimeDAO) WriteResult(ctx context.Context, runID, tokenJSON, resultJSONStr string) error {
	return d.runTransaction(ctx, func(tx *gorm.DB) error {
		row, runJSON, err := lockRun(tx, strings.TrimSpace(runID))
		if err != nil {
			return err
		}
		if err := ensureToken(row, tokenJSON); err != nil {
			return err
		}
		resultJSON, err := decodeJSONValue[taskRuntimeResultPayload](resultJSONStr, labelResultJSON)
		if err != nil {
			return err
		}

		now := nowMS()
		putValue(runJSON, jsonKeyStatus, resultJSON.Status)
		if resultJSON.EndedAt != nil {
			putValue(runJSON, jsonKeyEndedAt, *resultJSON.EndedAt)
		}
		if getInt64(runJSON, jsonKeyEndedAt) == 0 {
			putValue(runJSON, jsonKeyEndedAt, now)
		}
		putValue(runJSON, jsonKeyLastErrorClass, resultJSON.ErrorClass)
		putValue(runJSON, jsonKeyLastError, resultJSON.ErrorMessage)
		if err := updateRunPayload(tx, row, runJSON, now); err != nil {
			return err
		}

		updates := map[string]any{columnResultJSON: jsonBytes(compactJSON(resultJSONStr)), columnUpdatedAt: now}
		return tx.Model(&runRow{}).Where(columnRunID+" = ?", row.RunID).UpdateColumns(updates).Error
	})
}

// CancelBatch cancels an active batch and every still-active run inside it.
func (d *TaskRuntimeDAO) CancelBatch(ctx context.Context, batchID, reason string) error {
	return d.runTransaction(ctx, func(tx *gorm.DB) error {
		var batch batchRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(columnBatchID+" = ?", batchID).
			First(&batch).Error; err != nil {
			return err
		}
		if !isActiveBatchStatus(batch.Status) {
			return nil
		}

		batchJSON, err := decodeJSONMap(string(batch.BatchJSON), labelBatchJSON)
		if err != nil {
			return err
		}

		now := nowMS()
		putValue(batchJSON, jsonKeyStatus, statusCancelled)
		putValue(batchJSON, jsonKeyCancellationReason, reason)
		putValue(batchJSON, jsonKeyEndedAt, now)
		batch.Status = statusCancelled
		batch.CancellationReason = reason
		batch.EndedAt = &now
		batch.UpdatedAt = now
		batch.BatchJSON = marshalJSON(batchJSON)
		if err := tx.Save(&batch).Error; err != nil {
			return err
		}

		var runs []runRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(columnBatchID+" = ?", batch.BatchID).
			Find(&runs).Error; err != nil {
			return err
		}

		for i := range runs {
			if err := cancelRunRowTx(tx, &runs[i], reason, now); err != nil {
				return err
			}
		}

		return nil
	})
}

// CancelRun cancels a single active run.
func (d *TaskRuntimeDAO) CancelRun(ctx context.Context, runID, reason string) error {
	return d.runTransaction(ctx, func(tx *gorm.DB) error {
		row, err := findRun(tx, strings.TrimSpace(runID), true)
		if err != nil {
			return err
		}

		return cancelRunRowTx(tx, row, reason, nowMS())
	})
}

// GetRun returns the canonical run JSON for runID, or found=false when absent.
func (d *TaskRuntimeDAO) GetRun(ctx context.Context, runID string) (string, bool, error) {
	row, err := findRun(d.db.WithContext(ctx), strings.TrimSpace(runID), false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}

	return canonicalRunJSON(*row), true, nil
}

// GetTaskDetail returns the canonical run payload plus the view-specific content
// and artifacts for runID.
func (d *TaskRuntimeDAO) GetTaskDetail(ctx context.Context, runID, view string) (TaskDetail, bool, error) {
	row, err := findRun(d.db.WithContext(ctx), strings.TrimSpace(runID), false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return TaskDetail{}, false, nil
	}
	if err != nil {
		return TaskDetail{}, false, err
	}

	content, artifactsJSON := detailContent(row, strings.TrimSpace(view))
	return TaskDetail{
		RunJSON:       canonicalRunJSON(*row),
		ResultJSON:    string(row.ResultJSON),
		Content:       content,
		ArtifactsJSON: artifactsJSON,
	}, true, nil
}

// ListBatchRuns returns the canonical run JSON for every run in a batch, ordered
// by batch item index then insertion order.
func (d *TaskRuntimeDAO) ListBatchRuns(ctx context.Context, batchID string) ([]string, error) {
	var rows []runRow
	if err := d.db.WithContext(ctx).
		Where(columnBatchID+" = ?", strings.TrimSpace(batchID)).
		Order(columnBatchItemIndex + " ASC, " + columnId + " ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}

	runsJSON := make([]string, 0, len(rows))
	for _, row := range rows {
		runsJSON = append(runsJSON, canonicalRunJSON(row))
	}
	return runsJSON, nil
}

// ListBatchesByTurn returns the canonical batch JSON for every batch owned by a
// conversation turn, optionally restricted to still-active batches.
func (d *TaskRuntimeDAO) ListBatchesByTurn(
	ctx context.Context,
	parentConversationID, parentTurnID int64,
	activeOnly bool,
) ([]string, error) {
	query := d.db.WithContext(ctx).
		Where(columnParentConversationID+" = ?", parentConversationID).
		Where(columnParentTurnID+" = ?", parentTurnID)
	if activeOnly {
		query = query.Where(columnStatus+" IN ?", []string{statusQueued, statusRunning})
	}

	var rows []batchRow
	if err := query.Order(columnId + " ASC").Find(&rows).Error; err != nil {
		return nil, err
	}

	batchesJSON := make([]string, 0, len(rows))
	for _, row := range rows {
		batchesJSON = append(batchesJSON, canonicalBatchJSON(row))
	}
	return batchesJSON, nil
}

func detailContent(row *runRow, view string) (string, string) {
	if len(row.ResultJSON) == 0 {
		return "", "[]"
	}
	resultJSON, err := decodeJSONValue[taskRuntimeResultPayload](string(row.ResultJSON), labelResultJSON)
	if err != nil {
		return "", "[]"
	}

	artifactsJSON := string(marshalJSON(resultJSON.Artifacts))
	if view == viewArtifacts {
		return artifactsJSON, artifactsJSON
	}

	return resultJSON.Summary, artifactsJSON
}

func protectTerminalStatus(query *gorm.DB, column string, incomingStatus string, terminalStatuses []string) *gorm.DB {
	if containsStatus(terminalStatuses, incomingStatus) {
		return query.Where("("+column+" NOT IN ? OR "+column+" = ?)", terminalStatuses, incomingStatus)
	}

	return query.Where(column+" NOT IN ?", terminalStatuses)
}

func findRun(db *gorm.DB, runID string, lock bool) (*runRow, error) {
	var row runRow
	query := db.Where(columnRunID+" = ?", runID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}

	if err := query.First(&row).Error; err != nil {
		return nil, err
	}

	return &row, nil
}

func lockRun(tx *gorm.DB, runID string) (*runRow, jsonMap, error) {
	row, err := findRun(tx, runID, true)
	if err != nil {
		return nil, nil, err
	}

	runJSON, err := decodeJSONMap(string(row.RunJSON), labelRunJSON)
	if err != nil {
		return nil, nil, err
	}

	canonicalizeRunPayload(row, runJSON)
	return row, runJSON, nil
}

// updateRunPayload reprojects the mutated run JSON back into the indexed run
// columns. The caller passes its transaction-level now so the run row's
// updated_at matches every other timestamp written in the same transaction
// (the result row, the fencing token's issued_at, ended_at, ...).
func updateRunPayload(tx *gorm.DB, row *runRow, payload jsonMap, now int64) error {
	updated := marshalJSON(payload)
	row.Status = getString(payload, jsonKeyStatus)
	row.Attempt = int32(getInt(payload, jsonKeyAttempt))
	row.WorkerID = getString(payload, jsonKeyWorkerID)
	row.FencingToken = getString(payload, jsonKeyFencingToken)
	row.StartedAt = getOptionalInt64(payload, jsonKeyStartedAt)
	row.EndedAt = getOptionalInt64(payload, jsonKeyEndedAt)
	row.LastErrorClass = getString(payload, jsonKeyLastErrorClass)
	row.LastError = getString(payload, jsonKeyLastError)
	row.RunJSON = updated
	row.UpdatedAt = now

	return tx.Model(&runRow{}).Where(columnRunID+" = ?", row.RunID).UpdateColumns(runUpdateMap(row)).Error
}

func clearResultForNonTerminalRun(tx *gorm.DB, row *runRow) error {
	if !shouldClearResultForRunUpdate(row.Status) {
		return nil
	}
	return tx.Model(&runRow{}).
		Where(columnRunID+" = ?", row.RunID).
		UpdateColumn(columnResultJSON, nil).Error
}

func cancelRunRowTx(tx *gorm.DB, row *runRow, reason string, now int64) error {
	if row.Status != statusQueued && row.Status != statusRunning {
		return nil
	}
	runJSON, err := decodeJSONMap(string(row.RunJSON), labelRunJSON)
	if err != nil {
		return err
	}

	canonicalizeRunPayload(row, runJSON)
	putValue(runJSON, jsonKeyStatus, statusCancelled)
	putValue(runJSON, jsonKeyFencingToken, "")
	putValue(runJSON, jsonKeyLastErrorClass, "")
	putValue(runJSON, jsonKeyLastError, reason)
	putValue(runJSON, jsonKeyEndedAt, now)
	return updateRunPayload(tx, row, runJSON, now)
}

// truncateProgressMessage clips progress messages to the column width
// (VARCHAR(1000), counted in characters under utf8mb4). MySQL would silently
// truncate (or error in STRICT mode); we trim explicitly here so the value
// we read back matches what we stored.
func truncateProgressMessage(message string) string {
	const limit = 1000
	runes := []rune(message)
	if len(runes) <= limit {
		return message
	}

	return string(runes[:limit])
}
