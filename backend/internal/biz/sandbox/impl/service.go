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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	cronContract "sico-backend/internal/infra/cron"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
	"sico-backend/pkg/logger"
)

type Service struct {
	sandboxRgrpc.UnimplementedReverseSandboxRPCServer
	Pool         *Pool
	InstanceRepo agentrepo.SingleAgentInstanceRepository
}

var errSandboxUnassignLeaseInUse = errors.New("sandbox lease is still in use")

func NewService(pool *Pool, instanceRepo agentrepo.SingleAgentInstanceRepository, _ cronContract.Cron) *Service {
	svc := &Service{
		Pool:         pool,
		InstanceRepo: instanceRepo,
	}

	return svc
}

// ==================== New Simplified APIs ====================

// ApplySandbox picks an available (InUse=false) sandbox of the requested type
// from the pool pre-assigned to this instance, marks it InUse=true, and returns it.
// If all assigned sandboxes are in use or none are assigned, returns an informational response.
func (s *Service) ApplySandbox(ctx context.Context, instanceID, sandboxType string) (map[string]interface{}, error) {
	if instanceID == "" || sandboxType == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "instanceID and sandboxType are required")
	}

	appliableResourcesByID, snapshotAge, err := s.listAppliableResources(ctx, sandboxType)
	if err != nil {
		return nil, err
	}
	logger.CtxInfo(
		ctx,
		"ApplySandbox: using shared sandbox snapshot for type=%s age=%s",
		sandboxType, snapshotAge.Round(time.Millisecond),
	)

	lease, err := s.Pool.AcquireAvailableLeaseFromResources(
		ctx, instanceID, sandboxType, appliableResourcesByID,
	)
	if err != nil {
		return nil, err
	}

	if lease == nil {
		// No available sandbox found - return empty result (not an error)
		logger.CtxInfo(
			ctx,
			"No available sandbox of type %s for instance %s (all in use or none assigned)",
			sandboxType, instanceID,
		)
		return nil, nil
	}
	if strings.TrimSpace(lease.User) != instanceID {
		logger.CtxWarn(
			ctx,
			"ApplySandbox: acquired sandbox %s for instance %s but lease owner is %s",
			lease.SandboxID, instanceID, lease.User,
		)
		return nil, apperr.New(errcode.CommonConflict, "sandbox assignment owner changed, please retry")
	}

	if resource := appliableResourcesByID[lease.ResourceID]; resource != nil {
		s.mergeLeaseMetadata(ctx, lease, resource.Metadata)
	}

	result := map[string]interface{}{
		"sandbox_id":   lease.SandboxID,
		"type":         lease.Type,
		"instance_id":  instanceID,
		"display_name": s.getLeaseDisplayName(ctx, lease),
	}

	endpoint, docsURL, vncURL, vncOpenURL := s.getSandboxEndpoints(lease)
	result["endpoint"] = endpoint
	result["docs_url"] = docsURL
	result["vnc_url"] = vncURL
	result["vnc_open_url"] = vncOpenURL

	if lease.Metadata != nil {
		result["metadata"] = lease.Metadata
	}

	logger.CtxInfo(ctx, "Sandbox applied for instance %s: sandbox_id=%s, type=%s, endpoint=%s",
		instanceID, lease.SandboxID, sandboxType, endpoint)

	return result, nil
}

// ReleaseSandbox resets the sandbox first while the lease is still in-use,
// then marks it as no longer in use with a cooldown period.
// If reset fails, the lease stays in-use so the dirty sandbox cannot be reused.
func (s *Service) ReleaseSandbox(ctx context.Context, instanceID, sandboxID string) error {
	if instanceID == "" || sandboxID == "" {
		return apperr.New(errcode.CommonInvalidParam, "instanceID and sandboxID are required")
	}

	lease, err := s.Pool.GetSandboxByID(ctx, sandboxID)
	if err != nil {
		return err
	}
	if lease == nil {
		return apperr.New(errcode.SandboxLeaseNotFound, "sandbox not found")
	}
	if lease.User != instanceID {
		return apperr.New(errcode.CommonForbidden, "sandbox is not assigned to this instance")
	}
	if !lease.InUse {
		logger.CtxInfo(
			ctx,
			"Sandbox already released: sandbox_id=%s, instance=%s, type=%s",
			lease.SandboxID, instanceID, lease.Type,
		)
		return nil
	}

	prov, ok := s.Pool.GetProvider(lease.Type)
	if !ok || prov == nil {
		return apperr.New(
			errcode.SandboxProviderUnavailable,
			fmt.Sprintf("sandbox provider unavailable for type %s", lease.Type),
		)
	}
	if resetErr := prov.ResetResource(ctx, lease.ResourceID); resetErr != nil {
		logger.CtxWarn(ctx, "Sandbox reset failed during release: sandbox_id=%s, err=%v", sandboxID, resetErr)
		return apperr.New(errcode.SandboxResetFailed, fmt.Sprintf("failed to reset sandbox %s: %v", sandboxID, resetErr))
	}

	lease, err = s.Pool.ReleaseLease(ctx, instanceID, sandboxID)
	if err != nil {
		return err
	}

	logger.CtxInfo(ctx, "Sandbox released: sandbox_id=%s, instance=%s, type=%s", lease.SandboxID, instanceID, lease.Type)
	return nil
}

// refreshLeaseMetadata replaces each lease's metadata with the latest values from the
// shared resource snapshot for response shaping. It does NOT persist to Redis in this
// path, avoiding stale lease writeback.
// This is a best-effort operation — failures are logged but do not propagate.
func (s *Service) refreshLeaseMetadata(ctx context.Context, leases ...*Lease) {
	if len(leases) == 0 {
		return
	}

	// Group leases by provider type so we read the shared snapshot at most once per type.
	byType := map[string][]*Lease{}
	for _, l := range leases {
		if l != nil && l.Type != "" {
			byType[l.Type] = append(byType[l.Type], l)
		}
	}

	for t, typedLeases := range byType {
		resources, _, ok, err := s.Pool.loadSnapshotResources(ctx, t)
		if err != nil || !ok || len(resources) == 0 {
			continue
		}

		// Build a lookup by ResourceID for O(1) matching.
		resMeta := map[string]map[string]string{}
		for _, r := range resources {
			if r != nil {
				resMeta[r.ResourceID] = r.Metadata
			}
		}

		for _, lease := range typedLeases {
			fresh, found := resMeta[lease.ResourceID]
			if !found {
				continue
			}

			// Snapshot-based refresh is for response shaping only.
			// Replace rather than merge so removed provider fields stop surfacing
			// stale direct endpoints in the current response.
			lease.Metadata = cloneMetadata(fresh)
		}
	}
}

