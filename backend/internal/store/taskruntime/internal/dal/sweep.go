package dal

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const staleSweeperWorkerID = "task-runtime-sweeper"

// SweepStaleRuns reclaims runs whose owning batch has gone silent and returns a
// stale marker JSON document per reclaimed run (and per batch that needs
// finalization or recovery follow-up).
//
// A run is stale when the batch that owns it has gone silent. Batch-level owner
// liveness is the *single* staleness signal: the owning core process bumps one
// signal every interval (HeartbeatBatch → liveness_at); while it is alive no run
// in the batch — queued or running — is reclaimed, and once it dies the signal
// freezes and every still-active run becomes reclaimable together. Per-run
// heartbeats no longer exist; a genuinely hung RUNNING worker on a still-live
// process is bounded by its own execution timeout, not by this sweep. The
// predicate reads the owning batch's liveness_at and only falls back to the
// run's own creation timestamps (started_at/queued_at) as a last-resort backstop
// for an orphaned run whose batch row is somehow missing.
func (d *TaskRuntimeDAO) SweepStaleRuns(ctx context.Context, beforeTs int64) ([]string, error) {
	stale := []string{}
	now := nowMS()

	err := d.runTransaction(ctx, func(tx *gorm.DB) error {
		var rows []runRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				columnStatus+" IN ? AND "+
					"COALESCE("+
					"(SELECT b."+columnLivenessAt+" FROM t_task_runtime_batch AS b "+
					"WHERE b."+columnBatchID+" = t_task_runtime_run."+columnBatchID+"), "+
					columnStartedAt+", "+columnQueuedAt+") < ?",
				[]string{statusQueued, statusRunning},
				beforeTs,
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

		staleBatchMarkers, err := staleBatchMarkersTx(tx, beforeTs, affectedBatchIDs)
		if err != nil {
			return err
		}
		stale = append(stale, staleBatchMarkers...)

		recoveryBatchMarkers, err := recoveredMessageMissingBatchMarkersTx(tx, beforeTs, affectedBatchIDs)
		if err != nil {
			return err
		}
		stale = append(stale, recoveryBatchMarkers...)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return stale, nil
}

func recoveredMessageMissingBatchMarkersTx(tx *gorm.DB, beforeTs int64, seen map[string]bool) ([]string, error) {
	if beforeTs <= 0 {
		return nil, nil
	}
	if seen == nil {
		seen = map[string]bool{}
	}

	var batches []batchRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(columnStatus+" IN ?", terminalBatchStatuses()).
		Where(columnParentConversationID+" <> 0").
		Where(columnParentTurnID+" <> 0").
		Where(columnParentToolCallID+" IS NOT NULL").
		Where("COALESCE("+columnEndedAt+", "+columnUpdatedAt+", "+columnCreatedAt+") < ?", beforeTs).
		Where(
			"EXISTS (SELECT 1 FROM t_task_runtime_run AS r "+
				"WHERE r.batch_id = t_task_runtime_batch.batch_id AND r.worker_id = ?)",
			staleSweeperWorkerID,
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

	var batches []batchRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(columnStatus+" IN ?", []string{statusQueued, statusRunning}).
		Where("COALESCE("+columnLivenessAt+", "+columnCreatedAt+") < ?", beforeTs).
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

func failStaleRunTx(tx *gorm.DB, row *runRow, now int64) error {
	if row.Status != statusRunning && row.Status != statusQueued {
		return nil
	}

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
	putValue(runJSON, jsonKeyWorkerID, staleSweeperWorkerID)
	putValue(runJSON, jsonKeyFencingToken, "")
	putValue(runJSON, jsonKeyEndedAt, now)
	putValue(runJSON, jsonKeyLastErrorClass, "internal")
	putValue(runJSON, jsonKeyLastError, staleMessage)
	if err := updateRunPayload(tx, row, runJSON, now); err != nil {
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
	return tx.Model(&runRow{}).Where(columnRunID+" = ?", row.RunID).UpdateColumns(updates).Error
}

func staleRunStartedAt(row *runRow, now int64) int64 {
	if row != nil && row.StartedAt != nil && *row.StartedAt > 0 && *row.StartedAt <= now {
		return *row.StartedAt
	}

	if row != nil && row.QueuedAt > 0 && row.QueuedAt <= now {
		return row.QueuedAt
	}

	return now
}

func staleRunDuration(row *runRow, now int64) (int64, bool) {
	if row == nil || row.StartedAt == nil || *row.StartedAt == 0 || *row.StartedAt > now {
		return 0, false
	}

	return now - *row.StartedAt, true
}
