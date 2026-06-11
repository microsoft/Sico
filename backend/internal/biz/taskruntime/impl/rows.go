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
	"encoding/json"
	"fmt"
)

func batchRowFromJSON(payload string) (*taskRuntimeBatchRow, jsonMap, error) {
	decoded, err := decodeJSONMap(payload, labelBatchJSON)
	if err != nil {
		return nil, nil, err
	}
	batchPayload, err := decodeJSONValue[taskRuntimeBatchPayload](payload, labelBatchJSON)
	if err != nil {
		return nil, nil, err
	}
	if batchPayload.BatchID == "" {
		return nil, nil, fmt.Errorf("batch_id is required")
	}
	row := &taskRuntimeBatchRow{
		BatchID:              batchPayload.BatchID,
		ParentConversationID: batchPayload.ParentConversationID,
		ParentTurnID:         batchPayload.ParentTurnID,
		ParentToolCallID:     batchPayload.ParentToolCallID,
		Status:               batchPayload.Status,
		Reason:               batchPayload.Reason,
		JoinStrategy:         batchPayload.JoinStrategy,
		TotalCount:           batchPayload.TotalCount,
		CountsJSON:           marshalJSON(batchPayload.Counts),
		BatchJSON:            jsonBytes(compactJSON(payload)),
		CreatedAt:            batchPayload.CreatedAt,
		UpdatedAt:            batchPayload.UpdatedAt,
		EndedAt:              batchPayload.EndedAt,
		CancellationReason:   batchPayload.CancellationReason,
	}
	if row.Status == "" {
		row.Status = statusQueued
	}
	if row.JoinStrategy == "" {
		row.JoinStrategy = joinStrategyPartialOK
	}
	if row.CreatedAt == 0 {
		row.CreatedAt = nowMS()
	}
	if row.UpdatedAt == 0 {
		row.UpdatedAt = row.CreatedAt
	}
	// Seed batch-level owner liveness so a brand-new batch's queued runs are not
	// reclaimable before the owning process emits its first heartbeat. Bumped
	// thereafter by RpcHeartbeatBatch; never carried in batch_json (the core
	// BatchRecord forbids unknown fields), so it stays a backend-only column and
	// batchUpdateMap deliberately omits it so core update_batch never clobbers it.
	liveness := row.CreatedAt
	row.LivenessAt = &liveness
	return row, decoded, nil
}

func runRowFromJSON(payload string) (*taskRuntimeRunRow, jsonMap, error) {
	decoded, err := decodeJSONMap(payload, labelRunJSON)
	if err != nil {
		return nil, nil, err
	}
	runPayload, err := decodeJSONValue[taskRuntimeRunPayload](payload, labelRunJSON)
	if err != nil {
		return nil, nil, err
	}
	if runPayload.RunID == "" || runPayload.BatchID == "" {
		return nil, nil, fmt.Errorf("run_id and batch_id are required")
	}
	row := &taskRuntimeRunRow{
		RunID:                runPayload.RunID,
		BatchID:              runPayload.BatchID,
		ParentConversationID: runPayload.ParentConversationID,
		ParentTurnID:         runPayload.ParentTurnID,
		BatchItemIndex:       runPayload.BatchItemIndex,
		TaskID:               runPayload.Spec.TaskID,
		IdempotencyKey:       runPayload.IdempotencyKey,
		Status:               runPayload.Status,
		Attempt:              runPayload.Attempt,
		Executor:             runPayload.Executor,
		WorkerID:             runPayload.WorkerID,
		FencingToken:         runPayload.FencingToken,
		QueuedAt:             runPayload.QueuedAt,
		StartedAt:            runPayload.StartedAt,
		EndedAt:              runPayload.EndedAt,
		LastErrorClass:       runPayload.LastErrorClass,
		LastError:            runPayload.LastError,
		RunJSON:              jsonBytes(compactJSON(payload)),
		CreatedAt:            nowMS(),
		UpdatedAt:            nowMS(),
	}
	if row.Status == "" {
		row.Status = statusQueued
	}
	if row.Attempt == 0 {
		row.Attempt = 1
	}
	if row.QueuedAt == 0 {
		row.QueuedAt = row.CreatedAt
	}
	return row, decoded, nil
}

func staleRunJSON(row taskRuntimeRunRow) string {
	payload := map[string]any{
		jsonKeyRunID:    row.RunID,
		jsonKeyBatchID:  row.BatchID,
		jsonKeyStatus:   row.Status,
		jsonKeyWorkerID: row.WorkerID,
		jsonKeyQueuedAt: row.QueuedAt,
	}
	return string(marshalJSON(payload))
}

func staleBatchJSON(row taskRuntimeBatchRow) string {
	payload := map[string]any{
		jsonKeyRunID:   "",
		jsonKeyBatchID: row.BatchID,
		jsonKeyStatus:  row.Status,
	}
	return string(marshalJSON(payload))
}

