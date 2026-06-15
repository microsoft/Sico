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
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	redislock "sico-backend/internal/infra/cache/redis"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

type Pool struct {
	providers map[string]Provider
	rds       *redis.Client

	refreshInterval          time.Duration
	refreshMu                sync.Mutex
	providerFailureCount     map[string]int
	providerLastSuccessAt    map[string]time.Time
	missingLeaseMarkAfter    time.Duration
	missingLeaseHideAfter    time.Duration
	missingLeaseDeleteAfter  time.Duration
	instanceID               string
	refreshLeaderTTL         time.Duration
	shrinkConfirmations      int
	snapshotUnhealthyAfter   time.Duration
	snapshotUnavailableAfter time.Duration
}

// GetProvider returns the provider for a given sandbox type
func (p *Pool) GetProvider(sandboxType string) (Provider, bool) {
	if p == nil || p.providers == nil {
		return nil, false
	}
	prov, ok := p.providers[sandboxType]
	return prov, ok
}

// GetRedis returns the Redis client
func (p *Pool) GetRedis() *redis.Client {
	if p == nil {
		return nil
	}
	return p.rds
}

func NewPool(emulator *EmulatorProvider, rds *redis.Client) *Pool {
	providers := map[string]Provider{}
	if emulator != nil {
		providers[emulator.Type()] = emulator
	}

	pool := &Pool{
		providers:                providers,
		rds:                      rds,
		refreshInterval:          15 * time.Second,
		providerFailureCount:     make(map[string]int, len(providers)),
		providerLastSuccessAt:    make(map[string]time.Time, len(providers)),
		missingLeaseMarkAfter:    30 * time.Second,
		missingLeaseHideAfter:    time.Minute,
		missingLeaseDeleteAfter:  24 * time.Hour,
		instanceID:               newPoolInstanceID(),
		shrinkConfirmations:      2,
		snapshotUnhealthyAfter:   60 * time.Second,
		snapshotUnavailableAfter: 2 * time.Minute,
	}

	pool.startBackgroundRefresh()

	return pool
}

// ListResourcesResult holds the provider inventory view plus lease metadata
// for resources that are still considered part of the current inventory.
type ListResourcesResult struct {
	Resources   []*sandboxdto.SandboxResource
	Leases      map[string]*Lease // key: SandboxID
	Allocatable map[string]bool   // key: SandboxID
}

var errSnapshotRefreshInProgress = errors.New("sandbox resource snapshot refresh in progress")

type pendingShrinkState struct {
	Type               string    `json:"type"`
	BaseSignature      string    `json:"baseSignature"`
	CandidateSignature string    `json:"candidateSignature"`
	Attempts           int       `json:"attempts"`
	SeenAt             time.Time `json:"seenAt"`
}

type resolvedResourceCacheTestHookKey struct{}

const (
	resolvedResourceCacheStageSnapshot = "snapshot"
	resolvedResourceCacheStageLease    = "lease"
)

func (p *Pool) ListResources(ctx context.Context, typeFilter string) (*ListResourcesResult, error) {
	resources, _, ok, err := p.loadSnapshotResources(ctx, typeFilter)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("sandbox resource snapshot unavailable")
	}

	leaseByResourceKey, err := p.loadLeasesByResourceKey(ctx, typeFilter)
	if err != nil {
		return nil, err
	}

	return p.buildListResourcesResult(resources, leaseByResourceKey), nil
}

func (p *Pool) buildListResourcesResult(resources []*Resource, leaseByResourceKey map[string]*Lease) *ListResourcesResult {
	result := &ListResourcesResult{
		Leases:      make(map[string]*Lease),
		Allocatable: make(map[string]bool),
	}
	snapshotResourceKeys := make(map[string]struct{}, len(resources))
	now := time.Now()

	for _, r := range resources {
		if r == nil {
			continue
		}

		key := resourceKey(r.Type, r.ResourceID)
		snapshotResourceKeys[key] = struct{}{}
		if r.Status == ResourceStatusUnavailable {
			continue
		}

		appendSnapshotResourceEntry(result, r, leaseByResourceKey[key])
	}

	for key, lease := range leaseByResourceKey {
		if _, exists := snapshotResourceKeys[key]; exists {
			continue
		}
		p.appendMissingLeaseResource(result, lease, now)
	}

	return result
}

func appendSnapshotResourceEntry(result *ListResourcesResult, r *Resource, lease *Lease) {
	res := &sandboxdto.SandboxResource{
		Type:        r.Type,
		ResourceId:  r.ResourceID,
		DisplayName: r.DisplayName,
		Status:      string(r.Status),
		Metadata:    cloneMetadata(r.Metadata),
	}
	sandboxID := r.Type + ":" + r.ResourceID

	if lease != nil {
		if r.Status == ResourceStatusAvailable {
			if lease.InUse {
				res.Status = string(ResourceStatusInUse)
			} else {
				res.Status = string(ResourceStatusAssigned)
			}
		}
		res.SandboxId = lease.SandboxID
		sandboxID = lease.SandboxID
		result.Leases[lease.SandboxID] = lease
	}
	result.Allocatable[sandboxID] = r.Status == ResourceStatusAvailable &&
		r.MissingSinceAt == nil &&
		res.SandboxId == ""

	result.Resources = append(result.Resources, res)
}

func (p *Pool) appendMissingLeaseResource(result *ListResourcesResult, lease *Lease, now time.Time) {
	if lease == nil || lease.Type == "" || lease.ResourceID == "" || lease.SandboxID == "" {
		return
	}
	if !p.shouldDisplayMissingLease(lease, now) {
		return
	}

	result.Resources = append(result.Resources, &sandboxdto.SandboxResource{
		Type:       lease.Type,
		ResourceId: lease.ResourceID,
		Status:     string(ResourceStatusUnhealthy),
		SandboxId:  lease.SandboxID,
		Metadata:   cloneMetadata(lease.Metadata),
	})
	result.Leases[lease.SandboxID] = lease
	result.Allocatable[lease.SandboxID] = false
}

func (p *Pool) loadLeasesByResourceKey(ctx context.Context, typeFilter string) (map[string]*Lease, error) {
	leaseByResourceKey := map[string]*Lease{}
	if p == nil || p.rds == nil {
		return leaseByResourceKey, nil
	}

	keys, err := p.scanResourceKeys(ctx)
	if err != nil || len(keys) == 0 {
		return leaseByResourceKey, err
	}

	filteredKeys := make([]string, 0, len(keys))
	for _, key := range keys {
		if typeFilter != "" && extractTypeFromResourceKey(key) != typeFilter {
			continue
		}
		filteredKeys = append(filteredKeys, key)
	}

	if len(filteredKeys) == 0 {
		return leaseByResourceKey, nil
	}

	leaseVals, err := p.rds.MGet(ctx, filteredKeys...).Result()
	if err != nil {
		return nil, err
	}

	for i, key := range filteredKeys {
		if i >= len(leaseVals) {
			continue
		}

		raw, ok := leaseVals[i].(string)
		if !ok || raw == "" {
			continue
		}

		var lease Lease
		if err := json.Unmarshal([]byte(raw), &lease); err != nil {
			continue
		}
		leaseByResourceKey[key] = &lease
	}

	return leaseByResourceKey, nil
}

