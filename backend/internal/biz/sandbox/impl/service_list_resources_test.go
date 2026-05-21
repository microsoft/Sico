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
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
)

type fakeProvider struct {
	providerType string
	mu           sync.Mutex
	responses    [][]*Resource
	errs         []error
	calls        int
	resetFn      func(context.Context, string) error
	resetCalls   int
}

func (p *fakeProvider) Type() string {
	return p.providerType
}

func (p *fakeProvider) ListResources(context.Context) ([]*Resource, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	callIndex := p.calls
	p.calls++

	if callIndex < len(p.errs) && p.errs[callIndex] != nil {
		return nil, p.errs[callIndex]
	}
	if len(p.responses) == 0 {
		return []*Resource{}, nil
	}
	if callIndex >= len(p.responses) {
		callIndex = len(p.responses) - 1
	}

	return cloneResources(p.responses[callIndex]), nil
}

func (p *fakeProvider) ResetResource(ctx context.Context, resourceID string) error {
	p.mu.Lock()
	p.resetCalls++
	resetFn := p.resetFn
	p.mu.Unlock()

	if resetFn != nil {
		return resetFn(ctx, resourceID)
	}

	return nil
}

type blockingProvider struct {
	providerType string
	resources    []*Resource
	entered      chan struct{}
	release      <-chan struct{}
	once         sync.Once
}

func (p *blockingProvider) Type() string {
	return p.providerType
}

func (p *blockingProvider) ListResources(context.Context) ([]*Resource, error) {
	if p.entered != nil {
		p.once.Do(func() {
			close(p.entered)
		})
	}
	if p.release != nil {
		<-p.release
	}
	return cloneResources(p.resources), nil
}

func (p *blockingProvider) ResetResource(context.Context, string) error {
	return nil
}

func newTestPool(rds *redis.Client, provider Provider, missingHideAfter time.Duration) *Pool {
	if provider == nil {
		return newTestPoolWithProviders(rds, missingHideAfter)
	}

	return newTestPoolWithProviders(rds, missingHideAfter, provider)
}

func newTestPoolWithProviders(rds *redis.Client, missingHideAfter time.Duration, providers ...Provider) *Pool {
	providerMap := map[string]Provider{}
	for _, provider := range providers {
		if provider == nil {
			continue
		}
		providerMap[provider.Type()] = provider
	}

	return &Pool{
		providers:               providerMap,
		rds:                     rds,
		refreshInterval:         15 * time.Second,
		providerFailureCount:    make(map[string]int),
		providerLastSuccessAt:   make(map[string]time.Time),
		missingLeaseMarkAfter:   30 * time.Second,
		missingLeaseHideAfter:    missingHideAfter,
		missingLeaseDeleteAfter:  24 * time.Hour,
		instanceID:               newPoolInstanceID(),
		shrinkConfirmations:      2,
		snapshotUnhealthyAfter:   60 * time.Second,
		snapshotUnavailableAfter: 2 * time.Minute,
	}
}

func seedLease(t *testing.T, ctx context.Context, rds *redis.Client, lease *Lease) {
	t.Helper()

	payload, err := json.Marshal(lease)
	require.NoError(t, err)
	require.NoError(t, rds.Set(ctx, resourceKey(lease.Type, lease.ResourceID), string(payload), 0).Err())
	require.NoError(t, rds.HSet(ctx, assignKey(lease.User), lease.SandboxID, lease.Type).Err())
}

func loadLease(t *testing.T, ctx context.Context, rds *redis.Client, sandboxID string) *Lease {
	t.Helper()

	val, err := rds.Get(ctx, resourceKeyPrefix+sandboxID).Result()
	require.NoError(t, err)

	var lease Lease
	require.NoError(t, json.Unmarshal([]byte(val), &lease))
	return &lease
}

func seedSnapshot(
	t *testing.T,
	ctx context.Context,
	rds *redis.Client,
	snapshotType string,
	refreshedAt time.Time,
	resources ...*Resource,
) {
	t.Helper()

	snapshot := &ResourceSnapshot{
		Type:        snapshotType,
		RefreshedAt: refreshedAt,
		Resources:   cloneResources(resources),
	}
	payload, err := json.Marshal(snapshot)
	require.NoError(t, err)
	require.NoError(t, rds.Set(ctx, resourceSnapshotKey(snapshotType), string(payload), 0).Err())
}

func loadSnapshot(t *testing.T, ctx context.Context, rds *redis.Client, snapshotType string) *ResourceSnapshot {
	t.Helper()

	val, err := rds.Get(ctx, resourceSnapshotKey(snapshotType)).Result()
	require.NoError(t, err)

	var snapshot ResourceSnapshot
	require.NoError(t, json.Unmarshal([]byte(val), &snapshot))
	return &snapshot
}

func testEmulatorLease() *Lease {
	return &Lease{
		SandboxID:  "emulator:http://74.179.80.110:8000|3",
		Type:       enum.SandboxTypeEmulator.String(),
		ResourceID: "http://74.179.80.110:8000|3",
		User:       "123",
		CreatedAt:  time.Unix(1712000000, 0),
		Metadata: map[string]string{
			"providerBaseUrl": "http://74.179.80.110:8000",
			"adbPort":         "16480",
		},
	}
}

func testEmulatorResource(status ResourceStatus) *Resource {
	return &Resource{
		Type:       enum.SandboxTypeEmulator.String(),
		ResourceID: "http://74.179.80.110:8000|3",
		Status:     status,
		Metadata: map[string]string{
			"providerBaseUrl": "http://74.179.80.110:8000",
			"adbPort":         "16480",
		},
	}
}

func TestListAllResourcesDoesNotIncludeLeaseWithoutSnapshot(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	seedLease(t, ctx, rds, testEmulatorLease())

	svc := &Service{Pool: &Pool{rds: rds}}
	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)

	emulatorResources, ok := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.True(t, ok)
	require.Len(t, emulatorResources, 0)
}

