package sandbox

import (
	"context"

	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
)

// Service is the Sandbox contract consumed by transport handlers.
// Provides sandbox lifecycle management with client-based authentication.
type Service interface {
	Start(ctx context.Context) error

	// ==================== Client APIs (require X-Sico-* auth) ====================

	// ApplySandbox returns an available pre-assigned sandbox supplying the
	// requested OS for the instance. Marks the sandbox as in-use. Returns empty
	// result if none available.
	ApplySandbox(ctx context.Context, instanceID, sandboxOS string) (map[string]interface{}, error)

	// ReleaseSandbox marks a sandbox as no longer in use so it can be re-acquired.
	ReleaseSandbox(ctx context.Context, instanceID, sandboxID string) error
	ReleaseAuthorizedSandbox(ctx context.Context, instanceID, sandboxID string) error

	// ResetSandbox soft-resets a sandbox (e.g. close apps, go home for emulator).
	// The lease and assignment are preserved — only the sandbox environment is reset.
	ResetSandbox(ctx context.Context, instanceID, sandboxID string) error
	ResetAuthorizedSandbox(ctx context.Context, sandboxID string) error

	// ==================== Dashboard APIs ====================

	// ListAllResources lists platform inventory without caller visibility filtering.
	// User-facing Dashboard handlers must use ListDashboardResourcesFiltered.
	ListAllResources(ctx context.Context) (map[string]interface{}, error)

	// ListAllResourcesFiltered applies query filters but no caller visibility filtering.
	// It is intended for trusted internal workflows only.
	ListAllResourcesFiltered(ctx context.Context, filter *sandboxdto.ListSandboxResourcesFilter,
	) (map[string]interface{}, error)

	// ListDashboardResourcesFiltered applies the caller's Dashboard visibility
	// scopes while preserving the existing grouped response shape.
	ListDashboardResourcesFiltered(ctx context.Context, filter *sandboxdto.ListSandboxResourcesFilter,
	) (map[string]interface{}, error)

	AuthorizeSandboxOperation(ctx context.Context, sandboxID string, allowOperator bool) error
	AuthorizeSandboxTypeDocs(ctx context.Context, sandboxType string) error
	AuthorizeInstanceOperation(ctx context.Context, instanceID string, allowOperator bool) error
	AuthorizeSandboxAssignment(ctx context.Context, instanceID, sandboxID string) error
	AuthorizeOrganizationSandboxAssign(ctx context.Context) error
	AuthorizeOrganizationSandboxUnassign(ctx context.Context, organizationID int64) error
	AuthorizeProjectSandboxAssignment(ctx context.Context, projectID int64) error
	FilterDashboardInstanceIDs(ctx context.Context, instanceIDs []int64) (map[int64]bool, error)
	GetAuthorizedInstanceVNCURLs(ctx context.Context, instanceID string) ([]map[string]interface{}, error)
	GetAuthorizedInstanceSandboxesWithStatus(
		ctx context.Context, instanceID, osFilter string,
	) ([]map[string]interface{}, error)

	// GetInstanceVNCURLs returns unfiltered VNC URLs for trusted internal workflows.
	// User-facing handlers must use GetAuthorizedInstanceVNCURLs.
	GetInstanceVNCURLs(ctx context.Context, instanceID string) ([]map[string]interface{}, error)

	// GetSandboxVNCURL returns VNC URL for a specific sandbox.
	GetSandboxVNCURL(ctx context.Context, sandboxID string) (map[string]interface{}, error)

	// GetSandboxOpenAPI fetches OpenAPI spec from a sandbox instance of the given type.
	GetSandboxOpenAPI(ctx context.Context, sandboxType string) ([]byte, error)

	// ==================== Sandbox Assignment APIs (Dashboard) ====================

	// AssignSandbox manually assigns a sandbox to an instance (dashboard operation).
	AssignSandbox(ctx context.Context, instanceID string, sandboxID string) error

	// UnassignSandbox removes a sandbox assignment from an instance (dashboard operation).
	// The lease is deleted only if the sandbox is still owned by that instance.
	UnassignSandbox(ctx context.Context, instanceID string, sandboxID string) error

	// AssignSandboxToOrg binds sandboxes to an organization.
	AssignSandboxToOrg(ctx context.Context, orgID int64, sandboxIDs []string) error

	// ClaimUnassignedSandboxesForOrg assigns the initial unowned inventory to one organization once.
	ClaimUnassignedSandboxesForOrg(ctx context.Context, orgID int64) (int, error)

	// UnassignSandboxFromOrg unbinds sandboxes from an organization.
	UnassignSandboxFromOrg(ctx context.Context, orgID int64, sandboxIDs []string) error

	// AssignSandboxToProject binds sandboxes to a project within its organization.
	AssignSandboxToProject(ctx context.Context, projectID, orgID int64, sandboxIDs []string) error

	// UnassignSandboxFromProject unbinds sandboxes from a project.
	UnassignSandboxFromProject(ctx context.Context, projectID int64, sandboxIDs []string) error

	// GetSandboxOrgID returns the org ID a sandbox is assigned to, or 0 if unassigned.
	GetSandboxOrgID(ctx context.Context, sandboxID string) (int64, error)

	// GetSandboxProjectID returns the project ID a sandbox is assigned to, or 0 if unassigned.
	GetSandboxProjectID(ctx context.Context, sandboxID string) (int64, error)

	// GetInstanceSandboxesWithStatus returns unfiltered instance sandboxes for trusted internal workflows.
	// User-facing handlers must use GetAuthorizedInstanceSandboxesWithStatus.
	// osFilter, when non-empty, is an OS selector (e.g. "windows"); empty returns all.
	GetInstanceSandboxesWithStatus(ctx context.Context, instanceID, osFilter string) ([]map[string]interface{}, error)

	// CleanupInstanceSandboxes removes sandbox bindings for an instance.
	// In-use sandboxes are released first, then all matching leases are unassigned.
	// Callers composing larger instance workflows should hold the instance
	// assignment lock around the broader operation.
	CleanupInstanceSandboxes(ctx context.Context, instanceID string) error

	// ==================== Reverse gRPC ====================

	sandboxRgrpc.ReverseSandboxRPCServer
}