func (p *Pool) startBackgroundRefresh() {
	if p == nil || len(p.providers) == 0 || p.refreshInterval <= 0 {
		return
	}

	safego.Go(context.Background(), func() {
		p.runBackgroundRefreshOnce()

		ticker := time.NewTicker(p.refreshInterval)
		defer ticker.Stop()
		for range ticker.C {
			p.runBackgroundRefreshOnce()
		}
	})
}

func (p *Pool) runBackgroundRefreshOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := p.refreshResources(ctx); err != nil && !errors.Is(err, errSnapshotRefreshInProgress) {
		logger.Warn("sandbox resources background refresh failed: %v", err)
	}
}

func (p *Pool) loadSnapshotResources(ctx context.Context, typeFilter string) ([]*Resource, time.Duration, bool, error) {
	if p == nil {
		return []*Resource{}, 0, true, nil
	}
	if p.rds == nil {
		return nil, 0, false, fmt.Errorf("sandbox snapshot storage unavailable")
	}

	types := p.snapshotTypes(typeFilter)
	if len(types) == 0 {
		return []*Resource{}, 0, true, nil
	}

	resources := make([]*Resource, 0)
	maxSnapshotAge := time.Duration(0)
	found := false
	for _, snapshotType := range types {
		snapshot, err := p.loadTypeSnapshot(ctx, snapshotType)
		if err != nil {
			return nil, 0, false, err
		}
		if snapshot == nil {
			continue
		}

		found = true
		typeAge := time.Duration(0)
		if !snapshot.RefreshedAt.IsZero() {
			typeAge = time.Since(snapshot.RefreshedAt)
			if typeAge < 0 {
				typeAge = 0
			}
			if typeAge > maxSnapshotAge {
				maxSnapshotAge = typeAge
			}
		}
		typeResources := cloneResources(snapshot.Resources)
		typeResources = p.degradeResourcesForStaleSnapshot(typeResources, typeAge)
		resources = append(resources, typeResources...)
	}

	if !found {
		return nil, 0, false, nil
	}

	return resources, maxSnapshotAge, true, nil
}

func (p *Pool) degradeResourcesForStaleSnapshot(resources []*Resource, snapshotAge time.Duration) []*Resource {
	if p == nil || len(resources) == 0 {
		return resources
	}

	unavailableAfter := p.snapshotUnavailableAfter
	unhealthyAfter := p.snapshotUnhealthyAfter

	if unavailableAfter <= 0 && unhealthyAfter <= 0 {
		return resources
	}

	degradeToUnavailable := unavailableAfter > 0 && snapshotAge > unavailableAfter
	degradeToUnhealthy := !degradeToUnavailable && unhealthyAfter > 0 && snapshotAge > unhealthyAfter

	if !degradeToUnavailable && !degradeToUnhealthy {
		return resources
	}

	for _, r := range resources {
		if r == nil {
			continue
		}
		applyStaleDegradeToResource(r, degradeToUnavailable, degradeToUnhealthy)
	}

	return resources
}

func applyStaleDegradeToResource(r *Resource, degradeToUnavailable, degradeToUnhealthy bool) {
	if degradeToUnavailable {
		if r.Status != ResourceStatusUnavailable {
			r.Status = ResourceStatusUnavailable
		}
		return
	}

	if degradeToUnhealthy && r.Status == ResourceStatusAvailable {
		r.Status = ResourceStatusUnhealthy
	}
}

func (p *Pool) loadTypeSnapshot(ctx context.Context, snapshotType string) (*ResourceSnapshot, error) {
	if p == nil || p.rds == nil || strings.TrimSpace(snapshotType) == "" {
		return nil, nil
	}

	val, err := p.rds.Get(ctx, resourceSnapshotKey(snapshotType)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}

	var snapshot ResourceSnapshot
	if err := json.Unmarshal([]byte(val), &snapshot); err != nil {
		return nil, err
	}
	return &snapshot, nil
}

func (p *Pool) persistTypeSnapshots(ctx context.Context, snapshots ...*ResourceSnapshot) error {
	if p == nil || p.rds == nil || len(snapshots) == 0 {
		return nil
	}

	type snapshotPayload struct {
		key     string
		payload string
	}
	payloads := make([]snapshotPayload, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if snapshot == nil || strings.TrimSpace(snapshot.Type) == "" {
			continue
		}

		payload, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		payloads = append(payloads, snapshotPayload{
			key:     resourceSnapshotKey(snapshot.Type),
			payload: string(payload),
		})
	}
	if len(payloads) == 0 {
		return nil
	}

	_, err := p.rds.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, payload := range payloads {
			pipe.Set(ctx, payload.key, payload.payload, 0)
		}
		return nil
	})
	return err
}

