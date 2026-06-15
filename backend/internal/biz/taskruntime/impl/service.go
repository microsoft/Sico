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

// Package impl is the reverse-gRPC transport adapter for the task runtime. It
// decodes the JSON document payloads Core sends, delegates persistence to the
// store-layer repository, and translates repository errors into gRPC status
// codes. All database access lives in internal/store/taskruntime.
package impl

import (
	"context"

	taskruntimerepo "sico-backend/internal/store/taskruntime/repository"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/taskruntime"
)

// Service implements the reverse task-runtime gRPC server on top of the
// task-runtime persistence repository.
type Service struct {
	rgrpc.UnimplementedReverseTaskRuntimeRPCServer
	repo taskruntimerepo.TaskRuntimeRepository
}

// NewService builds the reverse task-runtime service over the given repository.
func NewService(repo taskruntimerepo.TaskRuntimeRepository) *Service {
	return &Service{repo: repo}
}

func (s *Service) RpcCreateBatch(ctx context.Context, req *rgrpc.CreateBatchRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.CreateBatch(ctx, req.GetBatchJson()); err != nil {
		return nil, translateError("RpcCreateBatch", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcUpdateBatch(ctx context.Context, req *rgrpc.UpdateBatchRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.UpdateBatch(ctx, req.GetBatchJson()); err != nil {
		return nil, translateError("RpcUpdateBatch", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcGetBatch(ctx context.Context, req *rgrpc.GetBatchRequest) (*rgrpc.GetBatchResponse, error) {
	batchJSON, found, err := s.repo.GetBatch(ctx, req.GetBatchId())
	if err != nil {
		return nil, internalError("RpcGetBatch", err)
	}

	return &rgrpc.GetBatchResponse{BatchJson: batchJSON, Found: found, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcCreateRun(ctx context.Context, req *rgrpc.CreateRunRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.CreateRun(ctx, req.GetRunJson()); err != nil {
		return nil, translateError("RpcCreateRun", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcUpdateRun(ctx context.Context, req *rgrpc.UpdateRunRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.UpdateRun(ctx, req.GetRunJson()); err != nil {
		return nil, translateError("RpcUpdateRun", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcReopenRunForRetry(
	ctx context.Context,
	req *rgrpc.ReopenRunForRetryRequest,
) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.ReopenRunForRetry(ctx, req.GetRunJson(), req.GetExpectedAttempt()); err != nil {
		return nil, translateError("RpcReopenRunForRetry", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcLookupIdempotent(ctx context.Context, req *rgrpc.LookupIdempotentRequest) (*rgrpc.GetRunResponse, error) {
	runJSON, found, err := s.repo.LookupIdempotent(ctx, req.GetIdempotencyKey())
	if err != nil {
		return nil, internalError("RpcLookupIdempotent", err)
	}

	return &rgrpc.GetRunResponse{RunJson: runJSON, Found: found, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcClaimRun(ctx context.Context, req *rgrpc.ClaimRunRequest) (*rgrpc.ClaimRunResponse, error) {
	tokenJSON, err := s.repo.ClaimRun(ctx, req.GetRunId(), req.GetWorkerId())
	if err != nil {
		return nil, translateError("RpcClaimRun", err)
	}

	return &rgrpc.ClaimRunResponse{TokenJson: tokenJSON, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcHeartbeatBatch(
	ctx context.Context,
	req *rgrpc.HeartbeatBatchRequest,
) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.HeartbeatBatch(ctx, req.GetBatchId()); err != nil {
		return nil, translateError("RpcHeartbeatBatch", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcSetRunProgress(
	ctx context.Context,
	req *rgrpc.SetRunProgressRequest,
) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.SetRunProgress(ctx, req.GetRunId(), req.GetMessage(), req.GetTs()); err != nil {
		return nil, translateError("RpcSetRunProgress", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcWriteResult(ctx context.Context, req *rgrpc.WriteResultRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.WriteResult(ctx, req.GetRunId(), req.GetTokenJson(), req.GetResultJson()); err != nil {
		return nil, translateError("RpcWriteResult", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcCancelBatch(ctx context.Context, req *rgrpc.CancelBatchRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.CancelBatch(ctx, req.GetBatchId(), req.GetReason()); err != nil {
		return nil, translateError("RpcCancelBatch", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcCancelRun(ctx context.Context, req *rgrpc.CancelRunRequest) (*rgrpc.EmptyTaskRuntimeResponse, error) {
	if err := s.repo.CancelRun(ctx, req.GetRunId(), req.GetReason()); err != nil {
		return nil, translateError("RpcCancelRun", err)
	}

	return emptyOK(), nil
}

func (s *Service) RpcGetRun(ctx context.Context, req *rgrpc.GetRunRequest) (*rgrpc.GetRunResponse, error) {
	runJSON, found, err := s.repo.GetRun(ctx, req.GetRunId())
	if err != nil {
		return nil, internalError("RpcGetRun", err)
	}

	return &rgrpc.GetRunResponse{RunJson: runJSON, Found: found, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcGetTaskDetail(ctx context.Context, req *rgrpc.GetTaskDetailRequest) (*rgrpc.GetTaskDetailResponse, error) {
	detail, found, err := s.repo.GetTaskDetail(ctx, req.GetRunId(), req.GetView())
	if err != nil {
		return nil, internalError("RpcGetTaskDetail", err)
	}

	return &rgrpc.GetTaskDetailResponse{
		RunJson:       detail.RunJSON,
		ResultJson:    detail.ResultJSON,
		View:          req.GetView(),
		Content:       detail.Content,
		ArtifactsJson: detail.ArtifactsJSON,
		Found:         found,
		Code:          0,
		Msg:           responseSuccess,
	}, nil
}

func (s *Service) RpcListBatchRuns(ctx context.Context, req *rgrpc.ListBatchRunsRequest) (*rgrpc.ListBatchRunsResponse, error) {
	runsJSON, err := s.repo.ListBatchRuns(ctx, req.GetBatchId())
	if err != nil {
		return nil, internalError("RpcListBatchRuns", err)
	}

	return &rgrpc.ListBatchRunsResponse{RunsJson: runsJSON, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcListBatchesByTurn(
	ctx context.Context,
	req *rgrpc.ListBatchesByTurnRequest,
) (*rgrpc.ListBatchesByTurnResponse, error) {
	batchesJSON, err := s.repo.ListBatchesByTurn(
		ctx,
		req.GetParentConversationId(),
		req.GetParentTurnId(),
		req.GetActiveOnly(),
	)
	if err != nil {
		return nil, internalError("RpcListBatchesByTurn", err)
	}

	return &rgrpc.ListBatchesByTurnResponse{BatchesJson: batchesJSON, Code: 0, Msg: responseSuccess}, nil
}

func (s *Service) RpcSweepStaleRuns(
	ctx context.Context,
	req *rgrpc.SweepStaleRunsRequest,
) (*rgrpc.SweepStaleRunsResponse, error) {
	staleRunsJSON, err := s.repo.SweepStaleRuns(ctx, req.GetBeforeTs())
	if err != nil {
		return nil, internalError("RpcSweepStaleRuns", err)
	}

	return &rgrpc.SweepStaleRunsResponse{StaleRunsJson: staleRunsJSON, Code: 0, Msg: responseSuccess}, nil
}

func emptyOK() *rgrpc.EmptyTaskRuntimeResponse {
	return &rgrpc.EmptyTaskRuntimeResponse{Code: 0, Msg: responseSuccess}
}
