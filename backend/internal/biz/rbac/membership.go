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

package rbac

import (
	"context"
	"fmt"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	rolerepo "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/pkg/logger"
)

// AssignProjectRole assigns a project-scoped role to a user identified by username.
// It creates both the t_user_role record and the Casbin grouping policy.
// Returns nil if the RBAC service is not initialized (e.g. in tests).
func AssignProjectRole(ctx context.Context, username, roleCode string, projectID int64) error {
	impl := defaultImplService()
	if impl == nil {
		return nil
	}

	userID, err := resolveUserID(ctx, username)
	if err != nil {
		return err
	}

	return impl.AssignUserRoleInternal(ctx, &user_role.AssignUserRoleRequest{
		UserId:    userID,
		RoleCode:  roleCode,
		ScopeType: ScopeProject,
		ScopeId:   projectID,
	})
}

// RemoveProjectRole removes a project-scoped role from a user identified by username.
// Returns nil if the RBAC service is not initialized (e.g. in tests).
func RemoveProjectRole(ctx context.Context, username, roleCode string, projectID int64) error {
	impl := defaultImplService()
	if impl == nil {
		return nil
	}

	userID, err := resolveUserID(ctx, username)
	if err != nil {
		return err
	}

	return impl.RemoveUserRoleInternal(ctx, &user_role.RemoveUserRoleRequest{
		UserId:    userID,
		RoleCode:  roleCode,
		ScopeType: ScopeProject,
		ScopeId:   projectID,
	})
}

// RemoveAllProjectRoles removes all user-role assignments for a given project.
// Returns nil if the RBAC service is not initialized.
func RemoveAllProjectRoles(ctx context.Context, projectID int64) error {
	impl := defaultImplService()
	if impl == nil {
		return nil
	}

	// List all users with any role in this project scope, then remove each.
	for _, roleCode := range []string{RoleProjectAdmin, RoleProjectMember} {
		list, _, err := impl.UserRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
			RoleCode:  roleCode,
			ScopeType: ScopeProject,
			ScopeID:   projectID,
		})
		if err != nil {
			return err
		}
		for _, ur := range list {
			err = impl.RemoveUserRoleInternal(ctx, &user_role.RemoveUserRoleRequest{
				UserId:    ur.UserID,
				RoleCode:  roleCode,
				ScopeType: ScopeProject,
				ScopeId:   projectID,
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

// ListProjectAdminUsernames returns admin usernames grouped by project ID.
// Returns empty map if the RBAC service is not initialized.
func ListProjectAdminUsernames(ctx context.Context, projectIDs []int64) (map[int64][]string, error) {
	return listProjectRoleUsernames(ctx, RoleProjectAdmin, projectIDs)
}

// GetProjectIDsByAdminUsername returns project IDs where the user is a project admin.
// Returns empty slice if the RBAC service is not initialized.
func GetProjectIDsByAdminUsername(ctx context.Context, username string) ([]int64, error) {
	return getProjectIDsByUsername(ctx, username, RoleProjectAdmin)
}

// ListProjectMemberUsernames returns all usernames that have any role in the given project.
func ListProjectMemberUsernames(ctx context.Context, projectID int64) ([]string, error) {
	svc := defaultImplService()
	if svc == nil {
		return nil, nil
	}

	usernameSet := make(map[string]struct{})
	for _, roleCode := range []string{RoleProjectAdmin, RoleProjectMember} {
		list, _, err := svc.UserRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
			RoleCode:  roleCode,
			ScopeType: ScopeProject,
			ScopeID:   projectID,
		})
		if err != nil {
			return nil, err
		}
		for _, ur := range list {
			name, err := resolveUsername(ctx, ur.UserID)
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

// GetUserProjectListByUsername returns (projectID, roleCode) pairs for a user across all project scopes.
// If roleCode is non-empty, only that role is returned. Otherwise all project roles are returned.
func GetUserProjectListByUsername(
	ctx context.Context, username string, roleCode string,
) ([]ProjectMembership, int64, error) {
	svc := defaultImplService()
	if svc == nil {
		return nil, 0, nil
	}

	userID, err := resolveUserID(ctx, username)
	if err != nil {
		return nil, 0, err
	}

	return getUserProjectMemberships(ctx, userID, roleCode)
}

// ProjectMembership represents a user's role in a project.
type ProjectMembership struct {
	ProjectID int64
	RoleCode  string
}

// --- internal helpers ---

func resolveUserID(ctx context.Context, username string) (int64, error) {
	svc := defaultImplService()
	if svc == nil {
		return 0, apperr.New(errcode.CommonUnavailable, "RBAC service not initialized")
	}
	user, err := svc.UserRepo.GetUserByUsername(ctx, username)
	if err != nil {
		return 0, fmt.Errorf("resolve user %q: %w", username, err)
	}
	return user.ID, nil
}

func resolveUsername(ctx context.Context, userID int64) (string, error) {
	svc := defaultImplService()
	if svc == nil {
		return "", apperr.New(errcode.CommonUnavailable, "RBAC service not initialized")
	}
	user, err := svc.UserRepo.GetUserByID(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("resolve user ID %d: %w", userID, err)
	}
	return user.Username, nil
}

func listProjectRoleUsernames(ctx context.Context, roleCode string, projectIDs []int64) (map[int64][]string, error) {
	svc := defaultImplService()
	if svc == nil {
		return map[int64][]string{}, nil
	}

	result := make(map[int64][]string, len(projectIDs))
	for _, pid := range projectIDs {
		list, _, err := svc.UserRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
			RoleCode:  roleCode,
			ScopeType: ScopeProject,
			ScopeID:   pid,
		})
		if err != nil {
			return nil, err
		}
		usernames := make([]string, 0, len(list))
		for _, ur := range list {
			name, err := resolveUsername(ctx, ur.UserID)
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

func getProjectIDsByUsername(ctx context.Context, username, roleCode string) ([]int64, error) {
	svc := defaultImplService()
	if svc == nil {
		return nil, nil
	}

	userID, err := resolveUserID(ctx, username)
	if err != nil {
		return nil, err
	}

	list, _, err := svc.UserRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
		UserID:    userID,
		RoleCode:  roleCode,
		ScopeType: ScopeProject,
	})
	if err != nil {
		return nil, err
	}

	ids := make([]int64, 0, len(list))
	for _, ur := range list {
		ids = append(ids, ur.ScopeID)
	}
	return ids, nil
}

func getUserProjectMemberships(ctx context.Context, userID int64, roleCodeFilter string) ([]ProjectMembership, int64, error) {
	svc := defaultImplService()
	if svc == nil {
		return nil, 0, nil
	}

	list, _, err := svc.UserRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
		UserID:    userID,
		RoleCode:  roleCodeFilter,
		ScopeType: ScopeProject,
	})
	if err != nil {
		return nil, 0, err
	}

	memberships := make([]ProjectMembership, 0, len(list))
	for _, ur := range list {
		memberships = append(memberships, ProjectMembership{
			ProjectID: ur.ScopeID,
			RoleCode:  ur.RoleCode,
		})
	}
	return memberships, int64(len(memberships)), nil
}