func (p *Pool) refreshResources(ctx context.Context) (returnErr error) {
	if p == nil || len(p.providers) == 0 {
		return nil
	}
	if p.rds == nil {
		return fmt.Errorf("sandbox snapshot storage unavailable")
	}

	p.refreshMu.Lock()
	defer p.refreshMu.Unlock()

	isLeader, err := p.tryAcquireRefreshLeadership(ctx)
	if err != nil {
		return err
	}
	if !isLeader {
		return errSnapshotRefreshInProgress
	}
	releaseLeadership := false
	defer func() {
		if !releaseLeadership && returnErr == nil {
			return
		}
		if releaseErr := p.releaseRefreshLeadership(context.Background()); releaseErr != nil {
			logger.CtxWarn(ctx, "refreshResources: failed to release snapshot refresh leadership: %v", releaseErr)
		}
	}()

	previousSnapshots, hadSnapshot, err := p.loadPreviousSnapshots(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	loop, err := p.runProviderRefreshLoop(ctx, previousSnapshots, now)
	if err != nil {
		return err
	}

	if persistErr := p.persistTypeSnapshots(ctx, loop.nextSnapshots...); persistErr != nil {
		return persistErr
	}

	deleted, reconcileErr := p.reconcileLeaseProviderState(ctx, loop.observedResourceStatusByType, now)
	if reconcileErr != nil {
		logger.CtxWarn(ctx, "refreshResources: failed to reconcile missing lease state: %v", reconcileErr)
	} else if deleted > 0 {
		logger.CtxInfo(ctx, "refreshResources: removed %d expired missing sandbox lease(s)", deleted)
	}

	if loop.refreshedProviders > 0 {
		logger.CtxInfo(ctx, "sandbox resource snapshot refreshed in redis: providers=%d", loop.refreshedProviders)
	}

	release, finalErr := finalizeRefreshOutcome(loop, hadSnapshot)
	releaseLeadership = release
	return finalErr
}

type providerLoopResult struct {
	observedResourceStatusByType map[string]map[string]ResourceStatus
	nextSnapshots                []*ResourceSnapshot
	successfulProviders          int
	refreshedProviders           int
	firstRefreshErr              error
}

func (p *Pool) runProviderRefreshLoop(
	ctx context.Context, previousSnapshots map[string]*ResourceSnapshot, now time.Time,
) (*providerLoopResult, error) {
	result := &providerLoopResult{
		observedResourceStatusByType: make(map[string]map[string]ResourceStatus, len(p.providers)),
		nextSnapshots:                make([]*ResourceSnapshot, 0, len(p.providers)),
	}

	for _, snapshotType := range p.snapshotTypes("") {
		prov := p.providers[snapshotType]
		if prov == nil {
			continue
		}

		outcome, loopErr := p.refreshProviderSnapshot(ctx, snapshotType, prov, previousSnapshots[snapshotType], now)
		if loopErr != nil {
			return nil, loopErr
		}

		if outcome.providerErr != nil {
			if result.firstRefreshErr == nil {
				result.firstRefreshErr = outcome.providerErr
			}
			continue
		}

		result.successfulProviders++
		if outcome.snapshot == nil {
			continue
		}

		result.observedResourceStatusByType[snapshotType] = outcome.statuses
		result.nextSnapshots = append(result.nextSnapshots, outcome.snapshot)
		result.refreshedProviders++
	}

	return result, nil
}

// finalizeRefreshOutcome determines whether the leader lease should be released
// and what error (if any) refreshResources should surface. Returns (releaseLeadership, err).
func finalizeRefreshOutcome(loop *providerLoopResult, hadSnapshot bool) (bool, error) {
	if loop.successfulProviders == 0 && !hadSnapshot {
		if loop.firstRefreshErr != nil {
			return true, fmt.Errorf("no sandbox resource snapshots available: %w", loop.firstRefreshErr)
		}
		return true, fmt.Errorf("no sandbox resource snapshots available")
	}
	if loop.successfulProviders == 0 && loop.firstRefreshErr != nil {
		return true, nil
	}

	return false, nil
}

func (p *Pool) loadPreviousSnapshots(ctx context.Context) (map[string]*ResourceSnapshot, bool, error) {
	previousSnapshots := make(map[string]*ResourceSnapshot, len(p.providers))
	hadSnapshot := false

	for _, snapshotType := range p.snapshotTypes("") {
		snapshot, err := p.loadTypeSnapshot(ctx, snapshotType)
		if err != nil {
			return nil, false, err
		}
		previousSnapshots[snapshotType] = snapshot
		if snapshot != nil {
			hadSnapshot = true
		}
	}

	return previousSnapshots, hadSnapshot, nil
}

type providerRefreshOutcome struct {
	providerErr error
	snapshot    *ResourceSnapshot
	statuses    map[string]ResourceStatus
}

// refreshProviderSnapshot handles a single provider's refresh cycle. It returns
// a non-nil error only for fatal conditions (pending-shrink clear failure,
// leadership loss, accept-decision errors) that should abort the outer refresh.
// Provider listing failures are reported via outcome.providerErr so the caller
// can continue with other providers.
func (p *Pool) refreshProviderSnapshot(
	ctx context.Context,
	snapshotType string,
	prov Provider,
	previousSnapshot *ResourceSnapshot,
	now time.Time,
) (providerRefreshOutcome, error) {
	currentResources, err := prov.ListResources(ctx)
	if err != nil {
		if clearErr := p.clearPendingShrink(ctx, snapshotType); clearErr != nil {
			return providerRefreshOutcome{}, clearErr
		}
		p.providerFailureCount[snapshotType]++
		logger.CtxWarn(
			ctx,
			"refreshResources: failed to list resources for %s: %v "+
				"(failure_count=%d last_success_ago=%s keep_previous_snapshot=%t)",
			snapshotType,
			err,
			p.providerFailureCount[snapshotType],
			p.providerLastSuccessAge(snapshotType),
			previousSnapshot != nil,
		)
		return providerRefreshOutcome{providerErr: err}, nil
	}

	p.recordProviderSuccess(snapshotType)

	// Renew leadership lease after each successful provider call to prevent
	// lease expiry during long multi-provider refresh operations.
	if renewErr := p.renewRefreshLeadership(ctx); renewErr != nil {
		logger.CtxWarn(ctx, "refreshResources: lost leadership during refresh for %s: %v", snapshotType, renewErr)
		return providerRefreshOutcome{}, renewErr
	}

	acceptedStatuses, acceptedSnapshot, stateChanged, decideErr := p.buildAcceptedSnapshot(
		ctx, snapshotType, previousSnapshot, currentResources, now,
	)
	if decideErr != nil {
		return providerRefreshOutcome{}, decideErr
	}
	if acceptedSnapshot == nil {
		return providerRefreshOutcome{}, nil
	}
	if stateChanged {
		logger.CtxInfo(
			ctx,
			"sandbox snapshot acceptance changed for %s: resources=%d",
			snapshotType, len(acceptedSnapshot.Resources),
		)
	}

	return providerRefreshOutcome{
		snapshot: acceptedSnapshot,
		statuses: acceptedStatuses,
	}, nil
}

func (p *Pool) buildAcceptedSnapshot(
	ctx context.Context,
	snapshotType string,
	previousSnapshot *ResourceSnapshot,
	currentResources []*Resource,
	now time.Time,
) (map[string]ResourceStatus, *ResourceSnapshot, bool, error) {
	currentStatuses := resourceStatusMap(currentResources)
	missingIDs := missingObservedResourceIDs(previousSnapshot, currentResources)
	if len(missingIDs) == 0 {
		if err := p.clearPendingShrink(ctx, snapshotType); err != nil {
			return nil, nil, false, err
		}
		var previousResources []*Resource
		if previousSnapshot != nil {
			previousResources = previousSnapshot.Resources
		}
		nextResources := p.buildNextSnapshotResources(currentResources, previousResources, now)
		return currentStatuses, &ResourceSnapshot{
			Type: snapshotType, RefreshedAt: now, Resources: nextResources,
		}, false, nil
	}

	pending, err := p.loadPendingShrink(ctx, snapshotType)
	if err != nil {
		return nil, nil, false, err
	}
	baseSignature := snapshotObservedSignature(previousSnapshot)
	candidateSignature := resourceStateSignature(currentResources)
	attempts := 1
	if pending != nil &&
		pending.BaseSignature == baseSignature &&
		pending.CandidateSignature == candidateSignature &&
		!pending.SeenAt.IsZero() &&
		now.Sub(pending.SeenAt) <= p.pendingShrinkWindowDuration() {
		attempts = pending.Attempts + 1
	}

	if attempts < p.requiredShrinkConfirmations() {
		nextPending := &pendingShrinkState{
			Type:               snapshotType,
			BaseSignature:      baseSignature,
			CandidateSignature: candidateSignature,
			Attempts:           attempts,
			SeenAt:             now,
		}
		if err := p.persistPendingShrink(ctx, nextPending); err != nil {
			return nil, nil, false, err
		}
		logger.CtxWarn(
			ctx,
			"refreshResources: delaying snapshot shrink for %s missing=%d attempts=%d",
			snapshotType, len(missingIDs), attempts,
		)
		delayedSnapshot := cloneSnapshotWithRefreshedAt(previousSnapshot, now)
		mergeCurrentResourceState(delayedSnapshot, currentResources, now)
		markMissingSinceAt(delayedSnapshot, missingIDs, now)
		delayedStatuses := snapshotObservedStatusMap(previousSnapshot)
		for k, v := range currentStatuses {
			delayedStatuses[k] = v
		}
		return delayedStatuses, delayedSnapshot, false, nil
	}

	if err := p.clearPendingShrink(ctx, snapshotType); err != nil {
		return nil, nil, false, err
	}
	logger.CtxWarn(
		ctx,
		"refreshResources: accepting confirmed snapshot shrink for %s missing=%d attempts=%d",
		snapshotType, len(missingIDs), attempts,
	)

	var previousResources []*Resource
	if previousSnapshot != nil {
		previousResources = previousSnapshot.Resources
	}
	nextResources := p.buildNextSnapshotResources(currentResources, previousResources, now)
	return currentStatuses, &ResourceSnapshot{Type: snapshotType, RefreshedAt: now, Resources: nextResources}, true, nil
}

func (p *Pool) recordProviderSuccess(providerType string) {
	if p == nil {
		return
	}
	p.providerFailureCount[providerType] = 0
	p.providerLastSuccessAt[providerType] = time.Now()
}

func (p *Pool) providerLastSuccessAge(providerType string) string {
	if p == nil {
		return "never"
	}

	lastSuccessAt, ok := p.providerLastSuccessAt[providerType]
	if !ok || lastSuccessAt.IsZero() {
		return "never"
	}

	age := time.Since(lastSuccessAt)
	if age < 0 {
		age = 0
	}

	return age.Round(time.Second).String()
}

func (p *Pool) tryAcquireRefreshLeadership(ctx context.Context) (bool, error) {
	if p == nil || p.rds == nil {
		return false, nil
	}
	instanceID := strings.TrimSpace(p.instanceID)
	if instanceID == "" {
		instanceID = newPoolInstanceID()
		p.instanceID = instanceID
	}

	return redislock.AcquireLockNonblockingWithValue(
		ctx, p.rds, resourceSnapshotLeaderKey, instanceID,
		int(p.refreshLeaderLeaseTTLDuration()/time.Second),
	)
}

func (p *Pool) releaseRefreshLeadership(ctx context.Context) error {
	if p == nil || p.rds == nil {
		return nil
	}
	instanceID := strings.TrimSpace(p.instanceID)
	if instanceID == "" {
		return nil
	}
	return redislock.ReleaseLock(ctx, p.rds, resourceSnapshotLeaderKey, instanceID)
}

func (p *Pool) renewRefreshLeadership(ctx context.Context) error {
	acquired, err := p.tryAcquireRefreshLeadership(ctx)
	if err != nil {
		return fmt.Errorf("failed to renew refresh leadership: %w", err)
	}
	if !acquired {
		return fmt.Errorf("lost refresh leadership during renewal")
	}
	return nil
}

func (p *Pool) refreshLeaderLeaseTTLDuration() time.Duration {
	if p == nil {
		return 20 * time.Second
	}
	if p.refreshLeaderTTL > 0 {
		return p.refreshLeaderTTL
	}
	ttl := 20 * time.Second
	if p.refreshInterval > 0 {
		minTTL := p.refreshInterval + 5*time.Second
		if ttl < minTTL {
			ttl = minTTL
		}
	}
	return ttl
}

func (p *Pool) requiredShrinkConfirmations() int {
	if p == nil || p.shrinkConfirmations <= 0 {
		return 2
	}
	return p.shrinkConfirmations
}

func (p *Pool) snapshotTypes(typeFilter string) []string {
	if strings.TrimSpace(typeFilter) != "" {
		return []string{typeFilter}
	}

	types := make([]string, 0, len(p.providers))
	for snapshotType := range p.providers {
		types = append(types, snapshotType)
	}
	sort.Strings(types)
	return types
}

func resourceStatusMap(resources []*Resource) map[string]ResourceStatus {
	statuses := make(map[string]ResourceStatus, len(resources))
	for _, resource := range resources {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		statuses[resourceKey(resource.Type, resource.ResourceID)] = normalizeProviderResourceStatus(resource.Status)
	}
	return statuses
}

func resourceStateSignature(resources []*Resource) string {
	parts := make([]string, 0, len(resources))
	for _, resource := range resources {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		parts = append(parts,
			resourceKey(resource.Type, resource.ResourceID)+"="+
				string(normalizeProviderResourceStatus(resource.Status)),
		)
	}
	sort.Strings(parts)
	return strings.Join(parts, "|")
}

func snapshotObservedStatusMap(snapshot *ResourceSnapshot) map[string]ResourceStatus {
	statuses := map[string]ResourceStatus{}
	for _, resource := range snapshotObservedResources(snapshot) {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		statuses[resourceKey(resource.Type, resource.ResourceID)] =
			normalizeProviderResourceStatus(resource.Status)
	}
	return statuses
}

func missingObservedResourceIDs(snapshot *ResourceSnapshot, current []*Resource) []string {
	if snapshot == nil {
		return nil
	}
	previousObserved := snapshotObservedResources(snapshot)
	if len(previousObserved) == 0 {
		return nil
	}
	currentIDs := make(map[string]struct{}, len(current))
	for _, resource := range current {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		currentIDs[resource.ResourceID] = struct{}{}
	}

	missing := make([]string, 0)
	for _, resource := range previousObserved {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		if _, ok := currentIDs[resource.ResourceID]; ok {
			continue
		}
		missing = append(missing, resource.ResourceID)
	}
	sort.Strings(missing)
	return missing
}

func snapshotObservedResources(snapshot *ResourceSnapshot) []*Resource {
	if snapshot == nil || snapshot.RefreshedAt.IsZero() {
		return nil
	}
	resources := make([]*Resource, 0, len(snapshot.Resources))
	for _, resource := range snapshot.Resources {
		if resource == nil || resource.LastSeenAt == nil || !resource.LastSeenAt.Equal(snapshot.RefreshedAt) {
			continue
		}
		resources = append(resources, resource)
	}
	return resources
}

func snapshotObservedSignature(snapshot *ResourceSnapshot) string {
	return resourceStateSignature(snapshotObservedResources(snapshot))
}

func cloneSnapshotWithRefreshedAt(snapshot *ResourceSnapshot, refreshedAt time.Time) *ResourceSnapshot {
	if snapshot == nil {
		return nil
	}
	resources := cloneResources(snapshot.Resources)
	for _, resource := range resources {
		if resource == nil || resource.LastSeenAt == nil || !resource.LastSeenAt.Equal(snapshot.RefreshedAt) {
			continue
		}
		updated := refreshedAt
		resource.LastSeenAt = &updated
	}
	return &ResourceSnapshot{
		Type:        snapshot.Type,
		RefreshedAt: refreshedAt,
		Resources:   resources,
	}
}

func markMissingSinceAt(snapshot *ResourceSnapshot, missingIDs []string, now time.Time) {
	if snapshot == nil || len(missingIDs) == 0 {
		return
	}
	missingSet := make(map[string]struct{}, len(missingIDs))
	for _, id := range missingIDs {
		missingSet[id] = struct{}{}
	}
	for _, resource := range snapshot.Resources {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		if _, ok := missingSet[resource.ResourceID]; ok && resource.MissingSinceAt == nil {
			missingSince := now
			resource.MissingSinceAt = &missingSince
		}
	}
}

func mergeCurrentResourceState(snapshot *ResourceSnapshot, currentResources []*Resource, now time.Time) {
	if snapshot == nil || len(currentResources) == 0 {
		return
	}
	currentByID := make(map[string]*Resource, len(currentResources))
	for _, r := range currentResources {
		if r == nil || r.ResourceID == "" {
			continue
		}
		currentByID[r.ResourceID] = r
	}
	lastSeen := now
	for _, resource := range snapshot.Resources {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		current, ok := currentByID[resource.ResourceID]
		if !ok {
			continue
		}
		resource.Status = normalizeProviderResourceStatus(current.Status)
		resource.DisplayName = current.DisplayName
		resource.Metadata = cloneMetadata(current.Metadata)
		resource.LastSeenAt = &lastSeen
		resource.MissingSinceAt = nil
	}
}

func (p *Pool) loadPendingShrink(ctx context.Context, snapshotType string) (*pendingShrinkState, error) {
	if p == nil || p.rds == nil || strings.TrimSpace(snapshotType) == "" {
		return nil, nil
	}
	val, err := p.rds.Get(ctx, resourcePendingShrinkKey(snapshotType)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	var state pendingShrinkState
	if err := json.Unmarshal([]byte(val), &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (p *Pool) persistPendingShrink(ctx context.Context, state *pendingShrinkState) error {
	if p == nil || p.rds == nil || state == nil || strings.TrimSpace(state.Type) == "" {
		return nil
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return p.rds.Set(ctx, resourcePendingShrinkKey(state.Type), string(payload), p.pendingShrinkTTLDuration()).Err()
}

func (p *Pool) clearPendingShrink(ctx context.Context, snapshotType string) error {
	if p == nil || p.rds == nil || strings.TrimSpace(snapshotType) == "" {
		return nil
	}
	return p.rds.Del(ctx, resourcePendingShrinkKey(snapshotType)).Err()
}

func newPoolInstanceID() string {
	hostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostname) == "" {
		hostname = "sandbox-pool"
	}
	return hostname + ":" + uuid.NewString()
}

func (p *Pool) pendingShrinkWindowDuration() time.Duration {
	if p == nil {
		return 35 * time.Second
	}
	if p.refreshInterval > 0 {
		return p.refreshInterval*2 + 5*time.Second
	}
	return 35 * time.Second
}

func (p *Pool) pendingShrinkTTLDuration() time.Duration {
	window := p.pendingShrinkWindowDuration()
	confirmations := time.Duration(p.requiredShrinkConfirmations())
	if confirmations <= 0 {
		confirmations = 2
	}
	return window * confirmations
}

func (p *Pool) buildNextSnapshotResources(current, prev []*Resource, now time.Time) []*Resource {
	next := make([]*Resource, 0, len(current)+len(prev))
	currentKeys := make(map[string]struct{}, len(current))
	prevByKey := make(map[string]*Resource, len(prev))

	for _, resource := range prev {
		if resource == nil {
			continue
		}
		prevByKey[resourceKey(resource.Type, resource.ResourceID)] = resource
	}

	for _, resource := range current {
		if resource == nil {
			continue
		}
		key := resourceKey(resource.Type, resource.ResourceID)
		currentKeys[key] = struct{}{}
		next = append(next, p.nextSnapshotResourceFromCurrent(resource, prevByKey[key], now))
	}

	for _, resource := range prev {
		if resource == nil {
			continue
		}
		key := resourceKey(resource.Type, resource.ResourceID)
		if _, exists := currentKeys[key]; exists {
			continue
		}
		next = append(next, p.nextSnapshotResourceFromMissing(resource, now))
	}

	return next
}

func (p *Pool) nextSnapshotResourceFromCurrent(resource, prev *Resource, now time.Time) *Resource {
	var (
		missingSinceAt *time.Time
		status         = normalizeProviderResourceStatus(resource.Status)
		lastSeenAt     = now
	)

	if status != ResourceStatusAvailable {
		missingSinceAt = nonAvailableSinceForObservedResource(prev, now)
		if p.shouldHideMissingResource(missingSinceAt, now) {
			status = ResourceStatusUnavailable
		}
	}

	return &Resource{
		Type:           resource.Type,
		ResourceID:     resource.ResourceID,
		DisplayName:    resource.DisplayName,
		Status:         status,
		Metadata:       cloneMetadata(resource.Metadata),
		LastSeenAt:     &lastSeenAt,
		MissingSinceAt: missingSinceAt,
	}
}

// nextSnapshotResourceFromMissing preserves previous snapshot status during grace period.
// Only resources that were already available stay available; resources that were already
// unhealthy stay unhealthy so they cannot be resurrected for allocation.
func (p *Pool) nextSnapshotResourceFromMissing(resource *Resource, now time.Time) *Resource {
	missingSinceAt := nonAvailableSinceForMissingResource(resource, now)

	status := resource.Status
	if status == "" || status == ResourceStatusUnavailable {
		status = ResourceStatusAvailable
	}
	if p.shouldMarkMissingResourceUnhealthy(missingSinceAt, now) {
		status = ResourceStatusUnhealthy
	}
	if p.shouldHideMissingResource(missingSinceAt, now) {
		status = ResourceStatusUnavailable
	}

	return &Resource{
		Type:           resource.Type,
		ResourceID:     resource.ResourceID,
		DisplayName:    resource.DisplayName,
		Status:         status,
		Metadata:       cloneMetadata(resource.Metadata),
		LastSeenAt:     cloneTimePtr(resource.LastSeenAt),
		MissingSinceAt: missingSinceAt,
	}
}

func normalizeProviderResourceStatus(status ResourceStatus) ResourceStatus {
	if status == ResourceStatusAvailable {
		return ResourceStatusAvailable
	}
	return ResourceStatusUnhealthy
}

func nonAvailableSinceForObservedResource(prev *Resource, now time.Time) *time.Time {
	if prev != nil && prev.MissingSinceAt != nil {
		return cloneTimePtr(prev.MissingSinceAt)
	}
	missingSince := now
	return &missingSince
}

func nonAvailableSinceForMissingResource(prev *Resource, now time.Time) *time.Time {
	if prev != nil {
		if prev.MissingSinceAt != nil {
			return cloneTimePtr(prev.MissingSinceAt)
		}
		if prev.LastSeenAt != nil {
			return cloneTimePtr(prev.LastSeenAt)
		}
	}
	missingSince := now
	return &missingSince
}

func (p *Pool) shouldMarkMissingResourceUnhealthy(missingSinceAt *time.Time, now time.Time) bool {
	if missingSinceAt == nil {
		return false
	}

	markAfter := p.missingLeaseMarkAfterDuration()
	if markAfter <= 0 {
		return true
	}

	return now.Sub(*missingSinceAt) >= markAfter
}

func (p *Pool) shouldLogMissingResourceMarkedUnhealthy(missingSinceAt *time.Time, now time.Time) bool {
	if !p.shouldMarkMissingResourceUnhealthy(missingSinceAt, now) {
		return false
	}
	if missingSinceAt == nil {
		return false
	}

	window := p.refreshInterval
	if window <= 0 {
		window = 5 * time.Second
	}

	return now.Sub(*missingSinceAt) < p.missingLeaseMarkAfterDuration()+window
}

func (p *Pool) missingLeaseMarkAfterDuration() time.Duration {
	if p == nil {
		return 30 * time.Second
	}
	if p.missingLeaseMarkAfter > 0 {
		return p.missingLeaseMarkAfter
	}
	if p.refreshInterval > 0 {
		return p.refreshInterval * 2
	}
	return 30 * time.Second
}

func (p *Pool) shouldHideMissingResource(missingSinceAt *time.Time, now time.Time) bool {
	if p == nil || p.missingLeaseHideAfter <= 0 || missingSinceAt == nil {
		return false
	}
	return now.Sub(*missingSinceAt) >= p.missingLeaseHideAfter
}

func (p *Pool) shouldHideMissingLease(lease *Lease, now time.Time) bool {
	if p == nil || lease == nil || lease.ProviderMissingSinceAt == nil {
		return false
	}
	if p.missingLeaseHideAfter <= 0 {
		return false
	}
	return now.Sub(*lease.ProviderMissingSinceAt) >= p.missingLeaseHideAfter
}

func (p *Pool) shouldDisplayMissingLease(lease *Lease, now time.Time) bool {
	if p == nil || lease == nil || lease.ProviderMissingSinceAt == nil {
		return false
	}
	if p.shouldHideMissingLease(lease, now) {
		return false
	}
	return p.shouldMarkMissingResourceUnhealthy(lease.ProviderMissingSinceAt, now)
}

func (p *Pool) shouldDeleteMissingLease(lease *Lease, now time.Time) bool {
	if p == nil || lease == nil || lease.ProviderMissingSinceAt == nil {
		return false
	}
	if p.missingLeaseDeleteAfter <= 0 {
		return false
	}
	return now.Sub(*lease.ProviderMissingSinceAt) >= p.missingLeaseDeleteAfter
}

func (p *Pool) reconcileLeaseProviderState(
	ctx context.Context,
	observedResourceStatusByType map[string]map[string]ResourceStatus,
	now time.Time,
) (int, error) {
	if p == nil || p.rds == nil || len(observedResourceStatusByType) == 0 {
		return 0, nil
	}

	keys, err := p.scanResourceKeys(ctx)
	if err != nil || len(keys) == 0 {
		return 0, err
	}

	values, err := p.rds.MGet(ctx, keys...).Result()
	if err != nil {
		return 0, err
	}

	deleted := 0
	for idx, key := range keys {
		if idx >= len(values) {
			continue
		}
		raw, ok := values[idx].(string)
		if !ok || raw == "" {
			continue
		}

		var lease Lease
		if err := json.Unmarshal([]byte(raw), &lease); err != nil {
			continue
		}

		observedStatuses, tracked := observedResourceStatusByType[lease.Type]
		if !tracked {
			continue
		}

		entryDeleted, entryErr := p.reconcileLeaseEntry(ctx, &lease, observedStatuses, key, now)
		if entryErr != nil {
			return deleted, entryErr
		}
		if entryDeleted {
			deleted++
		}
	}

	return deleted, nil
}

// reconcileLeaseEntry reconciles a single lease against the freshly observed
// provider inventory. Returns true if the lease was deleted as part of cleanup.
func (p *Pool) reconcileLeaseEntry(
	ctx context.Context,
	lease *Lease,
	observedStatuses map[string]ResourceStatus,
	key string,
	now time.Time,
) (bool, error) {
	if status, live := observedStatuses[key]; live && status == ResourceStatusAvailable {
		return false, p.restoreLeaseAfterProviderRecovery(ctx, lease, now)
	}

	// Resource not seen by provider in this refresh cycle.
	// Only stamp ProviderMissingSinceAt once; skip if already set —
	// avoids unnecessary Redis writes when the resource stays missing.
	if lease.ProviderMissingSinceAt == nil {
		missingSince := now
		lease.ProviderMissingSinceAt = &missingSince
		if persistErr := p.persistLease(ctx, lease); persistErr != nil {
			return false, persistErr
		}
		return false, nil
	}

	// Still within grace period — do not log or delete yet.
	if !p.shouldMarkMissingResourceUnhealthy(lease.ProviderMissingSinceAt, now) {
		return false, nil
	}

	// Past grace period but not yet eligible for deletion — log once at info level.
	if !p.shouldDeleteMissingLease(lease, now) {
		if p.shouldLogMissingResourceMarkedUnhealthy(lease.ProviderMissingSinceAt, now) {
			logger.CtxInfo(
				ctx,
				"cleanup: sandbox assignment marked unhealthy after provider grace period "+
					"sandbox=%s instance=%s missing_since=%s",
				lease.SandboxID, lease.User,
				lease.ProviderMissingSinceAt.Format(time.RFC3339),
			)
		}
		return false, nil
	}

	if deleteErr := p.deleteLeaseAndAssignment(ctx, lease); deleteErr != nil {
		return false, deleteErr
	}

	logger.CtxWarn(
		ctx,
		"cleanup: removed expired missing sandbox assignment sandbox=%s instance=%s missing_since=%s",
		lease.SandboxID, lease.User, lease.ProviderMissingSinceAt.Format(time.RFC3339),
	)
	return true, nil
}

func (p *Pool) restoreLeaseAfterProviderRecovery(ctx context.Context, lease *Lease, now time.Time) error {
	if lease.ProviderMissingSinceAt == nil {
		return nil
	}

	wasUnhealthy := p.shouldMarkMissingResourceUnhealthy(lease.ProviderMissingSinceAt, now)
	lease.ProviderMissingSinceAt = nil
	if persistErr := p.persistLease(ctx, lease); persistErr != nil {
		return persistErr
	}
	if wasUnhealthy {
		logger.CtxInfo(
			ctx,
			"cleanup: restored sandbox assignment visibility after provider recovery "+
				"sandbox=%s instance=%s",
			lease.SandboxID, lease.User,
		)
	}

	return nil
}

func (p *Pool) persistLease(ctx context.Context, lease *Lease) error {
	if p == nil || p.rds == nil || lease == nil {
		return nil
	}

	payload, err := json.Marshal(lease)
	if err != nil {
		return err
	}

	return p.rds.Set(ctx, resourceKeyPrefix+lease.SandboxID, string(payload), 0).Err()
}

func (p *Pool) deleteLeaseAndAssignment(ctx context.Context, lease *Lease) error {
	if p == nil || p.rds == nil || lease == nil {
		return nil
	}

	pipe := p.rds.TxPipeline()
	pipe.Del(ctx, resourceKeyPrefix+lease.SandboxID)
	if lease.User != "" {
		pipe.HDel(ctx, assignKey(lease.User), lease.SandboxID)
	}
	_, err := pipe.Exec(ctx)
	return err
}

func (p *Pool) resourceFromLease(lease *Lease, now time.Time) *Resource {
	if lease == nil {
		return nil
	}

	status := ResourceStatusAvailable
	if lease.ProviderMissingSinceAt != nil {
		if p.shouldHideMissingLease(lease, now) {
			status = ResourceStatusUnavailable
		} else if p.shouldDisplayMissingLease(lease, now) {
			status = ResourceStatusUnhealthy
		}
	}

	return &Resource{
		Type:       lease.Type,
		ResourceID: lease.ResourceID,
		Status:     status,
		Metadata:   cloneMetadata(lease.Metadata),
	}
}

func (p *Pool) ResolveResourceByHash(ctx context.Context, sandboxType, rid string) (*Resource, error) {
	if p == nil {
		return nil, apperr.New(errcode.SandboxProviderUnavailable, "sandbox provider unavailable")
	}
	if _, ok := p.GetProvider(sandboxType); !ok {
		return nil, apperr.New(errcode.SandboxProviderUnavailable, "sandbox provider unavailable")
	}

	resources, _, ok, err := p.loadSnapshotResources(ctx, sandboxType)
	if err != nil {
		return nil, apperr.New(
			errcode.SandboxProviderUnavailable,
			fmt.Sprintf("failed to load sandbox resource snapshot for type %s: %v", sandboxType, err),
		)
	}
	if ok {
		for _, resource := range resources {
			if resource == nil || resource.ResourceID == "" {
				continue
			}
			if hashResourceID(resource.ResourceID) == rid {
				return cloneResources([]*Resource{resource})[0], nil
			}
		}
	}

	leaseByResourceKey, err := p.loadLeasesByResourceKey(ctx, sandboxType)
	if err != nil {
		return nil, apperr.New(
			errcode.SandboxProviderUnavailable,
			fmt.Sprintf("failed to load sandbox lease metadata for type %s: %v", sandboxType, err),
		)
	}
	for _, lease := range leaseByResourceKey {
		if lease == nil || lease.ResourceID == "" {
			continue
		}
		if hashResourceID(lease.ResourceID) == rid {
			return p.resourceFromLease(lease, time.Now()), nil
		}
	}

	return nil, apperr.New(errcode.SandboxNoAvailableResource, "resource not found")
}

// UpdateResolvedResourceCache best-effort writes freshly resolved provider data
// back into the existing shared snapshot entry and assigned lease metadata.
// It never creates a partial snapshot when the resource was not already present.
func (p *Pool) UpdateResolvedResourceCache(ctx context.Context, resource *Resource) error {
	if p == nil || p.rds == nil || resource == nil {
		return nil
	}
	if strings.TrimSpace(resource.Type) == "" || strings.TrimSpace(resource.ResourceID) == "" {
		return nil
	}

	if err := p.mergeResolvedResourceIntoSnapshot(ctx, resource, time.Now()); err != nil {
		return err
	}

	return p.mergeResolvedResourceIntoLease(ctx, resource)
}

func runResolvedResourceCacheTestHook(ctx context.Context, stage string) {
	if ctx == nil {
		return
	}
	hook, ok := ctx.Value(resolvedResourceCacheTestHookKey{}).(func(string))
	if !ok || hook == nil {
		return
	}
	hook(stage)
}

func (p *Pool) mergeResolvedResourceIntoSnapshot(ctx context.Context, resource *Resource, now time.Time) error {
	if p == nil || p.rds == nil || resource == nil {
		return nil
	}

	snapshotKey := resourceSnapshotKey(resource.Type)
	for range 3 {
		err := p.rds.Watch(ctx, func(tx *redis.Tx) error {
			return mergeResolvedResourceIntoSnapshotTx(ctx, tx, snapshotKey, resource, now)
		}, snapshotKey)
		if err == nil {
			return nil
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return err
	}

	return fmt.Errorf("failed to update sandbox snapshot for %s after retries", resource.ResourceID)
}

func mergeResolvedResourceIntoSnapshotTx(
	ctx context.Context, tx *redis.Tx, snapshotKey string, resource *Resource, now time.Time,
) error {
	currentVal, getErr := tx.Get(ctx, snapshotKey).Result()
	if getErr != nil {
		if errors.Is(getErr, redis.Nil) {
			return nil
		}
		return getErr
	}

	var snapshot ResourceSnapshot
	if err := json.Unmarshal([]byte(currentVal), &snapshot); err != nil {
		return err
	}

	if !applyResolvedResourceToSnapshot(&snapshot, resource, now) {
		return nil
	}

	payload, marshalErr := json.Marshal(&snapshot)
	if marshalErr != nil {
		return marshalErr
	}

	runResolvedResourceCacheTestHook(ctx, resolvedResourceCacheStageSnapshot)

	_, txErr := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Set(ctx, snapshotKey, string(payload), 0)
		return nil
	})
	return txErr
}

func applyResolvedResourceToSnapshot(snapshot *ResourceSnapshot, resource *Resource, now time.Time) bool {
	for _, existing := range snapshot.Resources {
		if existing == nil || existing.ResourceID != resource.ResourceID {
			continue
		}
		existing.DisplayName = resource.DisplayName
		existing.Status = normalizeProviderResourceStatus(resource.Status)
		existing.Metadata = cloneMetadata(resource.Metadata)
		existing.LastSeenAt = &now
		if existing.Status == ResourceStatusAvailable {
			existing.MissingSinceAt = nil
		}
		return true
	}

	return false
}

func (p *Pool) mergeResolvedResourceIntoLease(ctx context.Context, resource *Resource) error {
	if p == nil || p.rds == nil || resource == nil {
		return nil
	}

	resKey := resourceKeyPrefix + resource.Type + ":" + resource.ResourceID
	normalizedStatus := normalizeProviderResourceStatus(resource.Status)
	for range 3 {
		err := p.rds.Watch(ctx, func(tx *redis.Tx) error {
			return mergeResolvedResourceIntoLeaseTx(ctx, tx, resKey, resource, normalizedStatus)
		}, resKey)
		if err == nil {
			return nil
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return err
	}

	return fmt.Errorf("failed to update sandbox lease metadata for %s after retries", resource.ResourceID)
}

func mergeResolvedResourceIntoLeaseTx(
	ctx context.Context, tx *redis.Tx, resKey string, resource *Resource, normalizedStatus ResourceStatus,
) error {
	currentVal, getErr := tx.Get(ctx, resKey).Result()
	if getErr != nil {
		if errors.Is(getErr, redis.Nil) {
			return nil
		}
		return getErr
	}

	var lease Lease
	if err := json.Unmarshal([]byte(currentVal), &lease); err != nil {
		return err
	}

	lease.Metadata = cloneMetadata(resource.Metadata)
	if normalizedStatus == ResourceStatusAvailable {
		lease.ProviderMissingSinceAt = nil
	}

	payload, marshalErr := json.Marshal(&lease)
	if marshalErr != nil {
		return marshalErr
	}

	runResolvedResourceCacheTestHook(ctx, resolvedResourceCacheStageLease)

	_, txErr := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Set(ctx, resKey, string(payload), 0)
		return nil
	})
	return txErr
}

func cloneResources(resources []*Resource) []*Resource {
	if len(resources) == 0 {
		return []*Resource{}
	}

	out := make([]*Resource, 0, len(resources))
	for _, r := range resources {
		if r == nil {
			continue
		}

		out = append(out, &Resource{
			Type:           r.Type,
			ResourceID:     r.ResourceID,
			DisplayName:    r.DisplayName,
			Status:         r.Status,
			Metadata:       cloneMetadata(r.Metadata),
			LastSeenAt:     cloneTimePtr(r.LastSeenAt),
			MissingSinceAt: cloneTimePtr(r.MissingSinceAt),
		})
	}

	return out
}

func cloneMetadata(metadata map[string]string) map[string]string {
	if len(metadata) == 0 {
		return nil
	}

	out := make(map[string]string, len(metadata))
	for k, v := range metadata {
		out[k] = v
	}

	return out
}

func cloneTimePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

// extractTypeFromResourceKey parses the sandbox type from a resource key.
// Key format: "sandbox:resource:{type}:{resourceID}"
func extractTypeFromResourceKey(key string) string {
	trimmed := strings.TrimPrefix(key, resourceKeyPrefix)
	if idx := strings.Index(trimmed, ":"); idx > 0 {
		return trimmed[:idx]
	}

	return ""
}

func extractSandboxIDFromResourceKey(key string) string {
	return strings.TrimPrefix(key, resourceKeyPrefix)
}

// GetSandboxByID returns the stored sandbox lease by ID.
func (p *Pool) GetSandboxByID(ctx context.Context, sandboxID string) (*Lease, error) {
	return p.getLease(ctx, sandboxID)
}

// GetAssignedLease returns any lease for a pre-assigned sandbox of the given type
// for the specified instance (regardless of InUse status). Used by dashboard queries.
func (p *Pool) GetAssignedLease(ctx context.Context, instanceID, sandboxType string) (*Lease, error) {
	if instanceID == "" || sandboxType == "" {
		return nil, nil
	}

	aKey := assignKey(instanceID)
	assignments, err := p.rds.HGetAll(ctx, aKey).Result()
	if err != nil {
		return nil, err
	}

	for sandboxID, sType := range assignments {
		if sType != sandboxType {
			continue
		}
		lease, leaseErr := p.getLease(ctx, sandboxID)
		if leaseErr != nil || lease == nil {
			// Stale assignment — clean up and log
			_ = p.rds.HDel(ctx, aKey, sandboxID).Err()
			logger.CtxInfo(
				ctx,
				"GetAssignedLease: removed stale assignment instance=%s sandbox=%s (lease missing)",
				instanceID, sandboxID,
			)
			continue
		}
		return lease, nil
	}

	return nil, nil
}

// acquireLeaseScript atomically checks if a lease has InUse=false (or missing)
// and sets it to true. Returns the updated lease JSON on success, or nil if
// already in use, in cooldown, or key not found.
// KEYS[1] = lease key, KEYS[2] = cooldown key.
// ARGV[1] = exact owner JSON fragment, for example "User":"123".
// Uses string operations instead of cjson round-trip to avoid Lua cjson dropping
// false-valued boolean fields or reordering JSON keys.
var acquireLeaseScript = redis.NewScript(`
local val = redis.call('GET', KEYS[1])
if not val then return nil end
if redis.call('EXISTS', KEYS[2]) == 1 then return nil end
if ARGV[1] ~= '' and not string.find(val, ARGV[1], 1, true) then return nil end
if string.find(val, '"InUse":true', 1, true) then return nil end
local updated, n = string.gsub(val, '"InUse":false', '"InUse":true', 1)
if n == 0 then
  updated = string.gsub(val, '}$', ',"InUse":true}')
end
redis.call('SET', KEYS[1], updated)
return updated
`)

// AcquireAssignedLease tries, in the given priority order, to acquire one of the
// candidate sandboxes that is assigned to the instance.
//
// candidateSandboxIDs are pre-filtered by the caller to available resources of
// the requested OS (see Service.appliableResourcesForOS) and ordered by
// scheduling priority. This routine intersects them with the instance's
// assignment set and acquires the first that can be leased; the assignment hash
// value (concrete type) is irrelevant here — selection is purely OS-driven
// upstream and identity-driven (assigned to this instance) here.
func (p *Pool) AcquireAssignedLease(
	ctx context.Context, instanceID string, candidateSandboxIDs []string,
) (*Lease, error) {
	if instanceID == "" || len(candidateSandboxIDs) == 0 {
		return nil, nil
	}

	assignments, err := p.rds.HGetAll(ctx, assignKey(instanceID)).Result()
	if err != nil {
		return nil, err
	}
	if len(assignments) == 0 {
		return nil, nil
	}

	expectedOwnerJSON, err := json.Marshal(instanceID)
	if err != nil {
		return nil, err
	}
	expectedOwnerPattern := `"User":` + string(expectedOwnerJSON)

	for _, sandboxID := range candidateSandboxIDs {
		if _, assigned := assignments[sandboxID]; !assigned {
			continue
		}

		lease, acquireErr := p.tryAcquireAssignedLease(ctx, sandboxID, expectedOwnerPattern)
		if acquireErr != nil {
			return nil, acquireErr
		}
		if lease != nil {
			return lease, nil
		}
	}

	return nil, nil
}

func (p *Pool) tryAcquireAssignedLease(ctx context.Context, sandboxID, expectedOwnerPattern string) (*Lease, error) {
	resKey := resourceKeyPrefix + sandboxID
	cdKey := cooldownKeyPrefix + sandboxID
	result, luaErr := acquireLeaseScript.Run(ctx, p.rds, []string{resKey, cdKey}, expectedOwnerPattern).Result()
	if luaErr != nil {
		if errors.Is(luaErr, redis.Nil) {
			// Lease not found or already in use — try next
			return nil, nil
		}
		return nil, luaErr
	}

	updatedJSON, ok := result.(string)
	if !ok || updatedJSON == "" {
		return nil, nil
	}

	var lease Lease
	if jsonErr := json.Unmarshal([]byte(updatedJSON), &lease); jsonErr != nil {
		logger.CtxError(ctx, "AcquireAssignedLease: failed to parse lease JSON: %v", jsonErr)
		return nil, nil
	}

	return &lease, nil
}

// ReleaseLease marks a sandbox as no longer in use (InUse=false).
// Returns the updated lease, or error if not found / not owned by instanceID.
func (p *Pool) ReleaseLease(ctx context.Context, instanceID, sandboxID string) (*Lease, error) {
	if instanceID == "" || sandboxID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "instanceID and sandboxID are required")
	}

	lease, err := p.getLease(ctx, sandboxID)
	if err != nil {
		return nil, err
	}
	if lease == nil {
		return nil, apperr.New(errcode.SandboxLeaseNotFound, "sandbox not found")
	}

	// Defensive check: ensure the lease belongs to this instance
	if lease.User != instanceID {
		return nil, apperr.New(errcode.CommonForbidden, "sandbox is not assigned to this instance")
	}

	if !lease.InUse {
		// Already released — idempotent, return success
		return lease, nil
	}

	lease.InUse = false
	payload, marshalErr := json.Marshal(lease)
	if marshalErr != nil {
		return nil, marshalErr
	}
	resKey := resourceKeyPrefix + sandboxID
	if setErr := p.rds.Set(ctx, resKey, string(payload), 0).Err(); setErr != nil {
		return nil, setErr
	}

	// Set cooldown key — sandbox cannot be re-acquired until TTL expires
	cdKey := cooldownKeyPrefix + sandboxID
	if cdErr := p.rds.Set(ctx, cdKey, "1", releaseCooldown).Err(); cdErr != nil {
		logger.CtxWarn(ctx, "Failed to set cooldown key %s: %v", cdKey, cdErr)
	}

	return lease, nil
}