func canonicalRunJSON(row taskRuntimeRunRow) string {
	payload, err := decodeJSONMap(string(row.RunJSON), labelRunJSON)
	if err != nil {
		return string(row.RunJSON)
	}
	canonicalizeRunPayload(&row, payload)
	return string(marshalJSON(payload))
}

func canonicalBatchJSON(row taskRuntimeBatchRow) string {
	payload, err := decodeJSONMap(string(row.BatchJSON), labelBatchJSON)
	if err != nil {
		return string(row.BatchJSON)
	}
	canonicalizeBatchPayload(&row, payload)
	return string(marshalJSON(payload))
}

func canonicalizeBatchPayload(row *taskRuntimeBatchRow, payload jsonMap) {
	putValue(payload, jsonKeyBatchID, row.BatchID)
	putValue(payload, jsonKeyParentConversationID, row.ParentConversationID)
	putValue(payload, jsonKeyParentTurnID, row.ParentTurnID)
	putValue(payload, jsonKeyParentToolCallID, row.ParentToolCallID)
	putValue(payload, jsonKeyStatus, row.Status)
	putValue(payload, jsonKeyReason, row.Reason)
	putValue(payload, jsonKeyJoinStrategy, row.JoinStrategy)
	putValue(payload, jsonKeyTotalCount, row.TotalCount)
	putValue(payload, jsonKeyCounts, decodedCountsJSON(row.CountsJSON))
	putValue(payload, jsonKeyCreatedAt, row.CreatedAt)
	putValue(payload, jsonKeyUpdatedAt, row.UpdatedAt)
	putValue(payload, jsonKeyEndedAt, row.EndedAt)
	putValue(payload, jsonKeyCancellationReason, row.CancellationReason)
}

func decodedCountsJSON(payload []byte) any {
	if len(payload) == 0 {
		return map[string]any{}
	}
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil || decoded == nil {
		return map[string]any{}
	}
	return decoded
}

func canonicalizeRunPayload(row *taskRuntimeRunRow, payload jsonMap) {
	putValue(payload, jsonKeyRunID, row.RunID)
	putValue(payload, jsonKeyBatchID, row.BatchID)
	putValue(payload, jsonKeyParentConversationID, row.ParentConversationID)
	putValue(payload, jsonKeyParentTurnID, row.ParentTurnID)
	putValue(payload, jsonKeyBatchItemIndex, row.BatchItemIndex)
	putValue(payload, jsonKeyIdempotencyKey, row.IdempotencyKey)
	putValue(payload, jsonKeyStatus, row.Status)
	putValue(payload, jsonKeyAttempt, row.Attempt)
	putValue(payload, jsonKeyExecutor, row.Executor)
	putValue(payload, jsonKeyWorkerID, row.WorkerID)
	putValue(payload, jsonKeyFencingToken, row.FencingToken)
	putValue(payload, jsonKeyQueuedAt, row.QueuedAt)
	putValue(payload, jsonKeyStartedAt, row.StartedAt)
	putValue(payload, jsonKeyEndedAt, row.EndedAt)
	putValue(payload, jsonKeyLastErrorClass, row.LastErrorClass)
	putValue(payload, jsonKeyLastError, row.LastError)
	putValue(payload, jsonKeyLatestProgressMessage, row.LatestProgressMessage)
	putValue(payload, jsonKeyLatestProgressAt, row.LatestProgressAt)
}

func batchUpdateMap(row *taskRuntimeBatchRow) map[string]any {
	return map[string]any{
		columnParentConversationID: row.ParentConversationID,
		columnParentTurnID:         row.ParentTurnID,
		columnParentToolCallID:     row.ParentToolCallID,
		columnStatus:               row.Status,
		columnReason:               row.Reason,
		columnJoinStrategy:         row.JoinStrategy,
		columnTotalCount:           row.TotalCount,
		columnCountsJSON:           row.CountsJSON,
		columnBatchJSON:            row.BatchJSON,
		columnUpdatedAt:            row.UpdatedAt,
		columnEndedAt:              row.EndedAt,
		columnCancellationReason:   row.CancellationReason,
	}
}

func runUpdateMap(row *taskRuntimeRunRow) map[string]any {
	return map[string]any{
		columnBatchID:              row.BatchID,
		columnParentConversationID: row.ParentConversationID,
		columnParentTurnID:         row.ParentTurnID,
		columnBatchItemIndex:       row.BatchItemIndex,
		columnTaskID:               row.TaskID,
		columnIdempotencyKey:       row.IdempotencyKey,
		columnStatus:               row.Status,
		columnAttempt:              row.Attempt,
		columnExecutor:             row.Executor,
		columnWorkerID:             row.WorkerID,
		columnFencingToken:         row.FencingToken,
		columnQueuedAt:             row.QueuedAt,
		columnStartedAt:            row.StartedAt,
		columnEndedAt:              row.EndedAt,
		columnLastErrorClass:       row.LastErrorClass,
		columnLastError:            row.LastError,
		columnRunJSON:              row.RunJSON,
		columnUpdatedAt:            nowMS(),
	}
}
