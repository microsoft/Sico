package impl

import (
	"context"
	"testing"

	taskruntimerepo "sico-backend/internal/store/taskruntime/repository"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/taskruntime"
)

type batchMutationRepo struct {
	taskruntimerepo.TaskRuntimeRepository
	batchJSON            string
	created              bool
	applied              bool
	terminalTransitioned bool
}

func (r *batchMutationRepo) CreateBatch(context.Context, string) (taskruntimerepo.BatchCreateResult, error) {
	return taskruntimerepo.BatchCreateResult{BatchJSON: r.batchJSON, Created: r.created}, nil
}

func (r *batchMutationRepo) UpdateBatch(context.Context, string) (taskruntimerepo.BatchUpdateResult, error) {
	return taskruntimerepo.BatchUpdateResult{
		BatchJSON:            r.batchJSON,
		Applied:              r.applied,
		TerminalTransitioned: r.terminalTransitioned,
	}, nil
}

func TestRpcCreateBatchReturnsAuthoritativeBatch(t *testing.T) {
	repo := &batchMutationRepo{batchJSON: `{"batch_id":"batch-1","status":"running"}`, created: false}
	resp, err := NewService(repo).RpcCreateBatch(context.Background(), &rgrpc.CreateBatchRequest{BatchJson: `{}`})
	if err != nil {
		t.Fatalf("RpcCreateBatch: %v", err)
	}
	if resp.GetBatchJson() != repo.batchJSON || resp.GetCreated() {
		t.Fatalf("unexpected response: batch_json=%q created=%v", resp.GetBatchJson(), resp.GetCreated())
	}
}

func TestRpcUpdateBatchReturnsAuthoritativeBatch(t *testing.T) {
	repo := &batchMutationRepo{batchJSON: `{"batch_id":"batch-1","status":"cancelled"}`, applied: false}
	resp, err := NewService(repo).RpcUpdateBatch(context.Background(), &rgrpc.UpdateBatchRequest{BatchJson: `{}`})
	if err != nil {
		t.Fatalf("RpcUpdateBatch: %v", err)
	}
	if resp.GetBatchJson() != repo.batchJSON || resp.GetApplied() {
		t.Fatalf("unexpected response: batch_json=%q applied=%v", resp.GetBatchJson(), resp.GetApplied())
	}
}
