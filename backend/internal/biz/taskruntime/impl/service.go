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
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/taskruntime"
)

const taskRuntimeTxMaxAttempts = 3

type Service struct {
	rgrpc.UnimplementedReverseTaskRuntimeRPCServer
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func (s *Service) runTransaction(ctx context.Context, fn func(tx *gorm.DB) error) error {
	var err error
	for attempt := 1; attempt <= taskRuntimeTxMaxAttempts; attempt++ {
		err = s.db.WithContext(ctx).Transaction(fn)
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

func (s *Service) RpcCreateBatch(ctx context.Context, req *rgrpc.CreateBatchRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	const op = "RpcCreateBatch"
	row, _, err := batchRowFromJSON(req.GetBatchJson())
	if err != nil {
		return nil, translateError(op, err)
	}
	if err := s.db.WithContext(ctx).Create(row).Error; err != nil {
		if !isDuplicateKey(err) {
			return nil, translateError(op, err)
		}
		var existing taskRuntimeBatchRow
		lookupErr := s.db.WithContext(ctx).Where(columnBatchID+" = ?", row.BatchID).First(&existing).Error
		if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return nil, translateError(op, err)
		}
		if lookupErr != nil {
			return nil, internalError(op, lookupErr)
		}
	}
	return emptyOK(), nil
}

func (s *Service) RpcUpdateBatch(ctx context.Context, req *rgrpc.UpdateBatchRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	const op = "RpcUpdateBatch"
	row, _, err := batchRowFromJSON(req.GetBatchJson())
	if err != nil {
		return nil, translateError(op, err)
	}
	query := s.db.WithContext(ctx).
		Model(&taskRuntimeBatchRow{}).
		Where(columnBatchID+" = ?", row.BatchID)
	query = protectTerminalStatus(query, columnStatus, row.Status, terminalBatchStatuses())
	if err := query.Updates(batchUpdateMap(row)).Error; err != nil {
		return nil, translateError(op, err)
	}
	return emptyOK(), nil
}

func (s *Service) RpcGetBatch(ctx context.Context, req *rgrpc.GetBatchRequest) (*rgrpc.GetBatchResponse, error) {
	const op = "RpcGetBatch"
	var row taskRuntimeBatchRow
	err := s.db.WithContext(ctx).Where(columnBatchID+" = ?", strings.TrimSpace(req.GetBatchId())).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Genuine "not present" is part of the domain contract — return success with Found:false.
		return &rgrpc.GetBatchResponse{Found: false, Code: 0, Msg: responseSuccess}, nil
	}
	if err != nil {
		return nil, internalError(op, err)
	}
	return &rgrpc.GetBatchResponse{BatchJson: canonicalBatchJSON(row), Found: true, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcCreateRun(ctx context.Context, req *rgrpc.CreateRunRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	const op = "RpcCreateRun"
	row, _, err := runRowFromJSON(req.GetRunJson())
	if err != nil {
		return nil, translateError(op, err)
	}
	if err := s.db.WithContext(ctx).Create(row).Error; err != nil {
		if !isDuplicateKey(err) {
			return nil, translateError(op, err)
		}
		var existing taskRuntimeRunRow
		lookupErr := s.db.WithContext(ctx).Where(columnRunID+" = ?", row.RunID).First(&existing).Error
		if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return nil, translateError(op, err)
		}
		if lookupErr != nil {
			return nil, internalError(op, lookupErr)
		}
		if duplicateRunCreateMatchesExisting(existing, *row) {
			return emptyOK(), nil
		}
		return nil, translateError(op, err)
	}
	return emptyOK(), nil
}

func duplicateRunCreateMatchesExisting(existing, incoming taskRuntimeRunRow) bool {
	existingKey := strings.TrimSpace(existing.IdempotencyKey)
	incomingKey := strings.TrimSpace(incoming.IdempotencyKey)
	return existing.RunID == incoming.RunID &&
		existing.BatchID == incoming.BatchID &&
		existingKey != "" &&
		existingKey == incomingKey
}

func (s *Service) RpcUpdateRun(ctx context.Context, req *rgrpc.UpdateRunRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	const op = "RpcUpdateRun"
	row, _, err := runRowFromJSON(req.GetRunJson())
	if err != nil {
		return nil, translateError(op, err)
	}
	row.UpdatedAt = nowMS()
	updates := runUpdateMap(row)
	if shouldClearResultForRunUpdate(row.Status) {
		updates[columnResultJSON] = nil
	}
	query := s.db.WithContext(ctx).
		Model(&taskRuntimeRunRow{}).
		Where(columnRunID+" = ?", row.RunID)
	query = protectTerminalStatus(query, columnStatus, row.Status, terminalRunStatuses())
	if err := query.Updates(updates).Error; err != nil {
		return nil, translateError(op, err)
	}
	return emptyOK(), nil
}

// RpcReopenRunForRetry re-queues a run that already settled into a retryable
// terminal status (failed / timed_out / blocked) so the scheduler can run
// another attempt. Production persistence keeps terminal runs immutable (see
// protectTerminalStatus / ensureClaimable) so a stale worker can never
// resurrect a settled run; a legitimate retry is the one exception, so it gets
// a dedicated, compare-and-set-guarded entry point instead of relaxing that
// invariant for every writer. The transaction locks the row, asserts it is
// still in a retryable terminal status at the caller's expected_attempt (so a
// duplicate or stale reopen cannot fire twice), then writes the caller-provided
// next-attempt payload and drops the now-stale terminal result.
func (s *Service) RpcReopenRunForRetry(
	ctx context.Context, req *rgrpc.ReopenRunForRetryRequest,
) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	const op = "RpcReopenRunForRetry"
	row, _, err := runRowFromJSON(req.GetRunJson())
	if err != nil {
		return nil, translateError(op, err)
	}
	err = s.runTransaction(ctx, func(tx *gorm.DB) error {
		existing, lockErr := findRun(tx, row.RunID, true)
		if lockErr != nil {
			return lockErr
		}
		if reopenErr := ensureReopenable(existing, int(req.GetExpectedAttempt())); reopenErr != nil {
			return reopenErr
		}
		if payloadErr := ensureReopenPayload(existing, row, int(req.GetExpectedAttempt())); payloadErr != nil {
			return payloadErr
		}
		updates := runUpdateMap(row)
		// The reopened run is queued again, so neither the prior attempt's
		// terminal result nor its last progress line may linger — task detail,
		// finalization, and recovery views read them back.
		updates[columnResultJSON] = nil
		updates[columnLatestProgressMessage] = ""
		updates[columnLatestProgressAt] = 0
		return tx.Model(&taskRuntimeRunRow{}).Where(columnRunID+" = ?", row.RunID).Updates(updates).Error
	})
	if err != nil {
		return nil, translateError(op, err)
	}
	return emptyOK(), nil
}

func (s *Service) RpcLookupIdempotent(ctx context.Context, req *rgrpc.LookupIdempotentRequest) (*rgrpc.GetRunResponse, error) {
	key := strings.TrimSpace(req.GetIdempotencyKey())
	if key == "" {
		// Treat empty as "no match" instead of returning the oldest run with no key.
		// Callers that genuinely want a fresh run must omit lookup; we never match on "".
		return &rgrpc.GetRunResponse{Found: false, Code: 0, Msg: responseSuccess}, nil
	}
	var row taskRuntimeRunRow
	err := s.db.WithContext(ctx).
		Where(columnIdempotencyKey+" = ?", key).
		Order(columnId + " DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &rgrpc.GetRunResponse{Found: false, Code: 0, Msg: responseSuccess}, nil
	}
	if err != nil {
		return nil, internalError("RpcLookupIdempotent", err)
	}
	return &rgrpc.GetRunResponse{RunJson: canonicalRunJSON(row), Found: true, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcClaimRun(ctx context.Context, req *rgrpc.ClaimRunRequest) (*rgrpc.ClaimRunResponse, error) {
	const op = "RpcClaimRun"
	var tokenJSON string
	err := s.runTransaction(ctx, func(tx *gorm.DB) error {
		row, runJSON, err := lockRun(tx, strings.TrimSpace(req.GetRunId()))
		if err != nil {
			return err
		}
		if err := ensureClaimable(row); err != nil {
			return err
		}
		now := nowMS()
		token := strings.ReplaceAll(uuid.NewString(), "-", "")
		putValue(runJSON, jsonKeyWorkerID, strings.TrimSpace(req.GetWorkerId()))
		putValue(runJSON, jsonKeyFencingToken, token)
		putValue(runJSON, jsonKeyStatus, statusRunning)
		if getUint64(runJSON, jsonKeyStartedAt) == 0 {
			putValue(runJSON, jsonKeyStartedAt, now)
		}
		if err := updateRunPayload(tx, row, runJSON); err != nil {
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
		return nil, translateError(op, err)
	}
	return &rgrpc.ClaimRunResponse{TokenJson: tokenJSON, Code: 0, Msg: responseSuccess}, nil
}

// RpcHeartbeatBatch refreshes a batch's owner-liveness signal in a single
// non-locking UPDATE on the batch row. While the owning core process is alive it
// bumps `liveness_at`; the sweeper gates every still-active run in the batch on
// this one signal (see RpcSweepStaleRuns), so a batch with many queued runs costs
// exactly one write per interval instead of one per queued run. Once the owning
// process dies the heartbeat freezes and the sweeper reclaims the batch's runs
// after the normal threshold. Only QUEUED/RUNNING batches are touched — a batch
// that already reached a terminal status is never resurrected. The backend stamps
// its own clock while the sweeper's beforeTs is computed on core's clock; a fresh
// heartbeat therefore stays clear of the sweep threshold by the full stale margin
// unless the backend clock trails core's by more than that margin — a gap
// NTP-synced clocks never reach in practice.
func (s *Service) RpcHeartbeatBatch(
	ctx context.Context,
	req *rgrpc.HeartbeatBatchRequest,
) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	const op = "RpcHeartbeatBatch"
	batchID := strings.TrimSpace(req.GetBatchId())
	if batchID == "" {
		return nil, translateError(op, fmt.Errorf("batch_id is required"))
	}
	now := nowMS()
	err := s.db.WithContext(ctx).
		Model(&taskRuntimeBatchRow{}).
		Where(columnBatchID+" = ?", batchID).
		Where(columnStatus+" IN ?", []string{statusQueued, statusRunning}).
		Updates(map[string]any{columnLivenessAt: now, columnUpdatedAt: now}).Error
	if err != nil {
		return nil, translateError(op, err)
	}
	return emptyOK(), nil
}

// RpcSetRunProgress writes the latest run progress message as a single UPDATE on
// `latest_progress_message`/`latest_progress_at`. It deliberately avoids the run
// row lock that claim/heartbeat/write_result take, so high-frequency progress
// updates from executors cannot block (or be blocked by) those control RPCs.
// Out-of-order writes (ts <= existing) are silently dropped via the WHERE clause.
func (s *Service) RpcSetRunProgress(
	ctx context.Context,
	req *rgrpc.SetRunProgressRequest,
) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	const op = "RpcSetRunProgress"
	runID := strings.TrimSpace(req.GetRunId())
	if runID == "" {
		return nil, translateError(op, fmt.Errorf("run_id is required"))
	}
	ts := uint64(req.GetTs())
	if ts == 0 {
		ts = nowMS()
	}
	updates := map[string]any{
		columnLatestProgressMessage: truncateProgressMessage(req.GetMessage()),
		columnLatestProgressAt:      ts,
		columnUpdatedAt:             nowMS(),
	}
	err := s.db.WithContext(ctx).
		Model(&taskRuntimeRunRow{}).
		Where(columnRunID+" = ?", runID).
		Where(columnLatestProgressAt+" <= ?", ts).
		Updates(updates).Error
	if err != nil {
		return nil, translateError(op, err)
	}
	return emptyOK(), nil
}

func (s *Service) RpcWriteResult(ctx context.Context, req *rgrpc.WriteResultRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	err := s.runTransaction(ctx, func(tx *gorm.DB) error {
		row, runJSON, err := lockRun(tx, strings.TrimSpace(req.GetRunId()))
		if err != nil {
			return err
		}
		if err := ensureToken(row, req.GetTokenJson()); err != nil {
			return err
		}
		resultJSON, err := decodeJSONValue[taskRuntimeResultPayload](req.GetResultJson(), labelResultJSON)
		if err != nil {
			return err
		}
		now := nowMS()
		putValue(runJSON, jsonKeyStatus, resultJSON.Status)
		if resultJSON.EndedAt != nil {
			putValue(runJSON, jsonKeyEndedAt, *resultJSON.EndedAt)
		}
		if getUint64(runJSON, jsonKeyEndedAt) == 0 {
			putValue(runJSON, jsonKeyEndedAt, now)
		}
		putValue(runJSON, jsonKeyLastErrorClass, resultJSON.ErrorClass)
		putValue(runJSON, jsonKeyLastError, resultJSON.ErrorMessage)
		if err := updateRunPayload(tx, row, runJSON); err != nil {
			return err
		}
		updates := map[string]any{columnResultJSON: jsonBytes(compactJSON(req.GetResultJson())), columnUpdatedAt: now}
		return tx.Model(&taskRuntimeRunRow{}).Where(columnRunID+" = ?", row.RunID).Updates(updates).Error
	})
	if err != nil {
		return nil, translateError("RpcWriteResult", err)
	}
	return emptyOK(), nil
}

func (s *Service) RpcCancelBatch(ctx context.Context, req *rgrpc.CancelBatchRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	err := s.runTransaction(ctx, func(tx *gorm.DB) error {
		var batch taskRuntimeBatchRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(columnBatchID+" = ?", req.GetBatchId()).
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
		putValue(batchJSON, jsonKeyCancellationReason, req.GetReason())
		putValue(batchJSON, jsonKeyEndedAt, now)
		batch.Status = statusCancelled
		batch.CancellationReason = req.GetReason()
		batch.EndedAt = &now
		batch.UpdatedAt = now
		batch.BatchJSON = marshalJSON(batchJSON)
		if err := tx.Save(&batch).Error; err != nil {
			return err
		}
		var runs []taskRuntimeRunRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(columnBatchID+" = ?", batch.BatchID).
			Find(&runs).Error; err != nil {
			return err
		}
		for i := range runs {
			if err := cancelRunRowTx(tx, &runs[i], req.GetReason(), now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, translateError("RpcCancelBatch", err)
	}
	return emptyOK(), nil
}

func (s *Service) RpcCancelRun(ctx context.Context, req *rgrpc.CancelRunRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	err := s.runTransaction(ctx, func(tx *gorm.DB) error {
		row, err := findRun(tx, strings.TrimSpace(req.GetRunId()), true)
		if err != nil {
			return err
		}
		return cancelRunRowTx(tx, row, req.GetReason(), nowMS())
	})
	if err != nil {
		return nil, translateError("RpcCancelRun", err)
	}
	return emptyOK(), nil
}

func (s *Service) RpcGetRun(ctx context.Context, req *rgrpc.GetRunRequest) (*rgrpc.GetRunResponse, error) {
	row, err := findRun(s.db.WithContext(ctx), strings.TrimSpace(req.GetRunId()), false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &rgrpc.GetRunResponse{Found: false, Code: 0, Msg: responseSuccess}, nil
	}
	if err != nil {
		return nil, internalError("RpcGetRun", err)
	}
	return &rgrpc.GetRunResponse{RunJson: canonicalRunJSON(*row), Found: true, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcGetTaskDetail(ctx context.Context, req *rgrpc.GetTaskDetailRequest) (*rgrpc.GetTaskDetailResponse, error) {
	row, err := findRun(s.db.WithContext(ctx), strings.TrimSpace(req.GetRunId()), false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &rgrpc.GetTaskDetailResponse{Found: false, Code: 0, Msg: responseSuccess}, nil
	}
	if err != nil {
		return nil, internalError("RpcGetTaskDetail", err)
	}
	resultJSON := string(row.ResultJSON)
	content, artifactsJSON := s.detailContent(ctx, row, strings.TrimSpace(req.GetView()))
	return &rgrpc.GetTaskDetailResponse{
		RunJson:       canonicalRunJSON(*row),
		ResultJson:    resultJSON,
		View:          req.GetView(),
		Content:       content,
		ArtifactsJson: artifactsJSON,
		Found:         true,
		Code:          0,
		Msg:           responseSuccess,
	}, nil
}

func (s *Service) RpcListBatchRuns(ctx context.Context, req *rgrpc.ListBatchRunsRequest) (*rgrpc.ListBatchRunsResponse, error) {
	var rows []taskRuntimeRunRow
	if err := s.db.WithContext(ctx).
		Where(columnBatchID+" = ?", strings.TrimSpace(req.GetBatchId())).
		Order(columnBatchItemIndex + " ASC, " + columnId + " ASC").
		Find(&rows).Error; err != nil {
		return nil, internalError("RpcListBatchRuns", err)
	}
	runsJSON := make([]string, 0, len(rows))
	for _, row := range rows {
		runsJSON = append(runsJSON, canonicalRunJSON(row))
	}
	return &rgrpc.ListBatchRunsResponse{RunsJson: runsJSON, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcListBatchesByTurn(
	ctx context.Context,
	req *rgrpc.ListBatchesByTurnRequest,
) (*rgrpc.ListBatchesByTurnResponse, error) {
	query := s.db.WithContext(ctx).
		Where(columnParentConversationID+" = ?", req.GetParentConversationId()).
		Where(columnParentTurnID+" = ?", req.GetParentTurnId())
	if req.GetActiveOnly() {
		query = query.Where(columnStatus+" IN ?", []string{statusQueued, statusRunning})
	}

	var rows []taskRuntimeBatchRow
	if err := query.Order(columnId + " ASC").Find(&rows).Error; err != nil {
		return nil, internalError("RpcListBatchesByTurn", err)
	}
	batchesJSON := make([]string, 0, len(rows))
	for _, row := range rows {
		batchesJSON = append(batchesJSON, canonicalBatchJSON(row))
	}
	return &rgrpc.ListBatchesByTurnResponse{BatchesJson: batchesJSON, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcSweepStaleRuns(
	ctx context.Context,
	req *rgrpc.SweepStaleRunsRequest,
) (*rgrpc.SweepStaleRunsResponse, error) {
	// A run is stale when the batch that owns it has gone silent. Batch-level
	// owner liveness is the *single* staleness signal: the owning core process
	// bumps one signal every interval (RpcHeartbeatBatch → liveness_at); while it
	// is alive no run in the batch — queued or running — is reclaimed, and once it
	// dies the signal freezes and every still-active run becomes reclaimable
	// together. Per-run heartbeats no longer exist; a genuinely hung RUNNING worker
	// on a still-live process is bounded by its own execution timeout, not by this
	// sweep. The predicate reads the owning batch's liveness_at and only falls back
	// to the run's own creation timestamps (started_at/queued_at) as a last-resort
	// backstop for an orphaned run whose batch row is somehow missing.
	stale := []string{}
	now := nowMS()
	err := s.runTransaction(ctx, func(tx *gorm.DB) error {
		var rows []taskRuntimeRunRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				columnStatus+" IN ? AND "+
					"COALESCE("+
					"(SELECT b."+columnLivenessAt+" FROM t_task_runtime_batch AS b "+
					"WHERE b."+columnBatchID+" = t_task_runtime_run."+columnBatchID+"), "+
					columnStartedAt+", "+columnQueuedAt+") < ?",
				[]string{statusQueued, statusRunning},
				req.GetBeforeTs(),
			).
			Order(columnId + " ASC").
			Find(&rows).Error; err != nil {
			return err
		}
		stale = make([]string, 0, len(rows))
		affectedBatchIDs := map[string]bool{}
		for i := range rows {
			stale = append(stale, staleRunJSON(rows[i]))
			affectedBatchIDs[rows[i].BatchID] = true
			if err := failStaleRunTx(tx, &rows[i], now); err != nil {
				return err
			}
		}

		staleBatchMarkers, err := staleBatchMarkersTx(tx, req.GetBeforeTs(), affectedBatchIDs)
		if err != nil {
			return err
		}
		stale = append(stale, staleBatchMarkers...)

		recoveryBatchMarkers, err := recoveredMessageMissingBatchMarkersTx(tx, req.GetBeforeTs(), affectedBatchIDs)
		if err != nil {
			return err
		}
		stale = append(stale, recoveryBatchMarkers...)

		return nil
	})
	if err != nil {
		return nil, internalError("RpcSweepStaleRuns", err)
	}
	return &rgrpc.SweepStaleRunsResponse{StaleRunsJson: stale, Code: 0, Msg: responseSuccess}, nil
}

func terminalBatchStatuses() []string {
	return []string{statusCompleted, statusPartial, statusFailed, statusCancelled, statusTimedOut, statusBlocked}
}

func isActiveBatchStatus(status string) bool {
	return status == statusQueued || status == statusRunning
}

func terminalRunStatuses() []string {
	return []string{statusCompleted, statusFailed, statusCancelled, statusTimedOut, statusBlocked}
}

func protectTerminalStatus(query *gorm.DB, column string, incomingStatus string, terminalStatuses []string) *gorm.DB {
	if containsStatus(terminalStatuses, incomingStatus) {
		return query.Where("("+column+" NOT IN ? OR "+column+" = ?)", terminalStatuses, incomingStatus)
	}
	return query.Where(column+" NOT IN ?", terminalStatuses)
}

func containsStatus(statuses []string, status string) bool {
	for _, terminalStatus := range statuses {
		if status == terminalStatus {
			return true
		}
	}
	return false
}

func recoveredMessageMissingBatchMarkersTx(tx *gorm.DB, beforeTs int64, seen map[string]bool) ([]string, error) {
	if beforeTs <= 0 {
		return nil, nil
	}
	if seen == nil {
		seen = map[string]bool{}
	}

	const staleWorkerID = "task-runtime-sweeper"
	var batches []taskRuntimeBatchRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(columnStatus+" IN ?", terminalBatchStatuses()).
		Where(columnParentConversationID+" <> 0").
		Where(columnParentTurnID+" <> 0").
		Where(columnParentToolCallID+" IS NOT NULL").
		Where("COALESCE("+columnEndedAt+", "+columnUpdatedAt+", "+columnCreatedAt+") < ?", uint64(beforeTs)).
		Where(
			"EXISTS (SELECT 1 FROM t_task_runtime_run AS r "+
				"WHERE r.batch_id = t_task_runtime_batch.batch_id AND r.worker_id = ?)",
			staleWorkerID,
		).
		Where(
			"NOT EXISTS (SELECT 1 FROM t_message AS m "+
				"WHERE m.conversation_id = t_task_runtime_batch.parent_conversation_id "+
				"AND m.turn_id = t_task_runtime_batch.parent_turn_id "+
				"AND m.task_runtime_recovery_key = CONCAT(?, t_task_runtime_batch.batch_id))",
			taskRuntimeRecoveryResultPrefix,
		).
		Order(columnId + " ASC").
		Find(&batches).Error; err != nil {
		return nil, err
	}

	markers := make([]string, 0, len(batches))
	for _, batch := range batches {
		if batch.BatchID == "" || seen[batch.BatchID] {
			continue
		}
		seen[batch.BatchID] = true
		markers = append(markers, staleBatchJSON(batch))
	}

	return markers, nil
}

func staleBatchMarkersTx(tx *gorm.DB, beforeTs int64, seen map[string]bool) ([]string, error) {
	if beforeTs <= 0 {
		return nil, nil
	}
	if seen == nil {
		seen = map[string]bool{}
	}
	var batches []taskRuntimeBatchRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(columnStatus+" IN ?", []string{statusQueued, statusRunning}).
		Where("COALESCE("+columnLivenessAt+", "+columnCreatedAt+") < ?", uint64(beforeTs)).
		Where(
			"NOT EXISTS (SELECT 1 FROM t_task_runtime_run AS r "+
				"WHERE r.batch_id = t_task_runtime_batch.batch_id AND r.status IN ?)",
			[]string{statusQueued, statusRunning},
		).
		Order(columnId + " ASC").
		Find(&batches).Error; err != nil {
		return nil, err
	}
	markers := make([]string, 0, len(batches))
	for _, batch := range batches {
		if batch.BatchID == "" || seen[batch.BatchID] {
			continue
		}
		seen[batch.BatchID] = true
		markers = append(markers, staleBatchJSON(batch))
	}
	return markers, nil
}

func (s *Service) detailContent(_ context.Context, row *taskRuntimeRunRow, view string) (string, string) {
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

func emptyOK() *rgrpc.EmptyTaskRuntimeResponse {
	return &rgrpc.EmptyTaskRuntimeResponse{Code: 0, Msg: responseSuccess}
}

func findRun(db *gorm.DB, runID string, lock bool) (*taskRuntimeRunRow, error) {
	var row taskRuntimeRunRow
	query := db.Where(columnRunID+" = ?", runID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func lockRun(tx *gorm.DB, runID string) (*taskRuntimeRunRow, jsonMap, error) {
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

func updateRunPayload(tx *gorm.DB, row *taskRuntimeRunRow, payload jsonMap) error {
	now := nowMS()
	updated := marshalJSON(payload)
	row.Status = getString(payload, jsonKeyStatus)
	row.Attempt = getInt(payload, jsonKeyAttempt)
	row.WorkerID = getString(payload, jsonKeyWorkerID)
	row.FencingToken = getString(payload, jsonKeyFencingToken)
	row.StartedAt = getOptionalUint64(payload, jsonKeyStartedAt)
	row.EndedAt = getOptionalUint64(payload, jsonKeyEndedAt)
	row.LastErrorClass = getString(payload, jsonKeyLastErrorClass)
	row.LastError = getString(payload, jsonKeyLastError)
	row.RunJSON = updated
	row.UpdatedAt = now
	return tx.Model(&taskRuntimeRunRow{}).Where(columnRunID+" = ?", row.RunID).Updates(runUpdateMap(row)).Error
}

func ensureToken(row *taskRuntimeRunRow, tokenPayload string) error {
	tokenJSON, err := decodeJSONValue[fencingTokenPayload](tokenPayload, labelTokenJSON)
	if err != nil {
		return err
	}
	if row.FencingToken == "" || row.FencingToken != tokenJSON.Token {
		return fmt.Errorf("%w: run %s", errStaleToken, row.RunID)
	}
	return nil
}

func ensureClaimable(row *taskRuntimeRunRow) error {
	if row.Status == statusQueued {
		return nil
	}
	return fmt.Errorf("%w: run %s is %s and cannot be claimed", errStaleToken, row.RunID, row.Status)
}

// retryableTerminalRunStatuses lists the terminal run statuses a run may be
// reopened from for another attempt. COMPLETED and CANCELLED are deliberately
// excluded — a recorded success or user cancellation is absorbing and must
// never be re-run.
func retryableTerminalRunStatuses() []string {
	return []string{statusFailed, statusTimedOut, statusBlocked}
}

// ensureReopenable is the compare-and-set guard for RpcReopenRunForRetry: the
// locked row must still be in a retryable terminal status AND hold exactly the
// attempt the caller observed, so two concurrent (or stale) reopen requests can
// never bump the same run twice.
func ensureReopenable(row *taskRuntimeRunRow, expectedAttempt int) error {
	if !containsStatus(retryableTerminalRunStatuses(), row.Status) {
		return fmt.Errorf("%w: run %s is %s and cannot be reopened for retry", errStaleToken, row.RunID, row.Status)
	}
	if row.Attempt != expectedAttempt {
		return fmt.Errorf("%w: run %s attempt %d does not match expected %d",
			errStaleToken, row.RunID, row.Attempt, expectedAttempt)
	}
	return nil
}

// ensureReopenPayload defends the reopen entry point against a caller payload
// that would change run identity or break the queued/attempt contract. The only
// fields a reopen may legitimately change are run state (status, attempt,
// last_error); identity, idempotency, and batch placement are invariant across
// attempts of the same run, and a fresh queued attempt must carry no leftover
// worker/fencing/timestamps. Violations surface as errStaleToken so a malformed
// reopen degrades to "not reopened" (the prior terminal result is preserved)
// rather than corrupting the row.
func ensureReopenPayload(existing, incoming *taskRuntimeRunRow, expectedAttempt int) error {
	if incoming.Status != statusQueued {
		return fmt.Errorf(
			"%w: reopen payload for run %s must be queued, got %s",
			errStaleToken, existing.RunID, incoming.Status,
		)
	}
	if incoming.Attempt != expectedAttempt+1 {
		return fmt.Errorf(
			"%w: reopen payload for run %s must advance attempt to %d, got %d",
			errStaleToken, existing.RunID, expectedAttempt+1, incoming.Attempt,
		)
	}
	if incoming.WorkerID != "" || incoming.FencingToken != "" || incoming.StartedAt != nil || incoming.EndedAt != nil {
		return fmt.Errorf(
			"%w: reopen payload for run %s must clear worker/fencing/timestamps",
			errStaleToken, existing.RunID)
	}
	if incoming.BatchID != existing.BatchID ||
		incoming.IdempotencyKey != existing.IdempotencyKey ||
		incoming.BatchItemIndex != existing.BatchItemIndex ||
		incoming.TaskID != existing.TaskID ||
		incoming.ParentConversationID != existing.ParentConversationID ||
		incoming.ParentTurnID != existing.ParentTurnID {
		return fmt.Errorf("%w: reopen payload for run %s must not change identity fields", errStaleToken, existing.RunID)
	}
	return nil
}

func shouldClearResultForRunUpdate(status string) bool {
	return status == statusQueued || status == statusRunning
}

func clearResultForNonTerminalRun(tx *gorm.DB, row *taskRuntimeRunRow) error {
	if !shouldClearResultForRunUpdate(row.Status) {
		return nil
	}
	return tx.Model(&taskRuntimeRunRow{}).
		Where(columnRunID+" = ?", row.RunID).
		Update(columnResultJSON, nil).Error
}

func cancelRunRowTx(tx *gorm.DB, row *taskRuntimeRunRow, reason string, now uint64) error {
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
	return updateRunPayload(tx, row, runJSON)
}

func failStaleRunTx(tx *gorm.DB, row *taskRuntimeRunRow, now uint64) error {
	if row.Status != statusRunning && row.Status != statusQueued {
		return nil
	}
	const staleWorkerID = "task-runtime-sweeper"
	staleStatus := statusFailed
	staleMessage := "Task worker heartbeat became stale."
	if row.Status == statusQueued {
		staleStatus = statusBlocked
		staleMessage = "Task runtime stopped tracking this queued run before it was claimed."
	}
	runJSON, err := decodeJSONMap(string(row.RunJSON), labelRunJSON)
	if err != nil {
		return err
	}
	canonicalizeRunPayload(row, runJSON)
	putValue(runJSON, jsonKeyStatus, staleStatus)
	putValue(runJSON, jsonKeyWorkerID, staleWorkerID)
	putValue(runJSON, jsonKeyFencingToken, "")
	putValue(runJSON, jsonKeyEndedAt, now)
	putValue(runJSON, jsonKeyLastErrorClass, "internal")
	putValue(runJSON, jsonKeyLastError, staleMessage)
	if err := updateRunPayload(tx, row, runJSON); err != nil {
		return err
	}
	resultPayload := map[string]any{
		"run_id":        row.RunID,
		"task_id":       row.TaskID,
		"status":        staleStatus,
		"title":         row.TaskID,
		"summary":       staleMessage,
		"error_class":   "internal",
		"error_message": staleMessage,
		"ended_at":      now,
	}
	startedAt := staleRunStartedAt(row, now)
	resultPayload["started_at"] = startedAt
	if duration, ok := staleRunDuration(row, now); ok {
		resultPayload["duration_ms"] = duration
	}
	updates := map[string]any{columnResultJSON: marshalJSON(resultPayload), columnUpdatedAt: now}
	return tx.Model(&taskRuntimeRunRow{}).Where(columnRunID+" = ?", row.RunID).Updates(updates).Error
}

func staleRunStartedAt(row *taskRuntimeRunRow, now uint64) uint64 {
	if row != nil && row.StartedAt != nil && *row.StartedAt > 0 && *row.StartedAt <= now {
		return *row.StartedAt
	}
	if row != nil && row.QueuedAt > 0 && row.QueuedAt <= now {
		return row.QueuedAt
	}
	return now
}

func staleRunDuration(row *taskRuntimeRunRow, now uint64) (uint64, bool) {
	if row == nil || row.StartedAt == nil || *row.StartedAt == 0 || *row.StartedAt > now {
		return 0, false
	}
	return now - *row.StartedAt, true
}

func jsonOrNull(value datatypes.JSON) string {
	if len(value) == 0 {
		return ""
	}
	return string(value)
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