func resourcesByIDWithStatus(resources []*Resource, status ResourceStatus) map[string]*Resource {
	filtered := make(map[string]*Resource, len(resources))
	for _, resource := range resources {
		if resource == nil || resource.ResourceID == "" || resource.Status != status {
			continue
		}
		filtered[resource.ResourceID] = resource
	}

	return filtered
}

// appliableResources returns resources that an existing owner may use.
// During the missing-resource grace period we still allow apply against a
// resource that remains logically assigned to the same instance.
func appliableResources(resources []*Resource) map[string]*Resource {
	return resourcesByIDWithStatus(resources, ResourceStatusAvailable)
}

// allocatableResources returns resources eligible for new assignment.
// Resources in the grace period (MissingSinceAt != nil) are excluded even
// when their snapshot status is still available — they are kept visible in
// the dashboard list but must not be handed out to new leases.
func allocatableResources(resources []*Resource) map[string]*Resource {
	filtered := make(map[string]*Resource, len(resources))
	for _, resource := range resources {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		if resource.Status != ResourceStatusAvailable {
			continue
		}
		if resource.MissingSinceAt != nil {
			continue
		}
		filtered[resource.ResourceID] = resource
	}
	return filtered
}

func (s *Service) listSnapshotResources(
	ctx context.Context, sandboxType string,
) ([]*Resource, time.Duration, error) {
	prov, ok := s.Pool.GetProvider(sandboxType)
	if !ok || prov == nil {
		return nil, 0, apperr.New(errcode.SandboxProviderUnavailable, "provider unavailable for type: "+sandboxType)
	}

	resources, age, ok, err := s.Pool.loadSnapshotResources(ctx, sandboxType)
	if err != nil {
		return nil, age, apperr.New(
			errcode.SandboxProviderUnavailable,
			fmt.Sprintf("failed to load sandbox resources for type %s: %v", sandboxType, err),
		)
	}
	if !ok {
		return nil, age, apperr.New(
			errcode.SandboxProviderUnavailable,
			"sandbox resource snapshot unavailable for type: "+sandboxType,
		)
	}

	return resources, age, nil
}

func (s *Service) listAppliableResources(ctx context.Context, sandboxType string) (map[string]*Resource, time.Duration, error) {
	resources, age, err := s.listSnapshotResources(ctx, sandboxType)
	if err != nil {
		return nil, age, err
	}

	return appliableResources(resources), age, nil
}

func (s *Service) listAllocatableResources(ctx context.Context, sandboxType string) (map[string]*Resource, time.Duration, error) {
	resources, age, err := s.listSnapshotResources(ctx, sandboxType)
	if err != nil {
		return nil, age, err
	}

	return allocatableResources(resources), age, nil
}

func (s *Service) mergeLeaseMetadata(ctx context.Context, lease *Lease, fresh map[string]string) {
	if lease == nil {
		return
	}

	nextMetadata := cloneMetadata(fresh)
	if metadataEqual(lease.Metadata, nextMetadata) {
		return
	}
	lease.Metadata = nextMetadata

	rds := s.Pool.GetRedis()
	if rds == nil {
		return
	}

	resKey := resourceKeyPrefix + lease.SandboxID
	for range 3 {
		err := tryPersistLeaseMetadata(ctx, rds, resKey, lease.Metadata)
		if err == nil {
			return
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		logger.CtxWarn(ctx, "mergeLeaseMetadata: failed to persist metadata for %s: %v", lease.SandboxID, err)
		return
	}

	logger.CtxWarn(ctx, "mergeLeaseMetadata: failed to persist metadata for %s after retries", lease.SandboxID)
}

// tryPersistLeaseMetadata runs a single WATCH/MULTI attempt to update the
// metadata field of the lease stored at resKey. The caller is responsible for
// retrying on redis.TxFailedErr.
func tryPersistLeaseMetadata(
	ctx context.Context, rds *redis.Client, resKey string, metadata map[string]string,
) error {
	return rds.Watch(ctx, func(tx *redis.Tx) error {
		currentVal, getErr := tx.Get(ctx, resKey).Result()
		if getErr != nil {
			if errors.Is(getErr, redis.Nil) {
				return nil
			}
			return getErr
		}

		var current Lease
		if json.Unmarshal([]byte(currentVal), &current) != nil {
			return nil
		}
		if metadataEqual(current.Metadata, metadata) {
			return nil
		}
		current.Metadata = cloneMetadata(metadata)

		payload, marshalErr := json.Marshal(&current)
		if marshalErr != nil {
			return marshalErr
		}

		_, txErr := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(ctx, resKey, string(payload), 0)
			return nil
		})
		return txErr
	}, resKey)
}