func TestListAllResourcesReturnsErrorWhenSnapshotUnavailable(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider boom")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ListAllResources(ctx)
	require.Nil(t, result)
	require.Error(t, err)
	require.ErrorContains(t, err, "snapshot unavailable")
	require.Equal(t, 0, provider.calls)
}

func TestListAllResourcesKeepsRecentlyMissingAssignedResourceAssignedDuringGrace(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusAvailable)},
			{},
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	seedLease(t, ctx, rds, testEmulatorLease())
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	svc := &Service{Pool: pool}
	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)

	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusAssigned), emulatorResources[0]["status"])
	require.Equal(t, "123", emulatorResources[0]["instance_id"])
	require.Equal(t, "74.179.80.110:16480", emulatorResources[0]["endpoint"])

	storedLease := loadLease(t, ctx, rds, testEmulatorLease().SandboxID)
	require.Nil(t, storedLease.ProviderMissingSinceAt)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusAvailable, snapshot.Resources[0].Status)
	require.NotNil(t, snapshot.Resources[0].MissingSinceAt)
}

func TestListAllResourcesMarksAssignedResourceUnhealthyAfterMissingGrace(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)

	resource := testEmulatorResource(ResourceStatusAvailable)
	lastSeen := time.Now().Add(-45 * time.Second)
	resource.LastSeenAt = &lastSeen
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses:    [][]*Resource{{}, {}},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	svc := &Service{Pool: pool}
	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)

	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusUnhealthy), emulatorResources[0]["status"])

	storedLease := loadLease(t, ctx, rds, lease.SandboxID)
	require.NotNil(t, storedLease.ProviderMissingSinceAt)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusUnhealthy, snapshot.Resources[0].Status)
	require.NotNil(t, snapshot.Resources[0].MissingSinceAt)
}

func TestTransientProviderEmptyResponsePreservesAvailableDuringGrace(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	resource := testEmulatorResource(ResourceStatusAvailable)
	resource2 := &Resource{
		Type:       enum.SandboxTypeEmulator.String(),
		ResourceID: "http://74.179.80.110:8000|10",
		Status:     ResourceStatusAvailable,
		Metadata:   map[string]string{"adbAddress": "74.179.80.110:16704"},
	}

	// First refresh: provider returns both resources → snapshot contains 2 available
	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{resource, resource2},
			{},                    // Second refresh: transient empty
			{resource, resource2}, // Third refresh: recovery
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))

	svc := &Service{Pool: pool}
	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 2)
	require.Equal(t, string(ResourceStatusAvailable), emulatorResources[0]["status"])
	require.Equal(t, string(ResourceStatusAvailable), emulatorResources[1]["status"])
	require.Equal(t, true, emulatorResources[0]["allocatable"])
	require.Equal(t, true, emulatorResources[1]["allocatable"])

	// Second refresh: provider returns empty once → keep last accepted snapshot untouched.
	require.NoError(t, pool.refreshResources(ctx))

	result, err = svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources = result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 2)
	for _, r := range emulatorResources {
		require.Equal(t, string(ResourceStatusAvailable), r["status"],
			"resource %s should stay available while shrink is pending", r["resource_id"])
		require.Equal(t, false, r["allocatable"],
			"resource %s should not be allocatable for new assignment while shrink is pending", r["resource_id"])
	}

	// Third refresh: provider returns both → resources still available, missingSinceAt cleared
	require.NoError(t, pool.refreshResources(ctx))

	result, err = svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources = result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 2)
	for _, r := range emulatorResources {
		require.Equal(t, string(ResourceStatusAvailable), r["status"],
			"resource %s should be available after recovery", r["resource_id"])
		require.Equal(t, true, r["allocatable"],
			"resource %s should be allocatable after recovery", r["resource_id"])
	}

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 2)
	for _, r := range snapshot.Resources {
		require.Nil(t, r.MissingSinceAt, "missingSinceAt should be cleared after recovery")
	}
}

func TestRefreshResourcesPublishesSnapshotsAtomically(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	oldRefreshedAt := time.Now()
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		oldRefreshedAt, testEmulatorResource(ResourceStatusUnhealthy),
	)

	releaseEmulator := make(chan struct{})
	emulator := &blockingProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		resources:    []*Resource{testEmulatorResource(ResourceStatusAvailable)},
		entered:      make(chan struct{}),
		release:      releaseEmulator,
	}
	pool := newTestPoolWithProviders(rds, time.Minute, emulator)

	errCh := make(chan error, 1)
	go func() {
		errCh <- pool.refreshResources(ctx)
	}()

	<-emulator.entered

	listResult, err := pool.ListResources(ctx, "")
	require.NoError(t, err)
	statuses := map[string]string{}
	for _, resource := range listResult.Resources {
		if resource == nil {
			continue
		}
		statuses[resource.Type] = resource.Status
	}
	require.Equal(t, string(ResourceStatusUnhealthy), statuses[enum.SandboxTypeEmulator.String()])

	close(releaseEmulator)
	require.NoError(t, <-errCh)

	listResult, err = pool.ListResources(ctx, "")
	require.NoError(t, err)
	statuses = map[string]string{}
	for _, resource := range listResult.Resources {
		if resource == nil {
			continue
		}
		statuses[resource.Type] = resource.Status
	}
	require.Equal(t, string(ResourceStatusAvailable), statuses[enum.SandboxTypeEmulator.String()])
}

func TestExplicitlyUnhealthyResourceStaysUnhealthyWhenMissingDuringGrace(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	// Refresh 1: provider explicitly reports the resource as unhealthy.
	// Refresh 2: provider omits the resource entirely (within grace period).
	// Expect: resource stays unhealthy, NOT washed back to available.
	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusUnhealthy)},
			{}, // provider omits the resource
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusUnhealthy, snapshot.Resources[0].Status)

	// Second refresh: resource goes missing
	require.NoError(t, pool.refreshResources(ctx))

	snapshot = loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusUnhealthy, snapshot.Resources[0].Status,
		"explicitly unhealthy resource must NOT be washed to available during grace period")
	require.NotNil(t, snapshot.Resources[0].MissingSinceAt)
}

