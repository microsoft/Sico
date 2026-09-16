package rbac

import (
	"context"
	"fmt"
	"sort"
	"strconv"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	rolerepo "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/pkg/logger"
)

// assignOrganizationRole assigns an organization-scoped role to a user identified by username.
func (a *AccessServices) assignOrganizationRole(ctx context.Context, username, roleCode string, organizationID int64) error {
	if !a.Initialized() || a.roleWriter == nil {
		return nil
	}

	userID, err := a.resolveUserID(ctx, username)
	if err != nil {
		return err
	}

	return a.roleWriter.AssignUserRoleInternal(ctx, &user_role.AssignUserRoleRequest{
		UserId:    userID,
		RoleCode:  roleCode,
		ScopeType: ScopeOrg,
		ScopeId:   strconv.FormatInt(organizationID, 10),
	})
}

// removeAllOrganizationRoles removes every role assignment in an organization scope.
func (a *AccessServices) removeAllOrganizationRoles(ctx context.Context, organizationID int64) error {
	if !a.Initialized() || a.roleWriter == nil {
		return nil
	}

	scopeID := strconv.FormatInt(organizationID, 10)
	list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
		ScopeType: ScopeOrg,
		ScopeID:   scopeID,
	})
	if err != nil {
		return err
	}

	seen := make(map[string]struct{}, len(list))
	for _, userRole := range list {
		key := fmt.Sprintf("%d:%s", userRole.UserID, userRole.RoleCode)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		if err := a.roleWriter.RemoveUserRoleInternal(ctx, &user_role.RemoveUserRoleRequest{
			UserId:    userRole.UserID,
			RoleCode:  userRole.RoleCode,
			ScopeType: ScopeOrg,
			ScopeId:   scopeID,
		}); err != nil {
			return err
		}
	}
	return nil
}

// getUserOrganizationListByUsername returns all organization-scoped roles grouped by organization.
// roleCodeFilter limits organizations to those containing the role while preserving every role in each result.
func (a *AccessServices) getUserOrganizationListByUsername(
	ctx context.Context, username, roleCodeFilter string,
) ([]OrganizationMembership, error) {
	if !a.Initialized() || a.userRoleRepo == nil {
		return nil, nil
	}

	userID, err := a.resolveUserID(ctx, username)
	if err != nil {
		return nil, err
	}

	list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
		UserID:    userID,
		ScopeType: ScopeOrg,
	})
	if err != nil {
		return nil, err
	}
	return groupOrganizationMemberships(list, roleCodeFilter), nil
}

func groupOrganizationMemberships(
	list []*rolerepo.UserRoleModel, roleCodeFilter string,
) []OrganizationMembership {
	rolesByOrganization := make(map[int64]map[string]struct{})
	for _, userRole := range list {
		organizationID, err := strconv.ParseInt(userRole.ScopeID, 10, 64)
		if err != nil || organizationID <= 0 {
			continue
		}
		if rolesByOrganization[organizationID] == nil {
			rolesByOrganization[organizationID] = make(map[string]struct{})
		}
		rolesByOrganization[organizationID][userRole.RoleCode] = struct{}{}
	}

	memberships := make([]OrganizationMembership, 0, len(rolesByOrganization))
	for organizationID, roleSet := range rolesByOrganization {
		if roleCodeFilter != "" {
			if _, ok := roleSet[roleCodeFilter]; !ok {
				continue
			}
		}
		roleCodes := make([]string, 0, len(roleSet))
		for roleCode := range roleSet {
			roleCodes = append(roleCodes, roleCode)
		}
		sort.Strings(roleCodes)
		memberships = append(memberships, OrganizationMembership{
			OrganizationID: organizationID,
			RoleCodes:      roleCodes,
		})
	}
	sort.Slice(memberships, func(i, j int) bool {
		return memberships[i].OrganizationID > memberships[j].OrganizationID
	})
	return memberships
}

// OrganizationMembership represents all roles a user has in an organization.
type OrganizationMembership struct {
	OrganizationID int64
	RoleCodes      []string
}

