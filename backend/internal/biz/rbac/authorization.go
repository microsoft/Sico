package rbac

import (
	"context"
	"strconv"

	"github.com/casbin/casbin/v2"

	rolerepo "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/internal/transport/http/middleware"
)

// Scope identifies the domain in which a permission is evaluated.
type Scope struct {
	Type string
	ID   string
}

// Permission identifies an action on an RBAC resource.
type Permission struct {
	Resource string
	Action   string
}

// roleAssignmentWriter performs low-level role persistence and Casbin updates.
type roleAssignmentWriter interface {
	AssignUserRoleInternal(ctx context.Context, req *user_role.AssignUserRoleRequest) error
	RemoveUserRoleInternal(ctx context.Context, req *user_role.RemoveUserRoleRequest) error
}

// AccessServices implements authorization and RBAC projections from explicit dependencies.
type AccessServices struct {
	userRepo     rolerepo.UserRepository
	userRoleRepo rolerepo.UserRoleRepository
	enforcer     *casbin.Enforcer
	roleWriter   roleAssignmentWriter
	initialized  bool
}

func NewAccessServices(
	userRepo rolerepo.UserRepository,
	userRoleRepo rolerepo.UserRoleRepository,
	enforcer *casbin.Enforcer,
	roleWriter roleAssignmentWriter,
) *AccessServices {
	return &AccessServices{
		userRepo: userRepo, userRoleRepo: userRoleRepo, enforcer: enforcer,
		roleWriter: roleWriter, initialized: true,
	}
}

func NewUninitializedAccessServices() *AccessServices {
	return &AccessServices{}
}

func (a *AccessServices) Require(ctx context.Context, scope Scope, permission Permission) error {
	if !a.initialized || a.enforcer == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	return checkAccessDomain(
		a.enforcer, username, formatDomainStr(scope.Type, scope.ID), permission.Resource, permission.Action,
	)
}

func (a *AccessServices) RequireOrOwner(
	ctx context.Context,
	scope Scope,
	permission Permission,
	ownerUsername string,
) error {
	if !a.initialized || a.enforcer == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	return checkAccessDomainOrOwner(
		a.enforcer, username, formatDomainStr(scope.Type, scope.ID),
		permission.Resource, permission.Action, ownerUsername,
	)
}

func (a *AccessServices) RequireAgentManageOrOwner(
	ctx context.Context,
	agentID, ownerUsername string,
) error {
	if !a.initialized || a.enforcer == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	if username == ownerUsername {
		return nil
	}
	return checkAccessDomain(
		a.enforcer, username, formatDomainStr(ScopeAgent, agentID),
		PermissionAgentManage.Resource, PermissionAgentManage.Action,
	)
}

func (a *AccessServices) RequireWorkspaceManageOrOwner(
	ctx context.Context,
	projectID int64,
	ownerUsername string,
) error {
	return a.RequireOrOwner(ctx, ProjectScope(projectID), PermissionWorkspaceManage, ownerUsername)
}

func (a *AccessServices) ListOrganizationIDs(
	ctx context.Context,
	permission Permission,
) ([]int64, error) {
	return a.listOrgIDsWithPermission(ctx, permission)
}

func (a *AccessServices) ListAgentIDs(ctx context.Context, permission Permission) ([]string, error) {
	return a.listAgentIDsWithPermission(ctx, permission)
}

func (a *AccessServices) Initialized() bool {
	return a != nil && a.initialized
}

func (a *AccessServices) IsPlatformAdmin(ctx context.Context) bool {
	return a.Require(ctx, PlatformScope(), PermissionOrganizationAdmin) == nil
}

var (
	PermissionOrganizationAdmin  = Permission{Resource: "organization", Action: "admin"}
	PermissionOrganizationManage = Permission{Resource: "organization", Action: "manage"}
	PermissionProjectCreate      = Permission{Resource: "project", Action: "create"}
	PermissionProjectManage      = Permission{Resource: "project", Action: "manage"}
	PermissionAgentManage        = Permission{Resource: "agent", Action: "manage"}
	PermissionSicoDevEntry       = Permission{Resource: "sicodev", Action: "entry"}
	PermissionWorkspaceManage    = Permission{Resource: "dw", Action: "manage"}
	PermissionWorkspaceUse       = Permission{Resource: "dw", Action: "use"}
	PermissionAssetManage        = Permission{Resource: "asset", Action: "manage"}
)

func PlatformScope() Scope {
	return Scope{Type: ScopePlatform}
}

func OrganizationScope(organizationID int64) Scope {
	return Scope{Type: ScopeOrg, ID: strconv.FormatInt(organizationID, 10)}
}

func ProjectScope(projectID int64) Scope {
	return Scope{Type: ScopeProject, ID: strconv.FormatInt(projectID, 10)}
}

func AgentScope(agentID string) Scope {
	return Scope{Type: ScopeAgent, ID: agentID}
}
