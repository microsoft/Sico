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
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"sico-backend/internal/biz/rbac"
	agententity "sico-backend/internal/entity/agent/singleagent"
	redislock "sico-backend/internal/infra/cache/redis"
	cronContract "sico-backend/internal/infra/cron"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
	"sico-backend/pkg/logger"
)

type Service struct {
	sandboxRgrpc.UnimplementedReverseSandboxRPCServer
	Pool          *Pool
	InstanceRepo  agentrepo.SingleAgentInstanceRepository
	ProjectRepo   projectrepo.ProjectRepository
	ProjectAssets emulatorAppProjectAssetLookup
	Access        rbac.Access
}

var errSandboxUnassignLeaseInUse = errors.New("sandbox lease is still in use")

const (
	sandboxOperationLockTTL            = 90 * time.Second
	emulatorAppOperationLockTTL        = 12 * time.Minute
	sandboxOperationLockAcquireTimeout = 2 * time.Second
	sandboxOperationLockRetryInterval  = 100 * time.Millisecond
	maxSandboxOperationLockBatch       = 100
)

type sandboxOperationLockTestHookKey struct{}

type heldSandboxOperationLock struct {
	key   string
	value string
}

const (
	sandboxOperationLockStageContended = "contended"
)

func NewService(
	pool *Pool,
	instanceRepo agentrepo.SingleAgentInstanceRepository,
	cron cronContract.Cron,
) *Service {
	return NewServiceWithProjectAssets(pool, instanceRepo, cron, nil)
}

func NewServiceWithProjectAssets(
	pool *Pool,
	instanceRepo agentrepo.SingleAgentInstanceRepository,
	cron cronContract.Cron,
	projectRepo projectrepo.ProjectRepository,
) *Service {
	return NewServiceWithAccess(
		pool, instanceRepo, cron, projectRepo, rbac.NewUninitializedAccessServices(),
	)
}

func NewServiceWithAccess(
	pool *Pool,
	instanceRepo agentrepo.SingleAgentInstanceRepository,
	_ cronContract.Cron,
	projectRepo projectrepo.ProjectRepository,
	access rbac.Access,
) *Service {
	var projectAssetLookup emulatorAppProjectAssetLookup
	if projectRepo != nil {
		projectAssetLookup = projectRepo
	}
	svc := &Service{
		Pool:          pool,
		InstanceRepo:  instanceRepo,
		ProjectRepo:   projectRepo,
		ProjectAssets: projectAssetLookup,
		Access:        access,
	}

	return svc
}

func (s *Service) access() rbac.Access {
	if s != nil && s.Access != nil {
		return s.Access
	}
	return rbac.NewUninitializedAccessServices()
}

func (s *Service) Start(ctx context.Context) error {
	return s.Pool.Start(ctx)
}

// ==================== New Simplified APIs ====================

// ApplySandbox picks an available sandbox matching an OS selector or the
// concrete Linux Workstation selector from the pool pre-assigned to this instance.
// If all assigned sandboxes are in use or none are assigned, returns an informational response.
func (s *Service) ApplySandbox(ctx context.Context, instanceID, selector string) (map[string]interface{}, error) {
	if instanceID == "" || selector == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "instanceID and sandbox selector are required")
	}
	selector = enum.NormalizeSandboxType(selector)

	var candidateIDs []string
	var resourcesByID map[string]*Resource
	var snapshotAge time.Duration
	var err error
	if isConcreteLinuxWorkstationSelector(selector) {
		candidateIDs, resourcesByID, snapshotAge, err = s.appliableResourcesForType(ctx, selector)
	} else {
		var os enum.SandboxOS
		os, err = resolveSandboxOS(selector)
		if err == nil {
			candidateIDs, resourcesByID, snapshotAge, err = s.appliableResourcesForOS(ctx, os)
		}
	}
	if err != nil {
		return nil, err
	}
	if len(candidateIDs) == 0 {
		logger.CtxInfo(ctx, "No available sandbox for selector %s and instance %s (all in use or none assigned)",
			selector, instanceID)
		return nil, nil
	}
	logger.CtxInfo(ctx, "ApplySandbox: selector=%s candidates=%d age=%s",
		selector, len(candidateIDs), snapshotAge.Round(time.Millisecond))

	lease, err := s.Pool.AcquireAssignedLease(ctx, instanceID, candidateIDs)
	if err != nil {
		return nil, err
	}
	if lease == nil {
		logger.CtxInfo(ctx, "No available sandbox for selector %s and instance %s (all in use or none assigned)",
			selector, instanceID)
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

	if resource := resourcesByID[lease.SandboxID]; resource != nil {
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
		instanceID, lease.SandboxID, lease.Type, endpoint)

	return result, nil
}

