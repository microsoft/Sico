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

package sandbox

import (
	"context"

	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
)

// Service is the Sandbox contract consumed by transport handlers.
// Provides sandbox lifecycle management with client-based authentication.
type Service interface {
	// ==================== Client APIs (require X-Sico-* auth) ====================

	// ApplySandbox returns an available pre-assigned sandbox supplying the
	// requested OS for the instance. Marks the sandbox as in-use. Returns empty
	// result if none available.
	ApplySandbox(ctx context.Context, instanceID, sandboxOS string) (map[string]interface{}, error)

	// ReleaseSandbox marks a sandbox as no longer in use so it can be re-acquired.
	ReleaseSandbox(ctx context.Context, instanceID, sandboxID string) error

	// ResetSandbox soft-resets a sandbox (e.g. close apps, go home for emulator).
	// The lease and assignment are preserved — only the sandbox environment is reset.
	ResetSandbox(ctx context.Context, instanceID, sandboxID string) error

	// ==================== Dashboard APIs ====================

	// ListAllResources lists all sandbox resources grouped by type with status and usage info.
	ListAllResources(ctx context.Context) (map[string]interface{}, error)

	// ListAllResourcesFiltered lists sandbox resources with optional filters.
	ListAllResourcesFiltered(ctx context.Context, filter *sandboxdto.ListSandboxResourcesFilter,
	) (map[string]interface{}, error)

	// GetInstanceVNCURLs returns VNC URLs for all sandboxes of an instance.
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

	// GetInstanceSandboxesWithStatus returns sandboxes for an instance including type, status, and endpoints.
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