func TestAssignSandboxRejectsGracePeriodResource(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	// Refresh 1: resource is available.
	// Refresh 2: provider returns empty (resource enters grace period).
	// AssignSandbox should fail — grace-period resources are visible but not allocatable.
	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusAvailable)},
			{},
			{},
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	svc := &Service{Pool: pool}

	// Grace-period resource should be visible in the list...
	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusAvailable), emulatorResources[0]["status"])
	require.Equal(t, false, emulatorResources[0]["allocatable"])

	// ...but NOT assignable to a new instance.
	err = svc.AssignSandbox(ctx, "123", testEmulatorLease().SandboxID)
	require.Error(t, err)
	require.ErrorContains(t, err, "sandbox resource not found")
}

func TestApplySandboxAllowsGracePeriodAssignedResource(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusAvailable)},
			{},
			{},
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	svc := &Service{Pool: pool}
	result, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, lease.SandboxID, result["sandbox_id"])

	stored, getErr := svc.Pool.GetSandboxByID(ctx, lease.SandboxID)
	require.NoError(t, getErr)
	require.True(t, stored.InUse)
	require.NotNil(t, stored.ProviderMissingSinceAt)
}

func TestRefreshResourcesRequiresConfirmedShrinkBeforeMarkingMissing(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusAvailable)},
			{},
			{},
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	svc := &Service{Pool: pool}

	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, false, emulatorResources[0]["allocatable"])

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.NotNil(t, snapshot.Resources[0].MissingSinceAt)

	require.NoError(t, pool.refreshResources(ctx))

	result, err = svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources = result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, false, emulatorResources[0]["allocatable"])

	snapshot = loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.NotNil(t, snapshot.Resources[0].MissingSinceAt)

	_, err = rds.Get(ctx, resourcePendingShrinkKey(enum.SandboxTypeEmulator.String())).Result()
	require.ErrorIs(t, err, redis.Nil)
}

func TestRefreshResourcesDoesNotConfirmShrinkAcrossProviderError(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusAvailable)},
			{},
			nil,
			{},
			{},
		},
		errs: []error{nil, nil, errors.New("provider boom"), nil, nil},
	}
	pool := newTestPool(rds, provider, time.Minute)
	svc := &Service{Pool: pool}

	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, false, emulatorResources[0]["allocatable"])

	require.NoError(t, pool.refreshResources(ctx))
	_, getErr := rds.Get(ctx, resourcePendingShrinkKey(enum.SandboxTypeEmulator.String())).Result()
	require.ErrorIs(t, getErr, redis.Nil)

	// Provider error clears pending shrink but snapshot still has MissingSinceAt
	// from the pending delay — resource remains non-allocatable (safe behavior).
	result, err = svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources = result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, false, emulatorResources[0]["allocatable"])

	require.NoError(t, pool.refreshResources(ctx))
	result, err = svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources = result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, false, emulatorResources[0]["allocatable"])

	require.NoError(t, pool.refreshResources(ctx))
	result, err = svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources = result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, false, emulatorResources[0]["allocatable"])
}

func TestRefreshResourcesRequiresSameShrinkCandidateToConfirm(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	resourceA := testEmulatorResource(ResourceStatusAvailable)
	resourceB := &Resource{
		Type:       enum.SandboxTypeEmulator.String(),
		ResourceID: "http://74.179.80.110:8000|10",
		Status:     ResourceStatusAvailable,
		Metadata:   map[string]string{"adbAddress": "74.179.80.110:16704"},
	}
	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{resourceA, resourceB},
			{resourceA},
			{resourceB},
			{resourceB},
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	svc := &Service{Pool: pool}

	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 2)

	// After refresh 3: candidate changed (B→A missing), pending shrink resets.
	// A is missing → allocatable=false; B recovered → allocatable=true.
	allocatableByID := map[string]bool{}
	for _, resource := range emulatorResources {
		allocatableByID[resource["resource_id"].(string)] = resource["allocatable"].(bool)
	}
	require.False(t, allocatableByID[resourceA.ResourceID])
	require.True(t, allocatableByID[resourceB.ResourceID])

	require.NoError(t, pool.refreshResources(ctx))

	result, err = svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources = result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 2)

	allocatableByID = map[string]bool{}
	for _, resource := range emulatorResources {
		allocatableByID[resource["resource_id"].(string)] = resource["allocatable"].(bool)
	}
	require.False(t, allocatableByID[resourceA.ResourceID])
	require.True(t, allocatableByID[resourceB.ResourceID])
}

func TestRefreshResourcesSkipsProviderCallsWhenAnotherLeaderExists(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	leaderProvider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses:    [][]*Resource{{testEmulatorResource(ResourceStatusAvailable)}},
	}
	followerProvider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses:    [][]*Resource{{testEmulatorResource(ResourceStatusUnhealthy)}},
	}

	leaderPool := newTestPool(rds, leaderProvider, time.Minute)
	followerPool := newTestPool(rds, followerProvider, time.Minute)
	leaderPool.instanceID = "leader-pod"
	followerPool.instanceID = "follower-pod"

	require.NoError(t, leaderPool.refreshResources(ctx))
	err := followerPool.refreshResources(ctx)
	require.ErrorIs(t, err, errSnapshotRefreshInProgress)
	require.Equal(t, 1, leaderProvider.calls)
	require.Equal(t, 0, followerProvider.calls)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusAvailable, snapshot.Resources[0].Status)

	leaderID, getErr := rds.Get(ctx, resourceSnapshotLeaderKey).Result()
	require.NoError(t, getErr)
	require.Equal(t, leaderPool.instanceID, leaderID)
}

