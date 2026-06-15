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

package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/taskruntime/internal/dal"
)

// TaskDetail is the read model returned by GetTaskDetail.
type TaskDetail = dal.TaskDetail

// Error sentinels surfaced by the repository. The transport layer maps these to
// gRPC status codes (FailedPrecondition / AlreadyExists respectively).
var (
	ErrStaleToken = dal.ErrStaleToken
	ErrDuplicate  = dal.ErrDuplicate
)

// IsStaleToken reports whether err is rooted in a stale-fencing-token condition.
func IsStaleToken(err error) bool { return dal.IsStaleToken(err) }

// IsDuplicateKey reports whether err is a raw MySQL duplicate-key violation.
func IsDuplicateKey(err error) bool { return dal.IsDuplicateKey(err) }

// TaskRuntimeRepository is the persistence contract for the task runtime. It
// speaks the JSON document contract Core sends over reverse gRPC: batch and run
// payloads travel as JSON strings, and the repository owns the projection of
// those documents into the indexed columns plus the fencing / compare-and-set
// guards and the stale-run sweep.
type TaskRuntimeRepository interface {
	CreateBatch(ctx context.Context, batchJSON string) error
	UpdateBatch(ctx context.Context, batchJSON string) error
	GetBatch(ctx context.Context, batchID string) (batchJSON string, found bool, err error)

	CreateRun(ctx context.Context, runJSON string) error
	UpdateRun(ctx context.Context, runJSON string) error
	ReopenRunForRetry(ctx context.Context, runJSON string, expectedAttempt int32) error
	LookupIdempotent(ctx context.Context, idempotencyKey string) (runJSON string, found bool, err error)
	GetRun(ctx context.Context, runID string) (runJSON string, found bool, err error)
	GetTaskDetail(ctx context.Context, runID, view string) (detail TaskDetail, found bool, err error)
	ListBatchRuns(ctx context.Context, batchID string) (runsJSON []string, err error)
	ListBatchesByTurn(
		ctx context.Context,
		parentConversationID, parentTurnID int64,
		activeOnly bool,
	) (batchesJSON []string, err error)

	ClaimRun(ctx context.Context, runID, workerID string) (tokenJSON string, err error)
	HeartbeatBatch(ctx context.Context, batchID string) error
	SetRunProgress(ctx context.Context, runID, message string, ts int64) error
	WriteResult(ctx context.Context, runID, tokenJSON, resultJSON string) error
	CancelBatch(ctx context.Context, batchID, reason string) error
	CancelRun(ctx context.Context, runID, reason string) error
	SweepStaleRuns(ctx context.Context, beforeTs int64) (staleRunsJSON []string, err error)
}

// NewTaskRuntimeRepo returns the task runtime persistence layer backed by the
// generated DAL.
func NewTaskRuntimeRepo(db *gorm.DB) TaskRuntimeRepository {
	return dal.NewTaskRuntimeDAO(db)
}
