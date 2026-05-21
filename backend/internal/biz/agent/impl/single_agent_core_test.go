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

package impl

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	sandboxbiz "sico-backend/internal/biz/sandbox"
	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	entity "sico-backend/internal/entity/agent/singleagent"
)

type fakeSingleAgentInstanceRepo struct {
	deleteCalls []int64
	deleteErr   error
}

func (f *fakeSingleAgentInstanceRepo) Create(
	context.Context, *entity.SingleAgentInstance,
) (int64, error) {
	return 0, nil
}

func (f *fakeSingleAgentInstanceRepo) Get(
	context.Context, int64,
) (*entity.SingleAgentInstance, error) {
	return nil, nil
}

func (f *fakeSingleAgentInstanceRepo) MGet(
	context.Context, []int64,
) ([]*entity.SingleAgentInstance, error) {
	return nil, nil
}

func (f *fakeSingleAgentInstanceRepo) GetNamesByIDs(
	context.Context, []int64,
) (map[int64]string, error) {
	return nil, nil
}

func (f *fakeSingleAgentInstanceRepo) Update(
	context.Context, *entity.SingleAgentInstance,
) error {
	return nil
}

func (f *fakeSingleAgentInstanceRepo) Delete(
	_ context.Context, id int64,
) error {
	f.deleteCalls = append(f.deleteCalls, id)
	return f.deleteErr
}

func (f *fakeSingleAgentInstanceRepo) ListByOperatorUsername(
	context.Context, string, int, int,
) ([]*entity.SingleAgentInstance, error) {
	return nil, nil
}

func (f *fakeSingleAgentInstanceRepo) CountByOperatorUsername(
	context.Context, string,
) (int64, error) {
	return 0, nil
}

func (f *fakeSingleAgentInstanceRepo) ListByCondition(
	context.Context, bool, string, int, int,
) ([]*entity.SingleAgentInstance, error) {
	return nil, nil
}

func (f *fakeSingleAgentInstanceRepo) CountByCondition(
	context.Context, bool, string,
) (int64, error) {
	return 0, nil
}

func (f *fakeSingleAgentInstanceRepo) ListByFilter(
	context.Context, *entity.ListSingleAgentInstanceFilter, int, int,
) ([]*entity.SingleAgentInstance, int64, error) {
	return nil, 0, nil
}

func (f *fakeSingleAgentInstanceRepo) CountByAgentID(context.Context, string) (int64, error) {
	return 0, nil
}

func seedAssignedSandbox(t *testing.T, ctx context.Context, rds *redis.Client, lease *sandboximpl.Lease) {
	t.Helper()
	payload, err := json.Marshal(lease)
	require.NoError(t, err)
	require.NoError(t, rds.Set(ctx, "sandbox:resource:"+lease.SandboxID, string(payload), 0).Err())
	require.NoError(t, rds.HSet(ctx, "sandbox:assign:"+lease.User, lease.SandboxID, lease.Type).Err())
}

func TestDeleteSingleAgentInstanceAutoCleansAssignedSandboxes(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	pool := sandboximpl.NewPool(nil, rds)
	sandboxbiz.InitService(sandboximpl.NewService(pool, nil, nil))

	lease := &sandboximpl.Lease{
		SandboxID:  "emulator:http://74.179.80.110:8000|3",
		Type:       "emulator",
		ResourceID: "http://74.179.80.110:8000|3",
		User:       "123",
		InUse:      false,
	}
	seedAssignedSandbox(t, ctx, rds, lease)

	repo := &fakeSingleAgentInstanceRepo{}
	svc := &Service{Components: &Components{SingleAgentInstanceRepo: repo}}

	err := svc.deleteSingleAgentInstance(ctx, 123)
	require.NoError(t, err)
	require.Equal(t, []int64{123}, repo.deleteCalls)

	_, getErr := rds.Get(ctx, "sandbox:resource:"+lease.SandboxID).Result()
	require.ErrorIs(t, getErr, redis.Nil)
	assignments, err := rds.HGetAll(ctx, "sandbox:assign:123").Result()
	require.NoError(t, err)
	require.NotContains(t, assignments, lease.SandboxID)
}

func TestDeleteSingleAgentInstanceDoesNotDeleteWhenSandboxCleanupFails(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	pool := sandboximpl.NewPool(nil, rds)
	sandboxbiz.InitService(sandboximpl.NewService(pool, nil, nil))

	lease := &sandboximpl.Lease{
		SandboxID:  "emulator:http://74.179.80.110:8000|3",
		Type:       "emulator",
		ResourceID: "http://74.179.80.110:8000|3",
		User:       "123",
		InUse:      true,
	}
	seedAssignedSandbox(t, ctx, rds, lease)

	repo := &fakeSingleAgentInstanceRepo{}
	svc := &Service{Components: &Components{SingleAgentInstanceRepo: repo}}

	err := svc.deleteSingleAgentInstance(ctx, 123)
	require.Error(t, err)
	require.Empty(t, repo.deleteCalls)

	storedLease, getErr := rds.Get(ctx, "sandbox:resource:"+lease.SandboxID).Result()
	require.NoError(t, getErr)
	require.NotEmpty(t, storedLease)
	assignments, err := rds.HGetAll(ctx, "sandbox:assign:123").Result()
	require.NoError(t, err)
	require.Contains(t, assignments, lease.SandboxID)
	require.False(t, errors.Is(err, redis.Nil))
}