func TestRefreshResourcesReleasesLeadershipWhenAllProvidersFail(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	leaderEmulator := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("emulator boom")},
	}
	followerEmulator := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses:    [][]*Resource{{testEmulatorResource(ResourceStatusAvailable)}},
	}

	leaderPool := newTestPoolWithProviders(rds, time.Minute, leaderEmulator)
	followerPool := newTestPoolWithProviders(rds, time.Minute, followerEmulator)
	leaderPool.instanceID = "leader-pod"
	followerPool.instanceID = "follower-pod"

	// Leader has no previous snapshots and all providers fail → error + release.
	err := leaderPool.refreshResources(ctx)
	require.Error(t, err)
	require.Equal(t, 1, leaderEmulator.calls)

	// Follower can now take over.
	require.NoError(t, followerPool.refreshResources(ctx))
	require.Equal(t, 1, followerEmulator.calls)

	leaderID, getErr := rds.Get(ctx, resourceSnapshotLeaderKey).Result()
	require.NoError(t, getErr)
	require.Equal(t, followerPool.instanceID, leaderID)
}

func TestGetSandboxOpenAPIUsesGracePeriodAvailableResource(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/openapi.json", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openapi":"3.0.0"}`))
	}))
	defer server.Close()

	resource := testEmulatorResource(ResourceStatusAvailable)
	resource.Metadata["providerBaseUrl"] = server.URL
	missingSince := time.Now().Add(-10 * time.Second)
	resource.MissingSinceAt = &missingSince
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	data, err := svc.GetSandboxOpenAPI(ctx, enum.SandboxTypeEmulator.String())
	require.NoError(t, err)
	require.JSONEq(t, `{"openapi":"3.0.0"}`, string(data))
	require.Equal(t, 0, provider.calls)
}

func TestGetSandboxOpenAPIUsesStaleSnapshotWithoutProviderCall(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/openapi.json", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openapi":"3.0.0"}`))
	}))
	defer server.Close()

	resource := testEmulatorResource(ResourceStatusAvailable)
	resource.Metadata["providerBaseUrl"] = server.URL
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now().Add(-25*time.Second), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	data, err := svc.GetSandboxOpenAPI(ctx, enum.SandboxTypeEmulator.String())
	require.NoError(t, err)
	require.JSONEq(t, `{"openapi":"3.0.0"}`, string(data))
	require.Equal(t, 0, provider.calls)
}

func TestShouldLogMissingResourceMarkedUnhealthy(t *testing.T) {
	t.Parallel()

	pool := &Pool{
		refreshInterval:       15 * time.Second,
		missingLeaseMarkAfter: 30 * time.Second,
	}
	missingSince := time.Now().Add(-31 * time.Second)
	require.True(t, pool.shouldLogMissingResourceMarkedUnhealthy(&missingSince, time.Now()))

	olderMissingSince := time.Now().Add(-50 * time.Second)
	require.False(t, pool.shouldLogMissingResourceMarkedUnhealthy(&olderMissingSince, time.Now()))
}

func TestRefreshResourcesMarksExplicitlyUnhealthyAssignedResourceUnhealthy(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{{
			testEmulatorResource(ResourceStatusUnhealthy),
		}},
	}
	p := newTestPool(rds, provider, time.Minute)
	seedLease(t, ctx, rds, testEmulatorLease())
	require.NoError(t, p.refreshResources(ctx))

	storedLease := loadLease(t, ctx, rds, testEmulatorLease().SandboxID)
	require.NotNil(t, storedLease.ProviderMissingSinceAt)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusUnhealthy, snapshot.Resources[0].Status)
	require.NotNil(t, snapshot.Resources[0].MissingSinceAt)

	svc := &Service{Pool: p}
	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)

	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusUnhealthy), emulatorResources[0]["status"])
	require.Equal(t, testEmulatorLease().User, emulatorResources[0]["instance_id"])
}

func TestListAllResourcesHidesUnavailableResourceAfterGracePeriod(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	missingSince := time.Now().Add(-2 * time.Minute)
	lease.ProviderMissingSinceAt = &missingSince
	seedLease(t, ctx, rds, lease)

	resource := testEmulatorResource(ResourceStatusUnavailable)
	resource.MissingSinceAt = &missingSince
	lastSeen := time.Now().Add(-3 * time.Minute)
	resource.LastSeenAt = &lastSeen
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	listResult, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	require.Len(t, listResult[enum.SandboxTypeEmulator.String()].([]map[string]interface{}), 0)

	instanceResult, err := svc.GetInstanceSandboxesWithStatus(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.Len(t, instanceResult, 1)
	require.Equal(t, string(ResourceStatusUnavailable), instanceResult[0]["status"])
	require.Equal(t, 0, provider.calls)
}

func TestRefreshResourcesHidesExplicitlyUnhealthyResourceAfterGracePeriod(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	missingSince := time.Now().Add(-2 * time.Minute)
	lease.ProviderMissingSinceAt = &missingSince
	seedLease(t, ctx, rds, lease)

	resource := testEmulatorResource(ResourceStatusUnhealthy)
	resource.MissingSinceAt = &missingSince
	lastSeen := time.Now().Add(-3 * time.Minute)
	resource.LastSeenAt = &lastSeen
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{{
			testEmulatorResource(ResourceStatusUnhealthy),
		}},
	}
	p := newTestPool(rds, provider, time.Minute)
	require.NoError(t, p.refreshResources(ctx))

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusUnavailable, snapshot.Resources[0].Status)
	require.NotNil(t, snapshot.Resources[0].MissingSinceAt)

	svc := &Service{Pool: p}
	listResult, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	require.Len(t, listResult[enum.SandboxTypeEmulator.String()].([]map[string]interface{}), 0)

	instanceResult, err := svc.GetInstanceSandboxesWithStatus(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.Len(t, instanceResult, 1)
	require.Equal(t, string(ResourceStatusUnavailable), instanceResult[0]["status"])
}