func metadataEqual(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

// snapshotToDTO converts snapshot resources to SandboxResource DTOs for display name computation.
func (s *Service) snapshotToDTO(resources []*Resource) []*sandboxdto.SandboxResource {
	out := make([]*sandboxdto.SandboxResource, 0, len(resources))
	for _, r := range resources {
		if r == nil {
			continue
		}
		sid := r.Type + ":" + r.ResourceID
		out = append(out, &sandboxdto.SandboxResource{
			Type:       r.Type,
			ResourceId: r.ResourceID,
			SandboxId:  sid,
		})
	}
	return out
}

// getSandboxEndpoints returns endpoint, docs URL, VNC URL (proxy for iframe), and VNC open URL (direct for new tab).
func (s *Service) getSandboxEndpoints(lease *Lease) (endpoint, docsURL, vncURL, vncOpenURL string) {
	if lease == nil {
		return "", "", "", ""
	}

	// docs_url points to backend API docs endpoint for this sandbox type
	docsURL = fmt.Sprintf("/api/sico/sandbox/docs/%s", lease.Type)

	switch lease.Type {
	case enum.SandboxTypeEmulator.String():
		if lease.Metadata != nil {
			baseURL := lease.Metadata["providerBaseUrl"]
			if baseURL != "" {
				// ADB endpoint - direct access for client
				if lease.Metadata["adbPort"] != "" {
					host := extractHostFromURL(baseURL)
					endpoint = fmt.Sprintf("%s:%s", host, lease.Metadata["adbPort"])
				}
				// Show VNC (iframe) and Open VNC (new tab) both use backend-owned
				// JMuxer page so every viewer shares a single upstream scrcpy stream
				// via the H264 fan-out hub.
				rid := hashResourceID(lease.ResourceID)
				vncURL = fmt.Sprintf("/api/sico/sandbox/resources/emulator/%s/vnc", rid)
				vncOpenURL = vncURL
			}
		}
	}

	return endpoint, docsURL, vncURL, vncOpenURL
}

// ResetSandbox soft-resets a sandbox environment without releasing the lease.
// For emulator: closes all user apps and returns to home screen.
// For aio: clears shell sessions and workspace.
func (s *Service) ResetSandbox(ctx context.Context, instanceID, sandboxID string) error {
	if sandboxID == "" {
		return apperr.New(errcode.CommonInvalidParam, "sandboxID is required")
	}

	lease, err := s.Pool.GetSandboxByID(ctx, sandboxID)
	if err != nil {
		return err
	}
	if lease == nil {
		return apperr.New(errcode.CommonNotFound, "sandbox not found")
	}

	// Validate ownership when instanceID is provided (core-side calls).
	// Dashboard/admin calls may omit instanceID to skip this check.
	if instanceID != "" && lease.User != instanceID {
		return apperr.New(errcode.CommonForbidden, "sandbox is not assigned to this instance")
	}

	prov, ok := s.Pool.GetProvider(lease.Type)
	if !ok || prov == nil {
		return apperr.New(errcode.SandboxProviderUnavailable, "provider unavailable for type: "+lease.Type)
	}

	if err := prov.ResetResource(ctx, lease.ResourceID); err != nil {
		logger.CtxError(ctx, "Failed to reset sandbox %s: %v", sandboxID, err)
		return apperr.New(errcode.SandboxResetFailed, fmt.Sprintf("reset failed: %v", err))
	}

	logger.CtxInfo(ctx, "Sandbox %s reset successfully", sandboxID)
	return nil
}

// ListAllResources lists all sandbox resources grouped by type
func (s *Service) ListAllResources(ctx context.Context) (map[string]interface{}, error) {
	result := map[string]interface{}{
		enum.SandboxTypeEmulator.String(): []map[string]interface{}{},
	}

	// Get the shared resource snapshot and merge in current Redis lease metadata.
	listResult, err := s.Pool.ListResources(ctx, "")
	if err != nil {
		return nil, err
	}

	now := time.Now()

	grouped := map[string][]*sandboxdto.SandboxResource{
		enum.SandboxTypeEmulator.String(): {},
	}
	for _, r := range listResult.Resources {
		if r == nil {
			continue
		}
		if _, ok := grouped[r.Type]; ok {
			grouped[r.Type] = append(grouped[r.Type], r)
		}
	}

	typesInOrder := []string{
		enum.SandboxTypeEmulator.String(),
	}

	// Build display-name map from all resources (shared logic with instance sandbox responses)
	displayNames := buildDisplayNameMap(listResult.Resources)

	for _, sandboxType := range typesInOrder {
		resources := grouped[sandboxType]
		sort.Slice(resources, func(i, j int) bool {
			return strings.ToLower(resources[i].ResourceId) < strings.ToLower(resources[j].ResourceId)
		})

		list := make([]map[string]interface{}, 0, len(resources))
		for _, r := range resources {
			list = append(list, s.buildResourceInfo(r, listResult, displayNames, now))
		}

		result[sandboxType] = list
	}

	return result, nil
}

// buildResourceInfo renders a single resource into the map shape returned by
// ListAllResources, including lease-derived fields and endpoint URLs.
func (s *Service) buildResourceInfo(
	r *sandboxdto.SandboxResource,
	listResult *ListResourcesResult,
	displayNames map[string]string,
	now time.Time,
) map[string]interface{} {
	// Always provide a stable sandbox_id so dashboard can use it for assign/unassign.
	// Format: "type:resourceID" (same as what AssignSandbox expects).
	sandboxID := r.SandboxId
	if sandboxID == "" {
		sandboxID = r.Type + ":" + r.ResourceId
	}

	info := map[string]interface{}{
		"sandbox_id":  sandboxID,
		"resource_id": r.ResourceId,
		"type":        r.Type,
		"status":      r.Status,
		"allocatable": listResult.Allocatable[sandboxID],
		// fallback "" is fine: sandboxID always exists in the map
		// built from the same resource list
		"display_name": displayNames[sandboxID],
	}

	// Get lease info if exists (r.SandboxId is already set when resource is in use)
	if r.SandboxId != "" {
		if lease, ok := listResult.Leases[r.SandboxId]; ok && lease != nil {
			info["instance_id"] = lease.User
			info["created_at"] = lease.CreatedAt.Unix()

			// Calculate usage time
			usageSecs := int64(now.Sub(lease.CreatedAt).Seconds())
			if usageSecs > 0 {
				info["usage_seconds"] = usageSecs
			}
		}
	}

	// Add endpoint URLs
	endpoint, docsURL, vncURL, vncOpenURL := s.getResourceEndpoints(r)
	info["endpoint"] = endpoint
	info["docs_url"] = docsURL
	info["vnc_url"] = vncURL
	info["vnc_open_url"] = vncOpenURL

	return info
}

func sandboxDisplayNamePrefix(sandboxType string) string {
	switch sandboxType {
	case enum.SandboxTypeEmulator.String():
		return "Android-Device"
	default:
		return "Unknown"
	}
}

// buildDisplayNameMap groups resources by type, sorts by resource_id, and assigns
// a sequential display name (e.g. "Android-Device #1") to each sandbox.
// Returns sandboxID → display name string.
func buildDisplayNameMap(resources []*sandboxdto.SandboxResource) map[string]string {
	names := map[string]string{}

	grouped := map[string][]*sandboxdto.SandboxResource{}
	for _, r := range resources {
		if r == nil {
			continue
		}
		grouped[r.Type] = append(grouped[r.Type], r)
	}

	for sandboxType, group := range grouped {
		sort.Slice(group, func(i, j int) bool {
			return strings.ToLower(group[i].ResourceId) < strings.ToLower(group[j].ResourceId)
		})
		prefix := sandboxDisplayNamePrefix(sandboxType)
		for idx, r := range group {
			sid := r.SandboxId
			if sid == "" {
				sid = r.Type + ":" + r.ResourceId
			}
			names[sid] = fmt.Sprintf("%s #%d", prefix, idx+1)
		}
	}

	return names
}

func (s *Service) getLeaseDisplayName(ctx context.Context, lease *Lease) string {
	if lease == nil {
		return ""
	}

	if resources, _, ok, err := s.Pool.loadSnapshotResources(ctx, ""); err == nil && ok {
		displayNames := buildDisplayNameMap(s.snapshotToDTO(resources))
		if dn, exists := displayNames[lease.SandboxID]; exists && dn != "" {
			return dn
		}
	}

	return sandboxDisplayNamePrefix(lease.Type)
}

// getResourceEndpoints returns endpoint, docs URL, and VNC URL for a resource.
// Used by Dashboard's /api/sico/sandbox/list endpoint.
func (s *Service) getResourceEndpoints(r *sandboxdto.SandboxResource) (endpoint, docsURL, vncURL, vncOpenURL string) {
	if r == nil {
		return "", "", "", ""
	}

	// docs_url points to backend API docs endpoint for this sandbox type
	docsURL = fmt.Sprintf("/api/sico/sandbox/docs/%s", r.Type)

	switch r.Type {
	case enum.SandboxTypeEmulator.String():
		if r.Metadata != nil {
			baseURL := r.Metadata["providerBaseUrl"]
			if baseURL != "" {
				// ADB endpoint - direct access for client
				if r.Metadata["adbPort"] != "" {
					host := extractHostFromURL(baseURL)
					endpoint = fmt.Sprintf("%s:%s", host, r.Metadata["adbPort"])
				}
				// Show VNC and Open VNC both use backend-owned JMuxer page
				rid := hashResourceID(r.ResourceId)
				vncURL = fmt.Sprintf("/api/sico/sandbox/resources/emulator/%s/vnc", rid)
				vncOpenURL = vncURL
			}
		}
	}

	return endpoint, docsURL, vncURL, vncOpenURL
}

// hashResourceID generates a unique hash for resource identification in proxy URLs
func hashResourceID(resourceID string) string {
	sum := sha256.Sum256([]byte(resourceID))
	return hex.EncodeToString(sum[:])
}

// GetInstanceVNCURLs returns VNC URLs for all sandboxes of an instance
func (s *Service) GetInstanceVNCURLs(ctx context.Context, instanceID string) ([]map[string]interface{}, error) {
	if instanceID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "instanceID is required")
	}

	allLeases, err := s.loadAssignedLeasesBestEffort(ctx, instanceID)
	if err != nil {
		return nil, err
	}

	var result []map[string]interface{}
	for _, lease := range allLeases {
		_, _, vncURL, vncOpenURL := s.getSandboxEndpoints(lease)
		result = append(result, map[string]interface{}{
			"sandbox_id":   lease.SandboxID,
			"type":         lease.Type,
			"vnc_url":      vncURL,
			"vnc_open_url": vncOpenURL,
		})
	}

	return result, nil
}

