package rbac

import (
	"context"
	"fmt"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
)

// Access is the unified RBAC contract consumed by business domains.
type Access interface {
	Require(ctx context.Context, scope Scope, permission Permission) error
	RequireOrOwner(ctx context.Context, scope Scope, permission Permission, ownerUsername string) error
	RequireAgentManageOrOwner(ctx context.Context, agentID, ownerUsername string) error
	RequireWorkspaceManageOrOwner(ctx context.Context, projectID int64, ownerUsername string) error
	ListOrganizationIDs(ctx context.Context, permission Permission) ([]int64, error)
	ListAgentIDs(ctx context.Context, permission Permission) ([]string, error)
	Initialized() bool
	IsPlatformAdmin(ctx context.Context) bool

	AssignOrganizationRole(ctx context.Context, username, roleCode string, organizationID int64) error
	RemoveAllOrganizationRoles(ctx context.Context, organizationID int64) error
	AssignProjectRole(ctx context.Context, username, roleCode string, projectID int64) error
	RemoveProjectRole(ctx context.Context, username, roleCode string, projectID int64) error
	RemoveAllProjectRoles(ctx context.Context, projectID int64) error

	GetProjectIDsByAdminUsername(ctx context.Context, username string) ([]int64, error)
	GetUserOrganizationListByUsername(
		ctx context.Context,
		username, roleCodeFilter string,
	) ([]OrganizationMembership, error)
	GetUserProjectListByUsername(
		ctx context.Context,
		username, roleCode string,
	) ([]ProjectMembership, int64, error)
	ListProjectAdminUsernames(ctx context.Context, projectIDs []int64) (map[int64][]string, error)
	ListProjectMemberUsernames(ctx context.Context, projectID int64) ([]string, error)

	GetUserSummary(ctx context.Context, username string) (*UserSummary, error)
	GetUserSummaryByID(ctx context.Context, userID int64) (*UserSummary, error)
}

// UserSummary is the transport-independent user projection needed by other domains.
type UserSummary struct {
	ID         int64
	Alias      string
	Username   string
	Email      string
	RawIconURI string
}

func ProvideAccess(access *AccessServices) Access { return access }

func (a *AccessServices) AssignOrganizationRole(
	ctx context.Context,
	username, roleCode string,
	organizationID int64,
) error {
	return a.assignOrganizationRole(ctx, username, roleCode, organizationID)
}

func (a *AccessServices) RemoveAllOrganizationRoles(ctx context.Context, organizationID int64) error {
	return a.removeAllOrganizationRoles(ctx, organizationID)
}

func (a *AccessServices) AssignProjectRole(
	ctx context.Context,
	username, roleCode string,
	projectID int64,
) error {
	return a.assignProjectRole(ctx, username, roleCode, projectID)
}

func (a *AccessServices) RemoveProjectRole(
	ctx context.Context,
	username, roleCode string,
	projectID int64,
) error {
	return a.removeProjectRole(ctx, username, roleCode, projectID)
}

func (a *AccessServices) RemoveAllProjectRoles(ctx context.Context, projectID int64) error {
	return a.removeAllProjectRoles(ctx, projectID)
}

func (a *AccessServices) GetProjectIDsByAdminUsername(
	ctx context.Context,
	username string,
) ([]int64, error) {
	return a.getProjectIDsByAdminUsername(ctx, username)
}

func (a *AccessServices) GetUserOrganizationListByUsername(
	ctx context.Context,
	username, roleCodeFilter string,
) ([]OrganizationMembership, error) {
	return a.getUserOrganizationListByUsername(ctx, username, roleCodeFilter)
}

func (a *AccessServices) GetUserProjectListByUsername(
	ctx context.Context,
	username, roleCode string,
) ([]ProjectMembership, int64, error) {
	return a.getUserProjectListByUsername(ctx, username, roleCode)
}

func (a *AccessServices) ListProjectAdminUsernames(
	ctx context.Context,
	projectIDs []int64,
) (map[int64][]string, error) {
	return a.listProjectAdminUsernames(ctx, projectIDs)
}

func (a *AccessServices) ListProjectMemberUsernames(
	ctx context.Context,
	projectID int64,
) ([]string, error) {
	return a.listProjectMemberUsernames(ctx, projectID)
}

func (a *AccessServices) GetUserSummary(ctx context.Context, username string) (*UserSummary, error) {
	if !a.Initialized() || a.userRepo == nil {
		return nil, nil
	}
	user, err := a.userRepo.GetUserByUsername(ctx, username)
	if err != nil || user == nil {
		return nil, err
	}
	return &UserSummary{
		ID:         user.ID,
		Alias:      user.Alias_,
		Username:   user.Username,
		Email:      user.Email,
		RawIconURI: user.IconURI,
	}, nil
}

func (a *AccessServices) GetUserSummaryByID(ctx context.Context, userID int64) (*UserSummary, error) {
	if !a.Initialized() || a.userRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "RBAC service not initialized")
	}
	user, err := a.userRepo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("resolve user ID %d: %w", userID, err)
	}
	return &UserSummary{
		ID:         user.ID,
		Alias:      user.Alias_,
		Username:   user.Username,
		Email:      user.Email,
		RawIconURI: user.IconURI,
	}, nil
}