func TestApplySandboxSkipsUnavailableSnapshotResource(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), testEmulatorResource(ResourceStatusUnhealthy))

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.Nil(t, result)
	require.Equal(t, 0, provider.calls)

	stored, getErr := svc.Pool.GetSandboxByID(ctx, lease.SandboxID)
	require.NoError(t, getErr)
	require.False(t, stored.InUse)
}

func TestApplySandboxUsesFreshSnapshotWithoutProviderCall(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), testEmulatorResource(ResourceStatusAvailable))

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, lease.SandboxID, result["sandbox_id"])
	require.Equal(t, 0, provider.calls)

	stored, getErr := svc.Pool.GetSandboxByID(ctx, lease.SandboxID)
	require.NoError(t, getErr)
	require.True(t, stored.InUse)
}

func TestApplySandboxUsesStaleSnapshotWithoutProviderCall(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now().Add(-25*time.Second), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 0, provider.calls)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusAvailable, snapshot.Resources[0].Status)
}

func TestApplySandboxFailsWhenSnapshotUnavailable(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider boom")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.Nil(t, result)
	require.Error(t, err)
	require.ErrorContains(t, err, "snapshot unavailable")
	require.Equal(t, 0, provider.calls)
}

func TestAssignSandboxUsesFreshSnapshotWithoutProviderCall(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now(), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	err := svc.AssignSandbox(ctx, "123", testEmulatorLease().SandboxID)
	require.NoError(t, err)
	require.Equal(t, 0, provider.calls)

	stored, getErr := svc.Pool.GetSandboxByID(ctx, testEmulatorLease().SandboxID)
	require.NoError(t, getErr)
	require.Equal(t, "123", stored.User)
	require.False(t, stored.InUse)
}

func TestAssignSandboxRejectsReassignWhileInUse(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	lease.InUse = true
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now(), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	err := svc.AssignSandbox(ctx, "456", lease.SandboxID)
	require.Error(t, err)
	require.ErrorContains(t, err, "release or unassign before reassigning")
	require.Equal(t, 0, provider.calls)

	stored := loadLease(t, ctx, rds, lease.SandboxID)
	require.Equal(t, lease.User, stored.User)
	require.True(t, stored.InUse)

	oldAssignments, getErr := rds.HGetAll(ctx, assignKey(lease.User)).Result()
	require.NoError(t, getErr)
	require.Contains(t, oldAssignments, lease.SandboxID)

	newAssignments, getErr := rds.HGetAll(ctx, assignKey("456")).Result()
	require.NoError(t, getErr)
	require.NotContains(t, newAssignments, lease.SandboxID)
}

func TestAssignSandboxAllowsReassignAfterRelease(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now(), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	err := svc.AssignSandbox(ctx, "456", lease.SandboxID)
	require.NoError(t, err)
	require.Equal(t, 0, provider.calls)

	stored := loadLease(t, ctx, rds, lease.SandboxID)
	require.Equal(t, "456", stored.User)
	require.False(t, stored.InUse)

	oldAssignments, getErr := rds.HGetAll(ctx, assignKey(lease.User)).Result()
	require.NoError(t, getErr)
	require.NotContains(t, oldAssignments, lease.SandboxID)

	newAssignments, getErr := rds.HGetAll(ctx, assignKey("456")).Result()
	require.NoError(t, getErr)
	require.Contains(t, newAssignments, lease.SandboxID)
}

func TestUnassignSandboxReleasesInUseSandboxBeforeDeleting(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	lease.InUse = true
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now(), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{providerType: enum.SandboxTypeEmulator.String()}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	err := svc.UnassignSandbox(ctx, lease.User, lease.SandboxID)
	require.NoError(t, err)
	require.Equal(t, 1, provider.resetCalls)

	_, getErr := rds.Get(ctx, resourceKeyPrefix+lease.SandboxID).Result()
	require.ErrorIs(t, getErr, redis.Nil)
	assignments, err := rds.HGetAll(ctx, assignKey(lease.User)).Result()
	require.NoError(t, err)
	require.NotContains(t, assignments, lease.SandboxID)

	cooldownExists, err := rds.Exists(ctx, cooldownKeyPrefix+lease.SandboxID).Result()
	require.NoError(t, err)
	require.Equal(t, int64(1), cooldownExists)
}

func TestApplySandboxUsesStaleSnapshotWhenProviderWouldFail(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now().Add(-25*time.Second), testEmulatorResource(ResourceStatusAvailable),
	)

	emulatorProvider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("emulator boom")},
	}
	svc := &Service{Pool: newTestPoolWithProviders(rds, time.Minute, emulatorProvider)}

	result, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 0, emulatorProvider.calls)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusAvailable, snapshot.Resources[0].Status)
	require.Nil(t, snapshot.Resources[0].MissingSinceAt)
	require.WithinDuration(t, time.Now().Add(-25*time.Second), snapshot.RefreshedAt, 2*time.Second)
	if snapshot.Resources[0].LastSeenAt != nil {
		require.True(t,
			snapshot.RefreshedAt.Before(*snapshot.Resources[0].LastSeenAt) ||
				snapshot.RefreshedAt.Equal(*snapshot.Resources[0].LastSeenAt))
	}

	storedLease := loadLease(t, ctx, rds, lease.SandboxID)
	require.Nil(t, storedLease.ProviderMissingSinceAt)
}

func TestAssignSandboxUsesStaleSnapshotWhenProviderWouldFail(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now().Add(-25*time.Second), testEmulatorResource(ResourceStatusAvailable),
	)

	emulatorProvider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("emulator boom")},
	}
	svc := &Service{Pool: newTestPoolWithProviders(rds, time.Minute, emulatorProvider)}

	err := svc.AssignSandbox(ctx, "123", testEmulatorLease().SandboxID)
	require.NoError(t, err)
	require.Equal(t, 0, emulatorProvider.calls)

	stored, getErr := svc.Pool.GetSandboxByID(ctx, testEmulatorLease().SandboxID)
	require.NoError(t, getErr)
	require.Equal(t, "123", stored.User)
}