// assignProjectRole assigns a project-scoped role to a user identified by username.
// It creates both the t_user_role record and the Casbin grouping policy.
// Returns nil if the RBAC service is not initialized (e.g. in tests).
func (a *AccessServices) assignProjectRole(ctx context.Context, username, roleCode string, projectID int64) error {
	if !a.Initialized() || a.roleWriter == nil {
		return nil
	}

	userID, err := a.resolveUserID(ctx, username)
	if err != nil {
		return err
	}

	return a.roleWriter.AssignUserRoleInternal(ctx, &user_role.AssignUserRoleRequest{
		UserId:    userID,
		RoleCode:  roleCode,
		ScopeType: ScopeProject,
		ScopeId:   strconv.FormatInt(projectID, 10),
	})
}

// removeProjectRole removes a project-scoped role from a user identified by username.
// Returns nil if the RBAC service is not initialized (e.g. in tests).
func (a *AccessServices) removeProjectRole(ctx context.Context, username, roleCode string, projectID int64) error {
	if !a.Initialized() || a.roleWriter == nil {
		return nil
	}

	userID, err := a.resolveUserID(ctx, username)
	if err != nil {
		return err
	}

	return a.roleWriter.RemoveUserRoleInternal(ctx, &user_role.RemoveUserRoleRequest{
		UserId:    userID,
		RoleCode:  roleCode,
		ScopeType: ScopeProject,
		ScopeId:   strconv.FormatInt(projectID, 10),
	})
}

// removeAllProjectRoles removes all user-role assignments for a given project.
// Returns nil if the RBAC service is not initialized.
func (a *AccessServices) removeAllProjectRoles(ctx context.Context, projectID int64) error {
	if !a.Initialized() || a.roleWriter == nil {
		return nil
	}

	// List all users with any role in this project scope, then remove each.
	for _, roleCode := range []string{RoleProjectAdmin, RoleProjectMember} {
		list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
			RoleCode:  roleCode,
			ScopeType: ScopeProject,
			ScopeID:   strconv.FormatInt(projectID, 10),
		})
		if err != nil {
			return err
		}
		for _, ur := range list {
			err = a.roleWriter.RemoveUserRoleInternal(ctx, &user_role.RemoveUserRoleRequest{
				UserId:    ur.UserID,
				RoleCode:  roleCode,
				ScopeType: ScopeProject,
				ScopeId:   strconv.FormatInt(projectID, 10),
			})
			if err != nil {
				logger.CtxError(ctx,
					"failed to remove user role for userID=%d, roleCode=%s, projectID=%d: %v",
					ur.UserID, roleCode, projectID, err,
				)
			}
		}
	}
	return nil
}

// listProjectAdminUsernames returns admin usernames grouped by project ID.
// Returns empty map if the RBAC service is not initialized.
func (a *AccessServices) listProjectAdminUsernames(ctx context.Context, projectIDs []int64) (map[int64][]string, error) {
	return a.listProjectRoleUsernames(ctx, RoleProjectAdmin, projectIDs)
}

// getProjectIDsByAdminUsername returns project IDs where the user is a project admin.
// Returns empty slice if the RBAC service is not initialized.
func (a *AccessServices) getProjectIDsByAdminUsername(ctx context.Context, username string) ([]int64, error) {
	return a.getProjectIDsByUsername(ctx, username, RoleProjectAdmin)
}

// listProjectMemberUsernames returns all usernames that have any role in the given project.
func (a *AccessServices) listProjectMemberUsernames(ctx context.Context, projectID int64) ([]string, error) {
	if !a.Initialized() || a.userRoleRepo == nil {
		return nil, nil
	}

	usernameSet := make(map[string]struct{})
	for _, roleCode := range []string{RoleProjectAdmin, RoleProjectMember} {
		list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
			RoleCode:  roleCode,
			ScopeType: ScopeProject,
			ScopeID:   strconv.FormatInt(projectID, 10),
		})
		if err != nil {
			return nil, err
		}
		for _, ur := range list {
			name, err := a.resolveUsername(ctx, ur.UserID)
			if err != nil {
				continue
			}
			usernameSet[name] = struct{}{}
		}
	}

	usernames := make([]string, 0, len(usernameSet))
	for name := range usernameSet {
		usernames = append(usernames, name)
	}
	return usernames, nil
}