const resourceKeyPrefix = "sandbox:resource:"
const resourceSnapshotKeyPrefix = "sandbox:snapshot:resource:"
const resourcePendingShrinkKeyPrefix = "sandbox:snapshot:resource:pending-shrink:"
const resourceSnapshotLeaderKey = "sandbox:snapshot:resource:leader"
const cooldownKeyPrefix = "sandbox:cooldown:"
const releaseCooldown = 3 * time.Second

func resourceKey(t, id string) string { return resourceKeyPrefix + t + ":" + id }

func resourceSnapshotKey(snapshotType string) string { return resourceSnapshotKeyPrefix + snapshotType }

func resourcePendingShrinkKey(snapshotType string) string {
	return resourcePendingShrinkKeyPrefix + snapshotType
}

func (p *Pool) scanResourceKeys(ctx context.Context) ([]string, error) {
	var (
		cursor uint64
		keys   []string
	)

	for {
		batch, next, err := p.rds.Scan(ctx, cursor, resourceKey("*", "*"), 200).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		if next == 0 {
			break
		}
		cursor = next
	}

	return keys, nil
}

func (p *Pool) getLease(ctx context.Context, sandboxID string) (*Lease, error) {
	// sandboxID = {type}:{resourceID}, resourceKey = resourceKeyPrefix + sandboxID
	resKey := resourceKeyPrefix + sandboxID
	val, err := p.rds.Get(ctx, resKey).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, apperr.New(errcode.SandboxLeaseNotFound, "sandbox not found")
		}
		return nil, err
	}

	var lease Lease
	if err := json.Unmarshal([]byte(val), &lease); err != nil {
		return nil, err
	}

	// Verify the sandbox ID matches
	if lease.SandboxID != sandboxID {
		return nil, apperr.New(errcode.SandboxLeaseNotFound, "sandbox not found")
	}

	return &lease, nil
}