func TestGetInstanceSandboxesWithStatusKeepsProviderMissingResourceAssignedDuringGrace(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusAvailable)},
			{},
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))
	require.NoError(t, pool.refreshResources(ctx))

	svc := &Service{Pool: pool}
	result, err := svc.GetInstanceSandboxesWithStatus(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.Len(t, result, 1)
	require.Equal(t, string(ResourceStatusAssigned), result[0]["status"])
}

func TestGetInstanceSandboxesWithStatusReturnsErrorWhenSnapshotUnavailable(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider boom"), errors.New("provider boom"), errors.New("provider boom")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.GetInstanceSandboxesWithStatus(ctx, lease.User, lease.Type)
	require.Nil(t, result)
	require.Error(t, err)
	require.ErrorContains(t, err, "failed to load sandbox status")
	require.ErrorContains(t, err, "snapshot unavailable")
	require.Equal(t, 0, provider.calls)
}

func TestGetInstanceSandboxesWithStatusReturnsErrorWhenAssignedLeaseIsUnreadable(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	require.NoError(t, rds.HSet(ctx, assignKey(lease.User), lease.SandboxID, lease.Type).Err())
	require.NoError(t, rds.Set(ctx, resourceKey(lease.Type, lease.ResourceID), "x", 0).Err())

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.GetInstanceSandboxesWithStatus(ctx, lease.User, lease.Type)
	require.Nil(t, result)
	require.Error(t, err)
	require.ErrorContains(t, err, "invalid character")
	require.Equal(t, 0, provider.calls)
}

func TestGetInstanceSandboxesWithStatusReturnsEmptyWithoutAssignments(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider boom")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.GetInstanceSandboxesWithStatus(ctx, "123", enum.SandboxTypeEmulator.String())
	require.NoError(t, err)
	require.Empty(t, result)
}

func TestListAllResourcesShowsRecentMissingAssignmentAcrossPodRestart(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	missingSince := time.Now().Add(-10 * time.Second)
	lease.ProviderMissingSinceAt = &missingSince
	seedLease(t, ctx, rds, lease)

	resource := testEmulatorResource(ResourceStatusUnhealthy)
	resource.MissingSinceAt = &missingSince
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)

	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusUnhealthy), emulatorResources[0]["status"])
	require.Equal(t, lease.User, emulatorResources[0]["instance_id"])
	require.Equal(t, 0, provider.calls)
}

func TestMissingAssignmentIsHiddenFromDashboardButStillAssignedBeforeDeleteWindow(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	missingSince := time.Now().Add(-1 * time.Hour)
	lease.ProviderMissingSinceAt = &missingSince
	seedLease(t, ctx, rds, lease)

	resource := testEmulatorResource(ResourceStatusUnavailable)
	resource.MissingSinceAt = &missingSince
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	listResult, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	require.Len(t, listResult[enum.SandboxTypeEmulator.String()].([]map[string]interface{}), 0)

	instanceResult, err := svc.GetInstanceSandboxesWithStatus(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.Len(t, instanceResult, 1)
	require.Equal(t, string(ResourceStatusUnavailable), instanceResult[0]["status"])

	assignments, err := rds.HGetAll(ctx, assignKey(lease.User)).Result()
	require.NoError(t, err)
	require.Contains(t, assignments, lease.SandboxID)
	require.Equal(t, 0, provider.calls)
}

func TestResolveResourceByHashUsesSnapshotWithoutProviderCall(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	resource := testEmulatorResource(ResourceStatusUnavailable)
	resource.Metadata["providerBaseUrl"] = "http://74.179.80.110:8000"
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	pool := newTestPool(rds, provider, time.Minute)

	resolved, err := pool.ResolveResourceByHash(ctx, enum.SandboxTypeEmulator.String(), hashResourceID(resource.ResourceID))
	require.NoError(t, err)
	require.NotNil(t, resolved)
	require.Equal(t, resource.ResourceID, resolved.ResourceID)
	require.Equal(t, ResourceStatusUnavailable, resolved.Status)
	require.Equal(t, 0, provider.calls)
}

func TestResolveResourceByHashFallsBackToLeaseMetadataWithoutSnapshot(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	missingSince := time.Now().Add(-2 * time.Hour)
	lease.ProviderMissingSinceAt = &missingSince
	seedLease(t, ctx, rds, lease)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	pool := newTestPool(rds, provider, time.Minute)

	resolved, err := pool.ResolveResourceByHash(ctx, enum.SandboxTypeEmulator.String(), hashResourceID(lease.ResourceID))
	require.NoError(t, err)
	require.NotNil(t, resolved)
	require.Equal(t, lease.ResourceID, resolved.ResourceID)
	require.Equal(t, ResourceStatusUnavailable, resolved.Status)
	require.Equal(t, lease.Metadata["providerBaseUrl"], resolved.Metadata["providerBaseUrl"])
	require.Equal(t, 0, provider.calls)
}

func TestReleaseSandboxKeepsLeaseInUseUntilResetCompletes(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	lease.InUse = true
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now(), testEmulatorResource(ResourceStatusAvailable),
	)

	resetStarted := make(chan struct{})
	allowReset := make(chan struct{})
	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		resetFn: func(context.Context, string) error {
			select {
			case <-resetStarted:
			default:
				close(resetStarted)
			}
			<-allowReset
			return nil
		},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	errCh := make(chan error, 1)
	go func() {
		errCh <- svc.ReleaseSandbox(ctx, lease.User, lease.SandboxID)
	}()

	<-resetStarted

	applied, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.Nil(t, applied)

	storedLease := loadLease(t, ctx, rds, lease.SandboxID)
	require.True(t, storedLease.InUse)

	close(allowReset)
	require.NoError(t, <-errCh)

	storedLease = loadLease(t, ctx, rds, lease.SandboxID)
	require.False(t, storedLease.InUse)

	cooldownExists, err := rds.Exists(ctx, cooldownKeyPrefix+lease.SandboxID).Result()
	require.NoError(t, err)
	require.Equal(t, int64(1), cooldownExists)
	require.Equal(t, 1, provider.resetCalls)
}