// GetSandboxVNCURL returns VNC URL for a specific sandbox
func (s *Service) GetSandboxVNCURL(ctx context.Context, sandboxID string) (map[string]interface{}, error) {
	if sandboxID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "sandboxID is required")
	}

	lease, err := s.Pool.GetSandboxByID(ctx, sandboxID)
	if err != nil {
		return nil, err
	}
	if lease == nil {
		return nil, apperr.New(errcode.CommonNotFound, "sandbox not found")
	}

	_, _, vncURL, vncOpenURL := s.getSandboxEndpoints(lease)
	return map[string]interface{}{
		"sandbox_id":   lease.SandboxID,
		"type":         lease.Type,
		"vnc_url":      vncURL,
		"vnc_open_url": vncOpenURL,
	}, nil
}

// GetSandboxOpenAPI fetches OpenAPI spec from a sandbox instance of the given type
func (s *Service) GetSandboxOpenAPI(ctx context.Context, sandboxType string) ([]byte, error) {
	if !enum.IsValidSandboxType(sandboxType) {
		return nil, apperr.New(errcode.CommonInvalidParam, "invalid sandbox type: "+sandboxType)
	}

	resources, _, err := s.listSnapshotResources(ctx, sandboxType)
	if err != nil {
		return nil, err
	}
	resourcesByID := resourcesByIDWithStatus(resources, ResourceStatusAvailable)

	if len(resourcesByID) == 0 {
		return nil, apperr.New(errcode.CommonNotFound, "no sandbox resources available for type: "+sandboxType)
	}

	availableResources := make([]*Resource, 0, len(resourcesByID))
	for _, resource := range resourcesByID {
		availableResources = append(availableResources, resource)
	}
	sort.Slice(availableResources, func(i, j int) bool {
		return strings.ToLower(availableResources[i].ResourceID) < strings.ToLower(availableResources[j].ResourceID)
	})

	// Find the endpoint from resource metadata
	var endpoint string
	for _, r := range availableResources {
		if r == nil || r.Metadata == nil {
			continue
		}
		endpoint = s.getResourceEndpoint(sandboxType, r.Metadata)
		if endpoint != "" {
			break
		}
	}

	if endpoint == "" {
		return nil, apperr.New(errcode.CommonNotFound, "no endpoint found for sandbox type: "+sandboxType)
	}

	// Build OpenAPI URL
	openAPIPath := enum.GetOpenAPIPath(sandboxType)
	if openAPIPath == "" {
		return nil, apperr.New(errcode.CommonInternalError, "openapi path not configured for type: "+sandboxType)
	}

	openAPIURL := endpoint + openAPIPath
	logger.CtxInfo(ctx, "Fetching OpenAPI from %s", openAPIURL)

	// Fetch OpenAPI spec
	httpCli := newHTTPClient(10 * time.Second)
	data, err := httpCli.getBytes(ctx, openAPIURL)
	if err != nil {
		logger.CtxError(ctx, "Failed to fetch OpenAPI from %s: %v", openAPIURL, err)
		return nil, apperr.New(errcode.CommonInternalError, "failed to fetch OpenAPI: "+err.Error())
	}

	return data, nil
}

// getResourceEndpoint extracts the endpoint URL from resource metadata based on type
func (s *Service) getResourceEndpoint(sandboxType string, metadata map[string]string) string {
	switch sandboxType {
	case enum.SandboxTypeEmulator.String():
		return metadata["providerBaseUrl"]
	default:
		return ""
	}
}