// ReleaseSandbox marks a sandbox as no longer in use with a cooldown period.
// The task runtime resets sandboxes on acquire, so release intentionally avoids
// provider reset work to prevent back-to-back release/acquire reset throttling.
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

	lease, err = s.Pool.ReleaseLease(ctx, instanceID, sandboxID)
	if err != nil {
		return err
	}

	logger.CtxInfo(ctx, "Sandbox released: sandbox_id=%s, instance=%s, type=%s", lease.SandboxID, instanceID, lease.Type)
	return nil
}

func (s *Service) ReleaseAuthorizedSandbox(ctx context.Context, instanceID, sandboxID string) error {
	if strings.TrimSpace(instanceID) == "" || strings.TrimSpace(sandboxID) == "" {
		return apperr.New(errcode.CommonInvalidParam, "instanceID and sandboxID are required")
	}

	if err := s.AuthorizeSandboxOperation(ctx, sandboxID, false); err != nil {
		return err
	}
	return s.withSandboxOperationLocks(ctx, []string{sandboxID}, func() error {
		if err := s.AuthorizeSandboxOperation(ctx, sandboxID, false); err != nil {
			return err
		}
		return s.ReleaseSandbox(ctx, instanceID, sandboxID)
	})
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

	resKey := resourceLeaseKey(lease.SandboxID)
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

	provider, ok := s.Pool.GetProvider(lease.Type)
	if !ok {
		return "", docsURL, "", ""
	}
	renderer, ok := provider.(EndpointRenderer)
	if !ok {
		return "", docsURL, "", ""
	}
	endpoints := renderer.RenderEndpoints(lease.ResourceID, lease.Metadata)

	return endpoints.Endpoint, docsURL, endpoints.VNCURL, endpoints.VNCOpenURL
}

// ResetSandbox soft-resets a sandbox environment without releasing the lease.
// For emulator: closes all user apps and returns to home screen.
// For Linux Workstation: clears shell sessions and workspace.
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

func (s *Service) ResetAuthorizedSandbox(ctx context.Context, sandboxID string) error {
	if strings.TrimSpace(sandboxID) == "" {
		return apperr.New(errcode.CommonInvalidParam, "sandboxID is required")
	}

	if err := s.AuthorizeSandboxOperation(ctx, sandboxID, true); err != nil {
		return err
	}
	return s.withSandboxOperationLocks(ctx, []string{sandboxID}, func() error {
		if err := s.AuthorizeSandboxOperation(ctx, sandboxID, true); err != nil {
			return err
		}
		return s.ResetSandbox(ctx, "", sandboxID)
	})
}

// ListAllResources lists all sandbox resources grouped by type
func (s *Service) ListAllResources(ctx context.Context) (map[string]interface{}, error) {
	return s.ListAllResourcesFiltered(ctx, nil)
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
	if r.Metadata != nil {
		if os := r.Metadata["os"]; os != "" {
			info["os"] = os
		}
		if protocol := r.Metadata["protocol"]; protocol != "" {
			info["protocol"] = protocol
		}
	}

	return info
}

func (s *Service) sandboxDisplayNamePrefix(sandboxType string) string {
	provider, ok := s.Pool.GetProvider(sandboxType)
	if !ok {
		return "Unknown"
	}
	displayProvider, ok := provider.(DisplayNameProvider)
	if !ok {
		return "Unknown"
	}
	return displayProvider.DisplayNamePrefix()
}