func TestReleaseSandboxReturnsResetFailedAndKeepsLeaseInUse(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	lease.InUse = true
	seedLease(t, ctx, rds, lease)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		resetFn: func(context.Context, string) error {
			return errors.New("reset boom")
		},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	err := svc.ReleaseSandbox(ctx, lease.User, lease.SandboxID)
	require.Error(t, err)
	ae, ok := apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.SandboxResetFailed, ae.Code())

	storedLease := loadLease(t, ctx, rds, lease.SandboxID)
	require.True(t, storedLease.InUse)

	cooldownExists, cdErr := rds.Exists(ctx, cooldownKeyPrefix+lease.SandboxID).Result()
	require.NoError(t, cdErr)
	require.Equal(t, int64(0), cooldownExists)
	require.Equal(t, 1, provider.resetCalls)
}

func TestRefreshResourcesClearsMissingStateWhenProviderRecovers(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	missingSince := time.Now().Add(-1 * time.Hour)
	lease.ProviderMissingSinceAt = &missingSince
	seedLease(t, ctx, rds, lease)

	resource := testEmulatorResource(ResourceStatusUnavailable)
	resource.MissingSinceAt = &missingSince
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses:    [][]*Resource{{testEmulatorResource(ResourceStatusAvailable)}},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))

	storedLease := loadLease(t, ctx, rds, lease.SandboxID)
	require.Nil(t, storedLease.ProviderMissingSinceAt)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusAvailable, snapshot.Resources[0].Status)
	require.Nil(t, snapshot.Resources[0].MissingSinceAt)

	svc := &Service{Pool: pool}
	listResult, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	require.Len(t, listResult[enum.SandboxTypeEmulator.String()].([]map[string]interface{}), 1)
	require.Equal(t,
		string(ResourceStatusAssigned),
		listResult[enum.SandboxTypeEmulator.String()].([]map[string]interface{})[0]["status"])
}

func TestRefreshResourcesKeepsPreviousSnapshotWhenProviderRefreshFails(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now(), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider boom")},
	}
	pool := newTestPool(rds, provider, time.Minute)
	require.NoError(t, pool.refreshResources(ctx))

	storedLease := loadLease(t, ctx, rds, lease.SandboxID)
	require.Nil(t, storedLease.ProviderMissingSinceAt)

	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, ResourceStatusAvailable, snapshot.Resources[0].Status)
	require.Nil(t, snapshot.Resources[0].MissingSinceAt)

	svc := &Service{Pool: pool}
	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)

	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusAssigned), emulatorResources[0]["status"])
	require.Equal(t, lease.User, emulatorResources[0]["instance_id"])
}

func TestApplySandboxDoesNotAcquireLeaseOwnedByAnotherInstance(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	lease.User = "456"
	seedLease(t, ctx, rds, lease)
	require.NoError(t, rds.HSet(ctx, assignKey("123"), lease.SandboxID, lease.Type).Err())
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now(), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("provider should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ApplySandbox(ctx, "123", lease.Type)
	require.NoError(t, err)
	require.Nil(t, result)

	storedLease := loadLease(t, ctx, rds, lease.SandboxID)
	require.Equal(t, "456", storedLease.User)
	require.False(t, storedLease.InUse)
	require.Equal(t, 0, provider.calls)
}

func TestEmulatorProviderListResourcesReturnsErrorWhenAllEndpointsFail(t *testing.T) {
	t.Parallel()

	p := &EmulatorProvider{
		BaseURLs: []string{"http://127.0.0.1:1"},
		http:     newHTTPClient(200 * time.Millisecond),
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	resources, err := p.ListResources(ctx)
	require.Error(t, err)
	require.Nil(t, resources)
}

func TestEmulatorProviderListResourcesSucceedsWhenAnyEndpointSucceeds(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(
			`{"devices":[{"device_index":3,"adb_host":"127.0.0.1",` +
				`"adb_port":16480,"view_url":"/vnc/view/3"}]}`,
		))
	}))
	defer server.Close()

	p := &EmulatorProvider{
		BaseURLs: []string{"http://127.0.0.1:1", server.URL},
		http:     newHTTPClient(time.Second),
	}

	resources, err := p.ListResources(context.Background())
	require.NoError(t, err)
	require.Len(t, resources, 1)
	require.Equal(t, server.URL+"|3", resources[0].ResourceID)
	require.Equal(t, "16480", resources[0].Metadata["adbPort"])
	require.Equal(t, server.URL, resources[0].Metadata["providerBaseUrl"])
}

func TestStaleSnapshotDegradesToUnhealthyAfterThreshold(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	resource := testEmulatorResource(ResourceStatusAvailable)
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now().Add(-65*time.Second), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("should not be called")},
	}
	pool := newTestPool(rds, provider, time.Minute)
	svc := &Service{Pool: pool}

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusUnhealthy), emulatorResources[0]["status"])
	require.Equal(t, false, emulatorResources[0]["allocatable"])
	require.Equal(t, 0, provider.calls)
}

func TestStaleSnapshotDegradesToUnavailableAfterThreshold(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	resource := testEmulatorResource(ResourceStatusAvailable)
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now().Add(-125*time.Second), resource)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("should not be called")},
	}
	pool := newTestPool(rds, provider, time.Minute)
	svc := &Service{Pool: pool}

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 0, "unavailable resources should be filtered from list")
	require.Equal(t, 0, provider.calls)
}