// extractHostFromURL extracts the host (without port) from a URL string
func extractHostFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	return parsed.Hostname()
}

// ==================== Sandbox Assignment APIs ====================

const assignKeyPrefix = "sandbox:assign:"

// assignKey returns the Redis key for storing manual instance→sandbox assignments.
// Value is a Redis Hash: field=sandboxID, value=sandboxType
func assignKey(instanceID string) string {
	return assignKeyPrefix + instanceID
}

const instanceAssignLockKeyPrefix = "sandbox:instance-lock:"

var releaseInstanceAssignLockScript = redis.NewScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`)

func instanceAssignLockKey(instanceID string) string {
	return instanceAssignLockKeyPrefix + instanceID
}

func (s *Service) WithInstanceAssignmentLock(ctx context.Context, instanceID string, fn func() error) error {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return apperr.New(errcode.CommonInvalidParam, "instanceID is required")
	}
	if fn == nil {
		return nil
	}
	if s == nil || s.Pool == nil || s.Pool.GetRedis() == nil {
		return fn()
	}

	rds := s.Pool.GetRedis()
	lockKey := instanceAssignLockKey(instanceID)
	lockValue := uuid.NewString()
	lockTTL := 15 * time.Second

	for range 20 {
		result, err := rds.SetArgs(ctx, lockKey, lockValue, redis.SetArgs{Mode: "NX", TTL: lockTTL}).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return apperr.New(errcode.SandboxProviderUnavailable, "failed to acquire sandbox instance lock")
		}
		if result == "OK" {
			defer func() {
				_, err := releaseInstanceAssignLockScript.Run(
					context.Background(), rds, []string{lockKey}, lockValue,
				).Result()
				if err != nil && !errors.Is(err, redis.Nil) {
					logger.CtxWarn(ctx, "failed to release sandbox instance lock for %s: %v", instanceID, err)
				}
			}()
			return fn()
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}

	return apperr.New(errcode.CommonConflict, "instance sandbox operation is busy")
}

func (s *Service) loadAssignedLeases(ctx context.Context, instanceID string, failOnLeaseError bool) ([]*Lease, error) {
	rds := s.Pool.GetRedis()
	if rds == nil {
		return nil, apperr.New(errcode.SandboxProviderUnavailable, "storage unavailable")
	}

	aKey := assignKey(instanceID)
	assignments, err := rds.HGetAll(ctx, aKey).Result()
	if err != nil {
		return nil, err
	}

	leases := make([]*Lease, 0, len(assignments))
	for sandboxID := range assignments {
		lease, leaseErr := s.Pool.GetSandboxByID(ctx, sandboxID)
		if leaseErr != nil || lease == nil {
			if leaseErr == nil {
				_ = rds.HDel(ctx, aKey, sandboxID).Err()
				logger.CtxInfo(
					ctx,
					"loadAssignedLeases: removed stale assignment "+
						"instance=%s sandbox=%s (lease nil)",
					instanceID, sandboxID,
				)
				continue
			}
			if ae, ok := apperr.As(leaseErr); ok && ae.Code() == errcode.SandboxLeaseNotFound {
				_ = rds.HDel(ctx, aKey, sandboxID).Err()
				logger.CtxInfo(
					ctx,
					"loadAssignedLeases: removed stale assignment "+
						"instance=%s sandbox=%s (lease not found)",
					instanceID, sandboxID,
				)
				continue
			}
			if failOnLeaseError {
				return nil, leaseErr
			}
			logger.CtxWarn(
				ctx,
				"loadAssignedLeases: skip sandbox %s for instance %s due to lease read error: %v",
				sandboxID, instanceID, leaseErr,
			)
			continue
		}
		if lease.User != instanceID {
			_ = rds.HDel(ctx, aKey, sandboxID).Err()
			logger.CtxInfo(
				ctx,
				"loadAssignedLeases: removed stale assignment "+
					"instance=%s sandbox=%s (owner changed to %s)",
				instanceID, sandboxID, lease.User,
			)
			continue
		}
		leases = append(leases, lease)
	}

	return leases, nil
}

func (s *Service) loadAssignedLeasesStrict(ctx context.Context, instanceID string) ([]*Lease, error) {
	return s.loadAssignedLeases(ctx, instanceID, true)
}

func (s *Service) loadAssignedLeasesBestEffort(ctx context.Context, instanceID string) ([]*Lease, error) {
	return s.loadAssignedLeases(ctx, instanceID, false)
}

func (s *Service) HasAssignedSandboxesStrict(ctx context.Context, instanceID string) (bool, int, error) {
	leases, err := s.loadAssignedLeasesStrict(ctx, instanceID)
	if err != nil {
		return false, 0, err
	}
	return len(leases) > 0, len(leases), nil
}

func (s *Service) ensureInstanceExists(ctx context.Context, instanceID string) error {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return apperr.New(errcode.CommonInvalidParam, "instanceID is required")
	}
	if s == nil || s.InstanceRepo == nil {
		return nil
	}

	parsedID, err := strconv.ParseInt(instanceID, 10, 64)
	if err != nil {
		return apperr.New(errcode.CommonInvalidParam, "invalid instanceID")
	}

	inst, getErr := s.InstanceRepo.Get(ctx, parsedID)
	if getErr != nil {
		if errors.Is(getErr, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "instance not found")
		}
		return getErr
	}
	if inst == nil {
		return apperr.New(errcode.CommonNotFound, "instance not found")
	}

	return nil
}

func assignSandboxAtomically(ctx context.Context, rds *redis.Client, instanceID string, lease *Lease) error {
	if rds == nil || lease == nil {
		return apperr.New(errcode.CommonInvalidParam, "lease is required")
	}

	resKey := resourceKeyPrefix + lease.SandboxID
	aKey := assignKey(instanceID)
	lease.CreatedAt = time.Now()
	payload, marshalErr := json.Marshal(lease)
	if marshalErr != nil {
		return marshalErr
	}

	for range 3 {
		err := rds.Watch(ctx, func(tx *redis.Tx) error {
			return runAssignSandboxTx(ctx, tx, instanceID, lease, resKey, aKey, payload)
		}, resKey)
		if err == nil {
			return nil
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return err
	}

	return apperr.New(errcode.CommonConflict, "sandbox was updated by another process")
}

// runAssignSandboxTx executes the WATCH/MULTI body for a single
// assignSandboxAtomically attempt. Split out to keep the retry loop simple.
func runAssignSandboxTx(
	ctx context.Context,
	tx *redis.Tx,
	instanceID string,
	lease *Lease,
	resKey, aKey string,
	payload []byte,
) error {
	val, getErr := tx.Get(ctx, resKey).Result()
	if getErr != nil && !errors.Is(getErr, redis.Nil) {
		return apperr.New(errcode.SandboxProviderUnavailable, "storage error")
	}

	oldInstanceID := ""
	if getErr == nil && val != "" {
		var existingLease Lease
		if jsonErr := json.Unmarshal([]byte(val), &existingLease); jsonErr != nil {
			return apperr.New(errcode.CommonInternalError, "failed to parse existing lease")
		}
		oldInstanceID = strings.TrimSpace(existingLease.User)
		if existingLease.InUse && oldInstanceID != "" && oldInstanceID != instanceID {
			return apperr.New(
				errcode.CommonConflict,
				"sandbox is still in use by another instance; "+
					"release or unassign before reassigning",
			)
		}
	}

	_, txErr := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		if oldInstanceID != "" && oldInstanceID != instanceID {
			pipe.HDel(ctx, assignKey(oldInstanceID), lease.SandboxID)
			logger.CtxInfo(
				ctx,
				"assignSandboxAtomically: reassign sandbox=%s "+
					"from old_instance=%s to new_instance=%s",
				lease.SandboxID, oldInstanceID, instanceID,
			)
		}
		pipe.Set(ctx, resKey, payload, 0)
		pipe.HSet(ctx, aKey, lease.SandboxID, lease.Type)
		return nil
	})
	return txErr
}

func (s *Service) buildLeaseForAssignment(ctx context.Context, instanceID string, sandboxID string) (*Lease, error) {
	parts := strings.SplitN(sandboxID, ":", 2)
	if len(parts) != 2 {
		return nil, apperr.New(errcode.CommonInvalidParam, "invalid sandboxID format, expected type:resourceID")
	}

	sandboxType := parts[0]
	resourceID := parts[1]
	prov, ok := s.Pool.GetProvider(sandboxType)
	if !ok || prov == nil {
		return nil, apperr.New(errcode.CommonNotFound, "sandbox resource not found")
	}

	resourcesByID, _, err := s.listAllocatableResources(ctx, sandboxType)
	if err != nil {
		return nil, err
	}

	lease := &Lease{
		SandboxID:  sandboxID,
		Type:       sandboxType,
		ResourceID: resourceID,
		User:       instanceID,
		InUse:      false,
	}
	if resource, found := resourcesByID[resourceID]; found && resource != nil {
		if resource.Status != ResourceStatusAvailable {
			return nil, apperr.New(errcode.CommonConflict, "sandbox resource is not available")
		}
		lease.Metadata = resource.Metadata
		return lease, nil
	}

	return nil, apperr.New(errcode.CommonNotFound, "sandbox resource not found")
}

// AssignSandbox manually assigns a specific sandbox to an instance.
// The sandbox must be available in the current snapshot and not
// be actively in use by another instance. Released sandboxes may be reassigned
// directly; otherwise, unassign first.
func (s *Service) AssignSandbox(ctx context.Context, instanceID string, sandboxID string) error {
	if instanceID == "" || sandboxID == "" {
		return apperr.New(errcode.CommonInvalidParam, "instanceID and sandboxID are required")
	}

	lease, err := s.buildLeaseForAssignment(ctx, instanceID, sandboxID)
	if err != nil {
		return err
	}

	return s.WithInstanceAssignmentLock(ctx, instanceID, func() error {
		if err := s.ensureInstanceExists(ctx, instanceID); err != nil {
			return err
		}

		rds := s.Pool.GetRedis()
		if rds == nil {
			return apperr.New(errcode.SandboxProviderUnavailable, "storage unavailable")
		}

		if err := assignSandboxAtomically(ctx, rds, instanceID, lease); err != nil {
			return err
		}

		logger.CtxInfo(ctx, "Sandbox %s assigned to instance %s", sandboxID, instanceID)
		return nil
	})
}

// UnassignSandbox removes a sandbox assignment from an instance.
// It only deletes the lease when the sandbox is still owned by the given instance.
func (s *Service) UnassignSandbox(ctx context.Context, instanceID string, sandboxID string) error {
	if instanceID == "" || sandboxID == "" {
		return apperr.New(errcode.CommonInvalidParam, "instanceID and sandboxID are required")
	}

	return s.WithInstanceAssignmentLock(ctx, instanceID, func() error {
		return s.unassignSandbox(ctx, instanceID, sandboxID)
	})
}

func (s *Service) unassignSandbox(ctx context.Context, instanceID string, sandboxID string) error {
	if instanceID == "" || sandboxID == "" {
		return apperr.New(errcode.CommonInvalidParam, "instanceID and sandboxID are required")
	}

	rds := s.Pool.GetRedis()
	if rds == nil {
		return apperr.New(errcode.SandboxProviderUnavailable, "storage unavailable")
	}

	aKey := assignKey(instanceID)
	resKey := resourceKeyPrefix + sandboxID
	for range 3 {
		retry, err := s.unassignSandboxOnce(ctx, rds, instanceID, sandboxID, aKey, resKey)
		if !retry {
			return err
		}
	}

	return apperr.New(errcode.CommonConflict, "sandbox was updated by another process")
}

// unassignSandboxOnce performs one attempt of the unassign workflow. The
// returned retry flag tells the caller whether to retry the outer loop;
// when retry=false, the caller returns the accompanying error (nil on
// success). Mirrors the original loop behavior exactly.
func (s *Service) unassignSandboxOnce(
	ctx context.Context,
	rds *redis.Client,
	instanceID, sandboxID, aKey, resKey string,
) (retry bool, err error) {
	val, getErr := rds.Get(ctx, resKey).Result()
	if getErr != nil {
		if errors.Is(getErr, redis.Nil) {
			clearMissingLeaseAssignment(ctx, rds, instanceID, sandboxID, aKey)
			return false, nil
		}
		return false, apperr.New(errcode.SandboxProviderUnavailable, "storage error")
	}

	var lease Lease
	if jsonErr := json.Unmarshal([]byte(val), &lease); jsonErr != nil {
		return false, apperr.New(errcode.CommonInternalError, "failed to parse existing lease")
	}
	if lease.User != instanceID {
		return false, apperr.New(errcode.CommonConflict, "sandbox assignment owner changed")
	}
	if lease.InUse {
		return s.unassignReleaseInUseLease(ctx, rds, instanceID, sandboxID, aKey)
	}

	watchErr := rds.Watch(ctx, func(tx *redis.Tx) error {
		return runUnassignDeleteTx(ctx, tx, instanceID, sandboxID, aKey, resKey)
	}, resKey)
	if watchErr == nil {
		logger.CtxInfo(ctx, "Sandbox %s unassigned from instance %s", sandboxID, instanceID)
		return false, nil
	}
	if errors.Is(watchErr, redis.TxFailedErr) {
		return true, nil
	}
	if errors.Is(watchErr, errSandboxUnassignLeaseInUse) {
		return s.unassignRetryAfterRaceRelease(ctx, instanceID, sandboxID)
	}

	return false, watchErr
}

// clearMissingLeaseAssignment removes the stale instance→sandbox assignment
// hash entry when the underlying lease key has already disappeared.
func clearMissingLeaseAssignment(
	ctx context.Context, rds *redis.Client, instanceID, sandboxID, aKey string,
) {
	if err := rds.HDel(ctx, aKey, sandboxID).Err(); err != nil {
		logger.CtxWarn(
			ctx,
			"Failed to remove assignment %s from instance %s "+
				"after missing lease: %v",
			sandboxID, instanceID, err,
		)
	}
	logger.CtxInfo(
		ctx,
		"Sandbox %s assignment already cleared for instance %s",
		sandboxID, instanceID,
	)
}

// unassignReleaseInUseLease releases an in-use lease before unassignment can
// proceed. Returns retry=true so the outer loop re-reads the lease after
// release. Mirrors the original `if lease.InUse { ... }` branch.
func (s *Service) unassignReleaseInUseLease(
	ctx context.Context, rds *redis.Client, instanceID, sandboxID, aKey string,
) (retry bool, err error) {
	logger.CtxWarn(
		ctx,
		"UnassignSandbox: releasing in-use sandbox %s for instance %s "+
			"before deleting assignment",
		sandboxID, instanceID,
	)
	if releaseErr := s.ReleaseSandbox(ctx, instanceID, sandboxID); releaseErr != nil {
		if ae, ok := apperr.As(releaseErr); ok {
			switch ae.Code() {
			case errcode.CommonForbidden:
				return false, apperr.New(errcode.CommonConflict, "sandbox assignment owner changed")
			case errcode.SandboxLeaseNotFound:
				if delErr := rds.HDel(ctx, aKey, sandboxID).Err(); delErr != nil {
					logger.CtxWarn(
						ctx,
						"Failed to remove assignment %s from instance %s "+
							"after lease disappeared: %v",
						sandboxID, instanceID, delErr,
					)
				}
				return false, nil
			}
		}
		return false, releaseErr
	}

	return true, nil
}

// runUnassignDeleteTx is the WATCH/MULTI body that deletes an assigned but
// idle lease. It signals a late-arriving InUse flip via
// errSandboxUnassignLeaseInUse so the caller can retry after a release.
func runUnassignDeleteTx(
	ctx context.Context,
	tx *redis.Tx,
	instanceID, sandboxID, aKey, resKey string,
) error {
	currentVal, currentErr := tx.Get(ctx, resKey).Result()
	if currentErr != nil {
		if errors.Is(currentErr, redis.Nil) {
			return nil
		}
		return apperr.New(errcode.SandboxProviderUnavailable, "storage error")
	}

	var current Lease
	if jsonErr := json.Unmarshal([]byte(currentVal), &current); jsonErr != nil {
		return apperr.New(errcode.CommonInternalError, "failed to parse existing lease")
	}
	if current.User != instanceID {
		return apperr.New(errcode.CommonConflict, "sandbox assignment owner changed")
	}
	if current.InUse {
		return errSandboxUnassignLeaseInUse
	}

	_, txErr := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.HDel(ctx, aKey, sandboxID)
		pipe.Del(ctx, resKey)
		return nil
	})
	return txErr
}

// unassignRetryAfterRaceRelease handles the case where the lease became in-use
// during the delete transaction: it triggers a release, then signals retry.
func (s *Service) unassignRetryAfterRaceRelease(
	ctx context.Context, instanceID, sandboxID string,
) (retry bool, err error) {
	logger.CtxWarn(
		ctx,
		"UnassignSandbox: sandbox %s became in-use during delete, retrying after release",
		sandboxID,
	)
	if releaseErr := s.ReleaseSandbox(ctx, instanceID, sandboxID); releaseErr != nil {
		if ae, ok := apperr.As(releaseErr); ok && ae.Code() == errcode.CommonForbidden {
			return false, apperr.New(errcode.CommonConflict, "sandbox assignment owner changed")
		}
		return false, releaseErr
	}

	return true, nil
}

// GetInstanceSandboxesWithStatus returns all sandboxes for an instance with type, status, and endpoints.
// If typeFilter is non-empty, only sandboxes of that type are returned.
func (s *Service) GetInstanceSandboxesWithStatus(
	ctx context.Context, instanceID, typeFilter string,
) ([]map[string]interface{}, error) {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "instanceID is required")
	}

	typeFilter = strings.TrimSpace(typeFilter)
	if typeFilter != "" && !enum.IsValidSandboxType(typeFilter) {
		return nil, apperr.New(errcode.CommonInvalidParam, "invalid sandbox type: "+typeFilter)
	}

	allLeases, err := s.loadAssignedLeasesStrict(ctx, instanceID)
	if err != nil {
		return nil, err
	}

	filteredLeases := make([]*Lease, 0, len(allLeases))
	for _, lease := range allLeases {
		if typeFilter != "" && lease.Type != typeFilter {
			continue
		}
		filteredLeases = append(filteredLeases, lease)
	}
	if len(filteredLeases) == 0 {
		return []map[string]interface{}{}, nil
	}

	s.refreshLeaseMetadata(ctx, filteredLeases...)

	resourceStatusByID, displayNames, err := s.loadResourceStatusAndNames(ctx, instanceID)
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(filteredLeases))
	for _, lease := range filteredLeases {
		status := s.computeLeaseStatus(lease, resourceStatusByID)
		result = append(result, s.buildInstanceSandboxInfo(lease, instanceID, status, displayNames))
	}

	return result, nil
}

// loadResourceStatusAndNames loads the provider snapshot and returns a
// sandboxID→status map together with display names. It preserves the exact
// error-wrapping semantics of the inline version in
// GetInstanceSandboxesWithStatus.
func (s *Service) loadResourceStatusAndNames(
	ctx context.Context, instanceID string,
) (map[string]ResourceStatus, map[string]string, error) {
	// Build resource status map from the shared snapshot to detect unhealthy sandboxes.
	// The lease only tracks InUse (bool); the provider tracks actual health state.
	resourceStatusByID := map[string]ResourceStatus{}
	resources, _, ok, err := s.Pool.loadSnapshotResources(ctx, "")
	if err != nil {
		return nil, nil, apperr.New(
			errcode.SandboxProviderUnavailable,
			fmt.Sprintf("failed to load sandbox status for instance %s: %v", instanceID, err),
		)
	}
	if !ok {
		return nil, nil, apperr.New(
			errcode.SandboxProviderUnavailable,
			fmt.Sprintf(
				"failed to load sandbox status for instance %s: sandbox resource snapshot unavailable",
				instanceID,
			),
		)
	}
	for _, r := range resources {
		if r != nil {
			sid := r.Type + ":" + r.ResourceID
			resourceStatusByID[sid] = r.Status
		}
	}

	displayNames := buildDisplayNameMap(s.snapshotToDTO(resources))
	return resourceStatusByID, displayNames, nil
}

// computeLeaseStatus maps a lease to its effective status string using the
// provider snapshot. Returns "unhealthy" for missing-but-displayable leases.
func (s *Service) computeLeaseStatus(
	lease *Lease, resourceStatusByID map[string]ResourceStatus,
) string {
	if provStatus, ok := resourceStatusByID[lease.SandboxID]; ok {
		if provStatus != ResourceStatusAvailable {
			return string(provStatus)
		}
		if lease.InUse {
			return string(ResourceStatusInUse)
		}
		return string(ResourceStatusAssigned)
	}

	if s.Pool.shouldDisplayMissingLease(lease, time.Now()) {
		return string(ResourceStatusUnhealthy)
	}

	return string(ResourceStatusUnavailable)
}

// buildInstanceSandboxInfo constructs the map returned per sandbox by
// GetInstanceSandboxesWithStatus.
func (s *Service) buildInstanceSandboxInfo(
	lease *Lease, instanceID, status string, displayNames map[string]string,
) map[string]interface{} {
	info := map[string]interface{}{
		"sandbox_id":  lease.SandboxID,
		"type":        lease.Type,
		"status":      status,
		"in_use":      lease.InUse,
		"instance_id": instanceID,
	}

	if dn, ok := displayNames[lease.SandboxID]; ok && dn != "" {
		info["display_name"] = dn
	} else {
		info["display_name"] = sandboxDisplayNamePrefix(lease.Type)
	}

	endpoint, docsURL, vncURL, vncOpenURL := s.getSandboxEndpoints(lease)
	info["endpoint"] = endpoint
	info["docs_url"] = docsURL
	info["vnc_url"] = vncURL
	info["vnc_open_url"] = vncOpenURL

	return info
}

// CleanupInstanceSandboxes removes any sandbox bindings for an instance.
// It scans lease keys directly so it can also clean up orphaned leases whose
// assignment hash entry is missing.
//
// This method intentionally stays lock-free so outer instance workflows can
// hold the instance assignment lock once and compose cleanup with adjacent
// state changes without deadlocking on the same instance key.
func (s *Service) CleanupInstanceSandboxes(ctx context.Context, instanceID string) error {
	_, err := s.cleanupInstanceSandboxes(ctx, instanceID)
	return err
}

func (s *Service) cleanupInstanceSandboxes(ctx context.Context, instanceID string) (int, error) {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return 0, apperr.New(errcode.CommonInvalidParam, "instanceID is required")
	}

	keys, err := s.Pool.scanResourceKeys(ctx)
	if err != nil {
		return 0, err
	}

	leases := make([]*Lease, 0)
	for _, key := range keys {
		sandboxID := extractSandboxIDFromResourceKey(key)
		lease, leaseErr := s.Pool.GetSandboxByID(ctx, sandboxID)
		if leaseErr != nil || lease == nil {
			continue
		}
		if lease.User != instanceID {
			continue
		}
		leases = append(leases, lease)
	}

	return s.cleanupInstanceLeases(ctx, instanceID, leases)
}

func (s *Service) cleanupInstanceLeases(ctx context.Context, instanceID string, leases []*Lease) (int, error) {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return 0, apperr.New(errcode.CommonInvalidParam, "instanceID is required")
	}

	var firstErr error
	cleaned := 0
	for _, lease := range leases {
		if lease == nil || lease.User != instanceID {
			continue
		}
		done, err := s.cleanupSingleInstanceLease(ctx, instanceID, lease)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		if done {
			cleaned++
		}
	}

	if cleaned > 0 {
		logger.CtxInfo(ctx, "CleanupInstanceSandboxes: instance=%s cleaned_bindings=%d", instanceID, cleaned)
	}

	return cleaned, firstErr
}

// cleanupSingleInstanceLease releases (if in use) and unassigns a single
// lease belonging to instanceID. Returns done=true when the binding was
// removed. Conflict errors from unassign are treated as a silent skip
// (owner changed), matching the original inline behavior.
func (s *Service) cleanupSingleInstanceLease(
	ctx context.Context, instanceID string, lease *Lease,
) (done bool, err error) {
	if lease.InUse {
		if releaseErr := s.ReleaseSandbox(ctx, instanceID, lease.SandboxID); releaseErr != nil {
			logger.CtxWarn(
				ctx,
				"CleanupInstanceSandboxes: failed to release sandbox %s from instance %s: %v",
				lease.SandboxID, instanceID, releaseErr,
			)
			return false, releaseErr
		}
	}

	if unassignErr := s.unassignSandbox(ctx, instanceID, lease.SandboxID); unassignErr != nil {
		if ae, ok := apperr.As(unassignErr); ok && ae.Code() == errcode.CommonConflict {
			logger.CtxInfo(
				ctx,
				"CleanupInstanceSandboxes: skip unassign for sandbox %s "+
					"because owner changed from instance %s",
				lease.SandboxID, instanceID,
			)
			return false, nil
		}
		logger.CtxWarn(
			ctx,
			"CleanupInstanceSandboxes: failed to unassign sandbox %s from instance %s: %v",
			lease.SandboxID, instanceID, unassignErr,
		)
		return false, unassignErr
	}

	return true, nil
}