// getUserProjectListByUsername returns (projectID, roleCode) pairs for a user across all project scopes.
// If roleCode is non-empty, only that role is returned. Otherwise all project roles are returned.
func (a *AccessServices) getUserProjectListByUsername(
	ctx context.Context, username string, roleCode string,
) ([]ProjectMembership, int64, error) {
	if !a.Initialized() || a.userRoleRepo == nil {
		return nil, 0, nil
	}

	userID, err := a.resolveUserID(ctx, username)
	if err != nil {
		return nil, 0, err
	}

	return a.getUserProjectMemberships(ctx, userID, roleCode)
}

// ProjectMembership represents a user's role in a project.
type ProjectMembership struct {
	ProjectID int64
	RoleCode  string
}

// --- internal helpers ---

func (a *AccessServices) resolveUserID(ctx context.Context, username string) (int64, error) {
	if !a.Initialized() || a.userRepo == nil {
		return 0, apperr.New(errcode.CommonUnavailable, "RBAC service not initialized")
	}
	user, err := a.userRepo.GetUserByUsername(ctx, username)
	if err != nil {
		return 0, fmt.Errorf("resolve user %q: %w", username, err)
	}
	return user.ID, nil
}

func (a *AccessServices) resolveUsername(ctx context.Context, userID int64) (string, error) {
	if !a.Initialized() || a.userRepo == nil {
		return "", apperr.New(errcode.CommonUnavailable, "RBAC service not initialized")
	}
	user, err := a.userRepo.GetUserByID(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("resolve user ID %d: %w", userID, err)
	}
	return user.Username, nil
}

func (a *AccessServices) listProjectRoleUsernames(
	ctx context.Context,
	roleCode string,
	projectIDs []int64,
) (map[int64][]string, error) {
	if !a.Initialized() || a.userRoleRepo == nil {
		return map[int64][]string{}, nil
	}

	result := make(map[int64][]string, len(projectIDs))
	for _, pid := range projectIDs {
		list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
			RoleCode:  roleCode,
			ScopeType: ScopeProject,
			ScopeID:   strconv.FormatInt(pid, 10),
		})
		if err != nil {
			return nil, err
		}
		usernames := make([]string, 0, len(list))
		for _, ur := range list {
			name, err := a.resolveUsername(ctx, ur.UserID)
			if err != nil {
				continue
			}
			usernames = append(usernames, name)
		}
		if len(usernames) > 0 {
			result[pid] = usernames
		}
	}
	return result, nil
}

func (a *AccessServices) getProjectIDsByUsername(ctx context.Context, username, roleCode string) ([]int64, error) {
	if !a.Initialized() || a.userRoleRepo == nil {
		return nil, nil
	}

	userID, err := a.resolveUserID(ctx, username)
	if err != nil {
		return nil, err
	}

	list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
		UserID:    userID,
		RoleCode:  roleCode,
		ScopeType: ScopeProject,
	})
	if err != nil {
		return nil, err
	}

	ids := make([]int64, 0, len(list))
	for _, ur := range list {
		pid, err := strconv.ParseInt(ur.ScopeID, 10, 64)
		if err != nil {
			continue
		}
		ids = append(ids, pid)
	}
	return ids, nil
}

func (a *AccessServices) getUserProjectMemberships(
	ctx context.Context,
	userID int64,
	roleCodeFilter string,
) ([]ProjectMembership, int64, error) {
	if !a.Initialized() || a.userRoleRepo == nil {
		return nil, 0, nil
	}

	list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
		UserID:    userID,
		RoleCode:  roleCodeFilter,
		ScopeType: ScopeProject,
	})
	if err != nil {
		return nil, 0, err
	}

	memberships := make([]ProjectMembership, 0, len(list))
	for _, ur := range list {
		pid, err := strconv.ParseInt(ur.ScopeID, 10, 64)
		if err != nil {
			continue
		}
		memberships = append(memberships, ProjectMembership{
			ProjectID: pid,
			RoleCode:  ur.RoleCode,
		})
	}
	return memberships, int64(len(memberships)), nil
}