func TestStaleSnapshotKeepsAlreadyUnhealthyResource(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	resource := testEmulatorResource(ResourceStatusUnhealthy)
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now().Add(-65*time.Second), resource)

	pool := newTestPool(rds, &fakeProvider{providerType: enum.SandboxTypeEmulator.String()}, time.Minute)
	svc := &Service{Pool: pool}

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusUnhealthy), emulatorResources[0]["status"])
}

func TestApplySandboxReturnsNilWhenSnapshotIsStaleAndDegraded(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now().Add(-65*time.Second), testEmulatorResource(ResourceStatusAvailable),
	)

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{errors.New("should not be called")},
	}
	svc := &Service{Pool: newTestPool(rds, provider, time.Minute)}

	result, err := svc.ApplySandbox(ctx, lease.User, lease.Type)
	require.NoError(t, err)
	require.Nil(t, result, "no sandbox should be available when snapshot is stale and degraded")
	require.Equal(t, 0, provider.calls)
}

func TestGetInstanceSandboxesWithStatusShowsUnhealthyWhenSnapshotIsStale(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now().Add(-65*time.Second), testEmulatorResource(ResourceStatusAvailable),
	)

	pool := newTestPool(rds, &fakeProvider{providerType: enum.SandboxTypeEmulator.String()}, time.Minute)
	svc := &Service{Pool: pool}

	result, err := svc.GetInstanceSandboxesWithStatus(ctx, lease.User, "")
	require.NoError(t, err)
	require.Len(t, result, 1)
	require.Equal(t, string(ResourceStatusUnhealthy), result[0]["status"])
}

func TestRefreshResourcesRenewsLeadershipDuringLongRefresh(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	emulator := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses:    [][]*Resource{{testEmulatorResource(ResourceStatusAvailable)}},
	}
	pool := newTestPoolWithProviders(rds, time.Minute, emulator)
	pool.refreshLeaderTTL = 3 * time.Second

	require.NoError(t, pool.refreshResources(ctx))

	leaderTTL := rds.TTL(ctx, resourceSnapshotLeaderKey).Val()
	require.Greater(t, leaderTTL, time.Duration(0))
	require.LessOrEqual(t, leaderTTL, 3*time.Second)

	leaderID, err := rds.Get(ctx, resourceSnapshotLeaderKey).Result()
	require.NoError(t, err)
	require.Equal(t, pool.instanceID, leaderID)
}

func TestStaleSnapshotDegradationIsPerType(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	// emulator snapshot is stale (>60s) → should degrade to unhealthy
	seedSnapshot(
		t, ctx, rds, enum.SandboxTypeEmulator.String(),
		time.Now().Add(-65*time.Second), testEmulatorResource(ResourceStatusAvailable),
	)

	emulator := &fakeProvider{providerType: enum.SandboxTypeEmulator.String()}
	pool := newTestPoolWithProviders(rds, time.Minute, emulator)
	svc := &Service{Pool: pool}

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)

	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 1)
	require.Equal(t, string(ResourceStatusUnhealthy), emulatorResources[0]["status"],
		"stale emulator snapshot should degrade to unhealthy")
}

func TestPendingShrinkMergesCurrentResourceState(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	resourceA := testEmulatorResource(ResourceStatusAvailable)
	resourceB := &Resource{
		Type:       enum.SandboxTypeEmulator.String(),
		ResourceID: "http://74.179.80.110:8000|10",
		Status:     ResourceStatusAvailable,
		Metadata:   map[string]string{"adbAddress": "74.179.80.110:16704"},
	}

	resourceAUnhealthy := &Resource{
		Type:       resourceA.Type,
		ResourceID: resourceA.ResourceID,
		Status:     ResourceStatusUnhealthy,
		Metadata:   map[string]string{"adbAddress": "74.179.80.110:99999"},
	}

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{resourceA, resourceB},
			{resourceAUnhealthy},
		},
	}
	pool := newTestPool(rds, provider, time.Minute)
	svc := &Service{Pool: pool}

	// First refresh: both resources available.
	require.NoError(t, pool.refreshResources(ctx))

	// Second refresh: A becomes unhealthy, B disappears → pending shrink.
	require.NoError(t, pool.refreshResources(ctx))

	result, err := svc.ListAllResources(ctx)
	require.NoError(t, err)
	emulatorResources := result[enum.SandboxTypeEmulator.String()].([]map[string]interface{})
	require.Len(t, emulatorResources, 2)

	statusByID := map[string]string{}
	allocatableByID := map[string]bool{}
	for _, r := range emulatorResources {
		rid := r["resource_id"].(string)
		statusByID[rid] = r["status"].(string)
		allocatableByID[rid] = r["allocatable"].(bool)
	}

	// A: should reflect current unhealthy status, not frozen old available.
	require.Equal(t, string(ResourceStatusUnhealthy), statusByID[resourceA.ResourceID],
		"present resource should reflect current provider status during pending shrink")
	require.Equal(t, false, allocatableByID[resourceA.ResourceID],
		"unhealthy resource should not be allocatable")

	// B: missing, should have MissingSinceAt → not allocatable.
	require.Equal(t, string(ResourceStatusAvailable), statusByID[resourceB.ResourceID],
		"missing resource keeps previous status during pending shrink")
	require.Equal(t, false, allocatableByID[resourceB.ResourceID],
		"missing resource should not be allocatable during pending shrink")

	// Verify snapshot directly: A's metadata should be updated from current provider response.
	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	snapshotByID := map[string]*Resource{}
	for _, r := range snapshot.Resources {
		snapshotByID[r.ResourceID] = r
	}
	require.Equal(t, "74.179.80.110:99999", snapshotByID[resourceA.ResourceID].Metadata["adbAddress"],
		"present resource metadata should be updated from current provider response")
	require.Nil(t, snapshotByID[resourceA.ResourceID].MissingSinceAt)
	require.NotNil(t, snapshotByID[resourceB.ResourceID].MissingSinceAt)
}