// buildDisplayNameMap groups resources by type, sorts by resource_id, and assigns
// a sequential display name (e.g. "Android-Device #1") to each sandbox.
// Returns sandboxID → display name string.
func (s *Service) buildDisplayNameMap(resources []*sandboxdto.SandboxResource) map[string]string {
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
		prefix := s.sandboxDisplayNamePrefix(sandboxType)
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
		displayNames := s.buildDisplayNameMap(s.snapshotToDTO(resources))
		if dn, exists := displayNames[lease.SandboxID]; exists && dn != "" {
			return dn
		}
	}

	return s.sandboxDisplayNamePrefix(lease.Type)
}

// getResourceEndpoints returns endpoint, docs URL, and VNC URL for a resource.
// Used by Dashboard's /api/sico/sandbox/list endpoint.
func (s *Service) getResourceEndpoints(r *sandboxdto.SandboxResource) (endpoint, docsURL, vncURL, vncOpenURL string) {
	if r == nil {
		return "", "", "", ""
	}

	// docs_url points to backend API docs endpoint for this sandbox type
	docsURL = fmt.Sprintf("/api/sico/sandbox/docs/%s", r.Type)

	provider, ok := s.Pool.GetProvider(r.Type)
	if !ok {
		return "", docsURL, "", ""
	}
	renderer, ok := provider.(EndpointRenderer)
	if !ok {
		return "", docsURL, "", ""
	}
	endpoints := renderer.RenderEndpoints(r.ResourceId, r.Metadata)

	return endpoints.Endpoint, docsURL, endpoints.VNCURL, endpoints.VNCOpenURL
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
	sandboxType = enum.NormalizeSandboxType(sandboxType)

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

	provider, ok := s.Pool.GetProvider(sandboxType)
	if !ok || provider == nil {
		return nil, apperr.New(errcode.SandboxProviderUnavailable, "provider unavailable for type: "+sandboxType)
	}
	resolver, ok := provider.(OpenAPIResolver)
	if !ok {
		return nil, apperr.New(errcode.CommonInternalError, "openapi resolver not configured for type: "+sandboxType)
	}

	var openAPIURL string
	var openAPIBearerToken string
	for _, r := range availableResources {
		if r == nil {
			continue
		}
		openAPIURL = resolver.OpenAPIURL(r.ResourceID, r.Metadata)
		if openAPIURL != "" {
			if authenticator, ok := provider.(OpenAPIAuthenticator); ok {
				openAPIBearerToken = authenticator.OpenAPIBearerToken(r.ResourceID, r.Metadata)
			}
			break
		}
	}

	if openAPIURL == "" {
		return nil, apperr.New(errcode.CommonNotFound, "no endpoint found for sandbox type: "+sandboxType)
	}
	logger.CtxInfo(ctx, "Fetching OpenAPI from %s", openAPIURL)

	// Fetch OpenAPI spec
	httpCli := newHTTPClient(10 * time.Second)
	data, err := httpCli.getBytes(ctx, openAPIURL, openAPIBearerToken)
	if err != nil {
		logger.CtxError(ctx, "Failed to fetch OpenAPI from %s: %v", openAPIURL, err)
		return nil, apperr.New(errcode.CommonInternalError, "failed to fetch OpenAPI: "+err.Error())
	}

	return data, nil
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

var releaseInstanceAssignLockScript = redis.NewScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`)

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

func (s *Service) withSandboxOperationLocks(
	ctx context.Context,
	sandboxIDs []string,
	fn func() error,
) error {
	return s.withSandboxOperationLocksFor(ctx, sandboxIDs, sandboxOperationLockTTL, fn)
}

func (s *Service) withSandboxOperationLocksFor(
	ctx context.Context,
	sandboxIDs []string,
	lockTTL time.Duration,
	fn func() error,
) error {
	if fn == nil {
		return nil
	}

	lockIDs, err := validateSandboxOperationBatch(sandboxIDs)
	if err != nil {
		return err
	}
	if lockTTL < time.Second {
		return apperr.New(errcode.CommonInvalidParam, "sandbox operation lock TTL must be at least one second")
	}

	if s == nil || s.Pool == nil || s.Pool.GetRedis() == nil {
		return fn()
	}
	sort.Strings(lockIDs)
	rds := s.Pool.GetRedis()
	acquireCtx, cancelAcquire := context.WithTimeout(ctx, sandboxOperationLockAcquireTimeout)
	defer cancelAcquire()
	held, err := acquireSandboxOperationLocks(ctx, acquireCtx, rds, lockIDs, lockTTL)
	defer releaseSandboxOperationLocks(ctx, rds, held)
	if err != nil {
		return err
	}
	return fn()
}

func acquireSandboxOperationLocks(
	ctx, acquireCtx context.Context,
	rds *redis.Client,
	sandboxIDs []string,
	lockTTL time.Duration,
) ([]heldSandboxOperationLock, error) {
	held := make([]heldSandboxOperationLock, 0, len(sandboxIDs))
	for _, sandboxID := range sandboxIDs {
		lock, err := acquireSandboxOperationLock(ctx, acquireCtx, rds, sandboxID, lockTTL)
		if err != nil {
			return held, err
		}
		held = append(held, lock)
	}
	return held, nil
}

func acquireSandboxOperationLock(
	ctx, acquireCtx context.Context,
	rds *redis.Client,
	sandboxID string,
	lockTTL time.Duration,
) (heldSandboxOperationLock, error) {
	lockKey := sandboxOperationLockKey(sandboxID)
	for {
		ok, value, err := redislock.AcquireLockNonblocking(
			acquireCtx,
			rds,
			lockKey,
			int(lockTTL/time.Second),
		)
		if err != nil {
			return heldSandboxOperationLock{}, sandboxOperationLockError(ctx, acquireCtx)
		}
		if ok {
			return heldSandboxOperationLock{key: lockKey, value: value}, nil
		}
		runSandboxOperationLockTestHook(ctx, sandboxOperationLockStageContended, sandboxID)
		select {
		case <-acquireCtx.Done():
			return heldSandboxOperationLock{}, sandboxOperationLockError(ctx, acquireCtx)
		case <-time.After(sandboxOperationLockRetryInterval):
		}
	}
}

func sandboxOperationLockError(ctx, acquireCtx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if acquireCtx.Err() != nil {
		return apperr.New(errcode.CommonConflict, "sandbox operation is busy")
	}
	return apperr.New(errcode.SandboxProviderUnavailable, "failed to acquire sandbox operation lock")
}

func releaseSandboxOperationLocks(
	ctx context.Context,
	rds *redis.Client,
	held []heldSandboxOperationLock,
) {
	for index := len(held) - 1; index >= 0; index-- {
		err := redislock.ReleaseLock(context.Background(), rds, held[index].key, held[index].value)
		if err != nil {
			logger.CtxWarn(ctx, "failed to release sandbox operation lock %s: %v", held[index].key, err)
		}
	}
}

func runSandboxOperationLockTestHook(ctx context.Context, stage, sandboxID string) {
	if ctx == nil {
		return
	}

	hook, ok := ctx.Value(sandboxOperationLockTestHookKey{}).(func(string, string))
	if ok && hook != nil {
		hook(stage, sandboxID)
	}
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

func assignSandboxAtomically(
	ctx context.Context,
	rds *redis.Client,
	instanceID string,
	lease *Lease,
	expectedProjectID, expectedOrganizationID int64,
	allowUnbound bool,
) error {
	if rds == nil || lease == nil {
		return apperr.New(errcode.CommonInvalidParam, "lease is required")
	}

	resKey := resourceLeaseKey(lease.SandboxID)
	aKey := assignKey(instanceID)
	projectKey := projectAssignKey(lease.SandboxID)
	orgKey := orgAssignKey(lease.SandboxID)
	lease.CreatedAt = time.Now()
	payload, marshalErr := json.Marshal(lease)
	if marshalErr != nil {
		return marshalErr
	}

	for range 3 {
		err := rds.Watch(ctx, func(tx *redis.Tx) error {
			return runAssignSandboxTx(
				ctx,
				tx,
				instanceID,
				lease,
				resKey,
				aKey,
				projectKey,
				orgKey,
				payload,
				expectedProjectID,
				expectedOrganizationID,
				allowUnbound,
			)
		}, resKey, aKey, projectKey, orgKey)
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

func runAssignSandboxTx(
	ctx context.Context,
	tx *redis.Tx,
	instanceID string,
	lease *Lease,
	resKey, aKey, projectKey, orgKey string,
	payload []byte,
	expectedProjectID, expectedOrganizationID int64,
	allowUnbound bool,
) error {
	if err := requireRedisKeyType(ctx, tx, aKey, "hash"); err != nil {
		return err
	}
	if err := validateAssignmentScopeValues(
		ctx,
		tx,
		projectKey,
		orgKey,
		expectedProjectID,
		expectedOrganizationID,
		allowUnbound,
	); err != nil {
		return err
	}

	val, getErr := tx.Get(ctx, resKey).Result()
	oldInstanceID, err := loadExistingAssignmentOwner(ctx, tx, val, getErr, instanceID)
	if err != nil {
		return err
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

func validateAssignmentScopeValues(
	ctx context.Context,
	tx *redis.Tx,
	projectKey, orgKey string,
	expectedProjectID, expectedOrganizationID int64,
	allowUnbound bool,
) error {
	projectValue, projectErr := tx.Get(ctx, projectKey).Result()
	orgValue, orgErr := tx.Get(ctx, orgKey).Result()
	if (projectErr != nil && !errors.Is(projectErr, redis.Nil)) ||
		(orgErr != nil && !errors.Is(orgErr, redis.Nil)) {
		return apperr.New(errcode.SandboxProviderUnavailable, "storage error")
	}
	if allowUnbound {
		if projectValue == "" && orgValue == "" {
			return nil
		}
		return apperr.New(errcode.CommonForbidden, "sandbox assignment scopes changed")
	}
	if projectValue != fmt.Sprintf("%d", expectedProjectID) ||
		orgValue != fmt.Sprintf("%d", expectedOrganizationID) {
		return apperr.New(errcode.CommonForbidden, "sandbox assignment scopes changed")
	}
	return nil
}

func loadExistingAssignmentOwner(
	ctx context.Context,
	tx *redis.Tx,
	value string,
	getErr error,
	newInstanceID string,
) (string, error) {
	if getErr != nil {
		if errors.Is(getErr, redis.Nil) {
			return "", nil
		}
		return "", apperr.New(errcode.SandboxProviderUnavailable, "storage error")
	}
	if value == "" {
		return "", nil
	}

	var existingLease Lease
	if err := json.Unmarshal([]byte(value), &existingLease); err != nil {
		return "", apperr.New(errcode.CommonInternalError, "failed to parse existing lease")
	}
	oldInstanceID := strings.TrimSpace(existingLease.User)
	if oldInstanceID == "" || oldInstanceID == newInstanceID {
		return oldInstanceID, nil
	}
	if err := requireRedisKeyType(ctx, tx, assignKey(oldInstanceID), "hash"); err != nil {
		return "", err
	}
	if existingLease.InUse {
		return "", apperr.New(
			errcode.CommonConflict,
			"sandbox is still in use by another instance; release or unassign before reassigning",
		)
	}
	return oldInstanceID, nil
}

func (s *Service) buildLeaseForAssignment(ctx context.Context, instanceID string, sandboxID string) (*Lease, error) {
	parts := strings.SplitN(sandboxID, ":", 2)
	if len(parts) != 2 {
		return nil, apperr.New(errcode.CommonInvalidParam, "invalid sandboxID format, expected type:resourceID")
	}

	sandboxType := enum.NormalizeSandboxType(parts[0])
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
		return s.withSandboxOperationLocks(ctx, []string{sandboxID}, func() error {
			instance, err := s.getInstanceByStringID(ctx, instanceID)
			if err != nil {
				return err
			}
			projectID, organizationID, allowUnbound, err := s.validateAssignmentScope(ctx, sandboxID, instance)
			if err != nil {
				return err
			}

			rds := s.Pool.GetRedis()
			if rds == nil {
				return apperr.New(errcode.SandboxProviderUnavailable, "storage unavailable")
			}

			if err := assignSandboxAtomically(
				ctx,
				rds,
				instanceID,
				lease,
				projectID,
				organizationID,
				allowUnbound,
			); err != nil {
				return err
			}

			logger.CtxInfo(ctx, "Sandbox %s assigned to instance %s", sandboxID, instanceID)
			return nil
		})
	})
}

func (s *Service) validateAssignmentScope(
	ctx context.Context,
	sandboxID string,
	instance *agententity.SingleAgentInstance,
) (int64, int64, bool, error) {
	orgBindings, projectBindings, err := s.loadScopeBindingsStrict(ctx, []string{sandboxID})
	if err != nil {
		return 0, 0, false, err
	}

	projectBinding := projectBindings[sandboxID]
	orgBinding := orgBindings[sandboxID]
	if projectBinding == 0 && orgBinding == 0 {
		return 0, 0, true, nil
	}
	project, err := s.getProject(ctx, instance.ProjectId)
	if err != nil {
		return 0, 0, false, err
	}
	if projectBinding != instance.ProjectId ||
		orgBinding != project.OrganizationID {
		return 0, 0, false, apperr.New(
			errcode.CommonForbidden,
			"sandbox and target instance scopes do not match",
		)
	}
	return instance.ProjectId, project.OrganizationID, false, nil
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
	return s.withSandboxOperationLocks(ctx, []string{sandboxID}, func() error {
		return s.unassignSandboxLocked(ctx, instanceID, sandboxID)
	})
}

func (s *Service) unassignSandboxLocked(ctx context.Context, instanceID string, sandboxID string) error {
	rds := s.Pool.GetRedis()
	if rds == nil {
		return apperr.New(errcode.SandboxProviderUnavailable, "storage unavailable")
	}

	aKey := assignKey(instanceID)
	resKey := resourceLeaseKey(sandboxID)
	for range 3 {
		retry, err := s.unassignSandboxOnce(ctx, rds, instanceID, sandboxID, aKey, resKey)
		if !retry {
			return err
		}
	}

	return apperr.New(errcode.CommonConflict, "sandbox was updated by another process")
}

// unassignSandboxOnce returns retry=true when a concurrent lease update
// requires the caller to repeat the operation.
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
	if err := requireRedisKeyType(ctx, rds, aKey, "hash"); err != nil {
		return false, err
	}
	if lease.InUse {
		return s.unassignReleaseInUseLease(ctx, rds, instanceID, sandboxID, aKey)
	}

	watchErr := rds.Watch(ctx, func(tx *redis.Tx) error {
		return runUnassignDeleteTx(ctx, tx, instanceID, sandboxID, aKey, resKey)
	}, resKey, aKey)
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
// proceed. The caller must re-read the lease before deleting it.
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
	if err := requireRedisKeyType(ctx, tx, aKey, "hash"); err != nil {
		return err
	}
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
// selector, when non-empty, is an OS selector or the concrete Linux Workstation type.
func (s *Service) GetInstanceSandboxesWithStatus(
	ctx context.Context, instanceID, selector string,
) ([]map[string]interface{}, error) {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "instanceID is required")
	}

	allLeases, err := s.loadAssignedLeasesStrict(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	return s.buildInstanceSandboxesWithStatus(ctx, instanceID, selector, allLeases)
}

func (s *Service) buildInstanceSandboxesWithStatus(
	ctx context.Context,
	instanceID, selector string,
	allLeases []*Lease,
) ([]map[string]interface{}, error) {
	selector = strings.TrimSpace(selector)
	os, hasOSFilter, err := resolveInstanceSandboxSelector(selector)
	if err != nil {
		return nil, err
	}

	// An OS filter matches physical leases on their metadata["os"], so refresh
	// from the live snapshot before filtering — otherwise a lease whose stored
	// metadata is stale could be wrongly excluded, diverging from what
	// ApplySandbox (which always reads the fresh snapshot) would select.
	if hasOSFilter {
		s.refreshLeaseMetadata(ctx, allLeases...)
	}

	filteredLeases := make([]*Lease, 0, len(allLeases))
	for _, lease := range allLeases {
		if !leaseMatchesSelector(lease, selector, os, hasOSFilter) {
			continue
		}
		filteredLeases = append(filteredLeases, lease)
	}
	if len(filteredLeases) == 0 {
		return []map[string]interface{}{}, nil
	}

	// With a filter we already refreshed every lease above; otherwise refresh the
	// surviving subset here.
	if !hasOSFilter {
		s.refreshLeaseMetadata(ctx, filteredLeases...)
	}

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

	displayNames := s.buildDisplayNameMap(s.snapshotToDTO(resources))
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
		info["display_name"] = s.sandboxDisplayNamePrefix(lease.Type)
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
