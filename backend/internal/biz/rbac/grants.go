package rbac

import (
	"context"
	"strconv"

	rolerepo "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/transport/http/middleware"
)

// listOrgIDsWithPermission returns the organization IDs where the context user is
// granted (resource, action), derived from their org-scoped role assignments.
func (a *AccessServices) listOrgIDsWithPermission(ctx context.Context, permission Permission) ([]int64, error) {
	if !a.Initialized() || a.enforcer == nil {
		return nil, nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	scopeIDs, err := a.listUserScopeIDs(ctx, username, ScopeOrg)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for _, sid := range scopeIDs {
		allowed, err := a.enforcer.Enforce(
			username, formatDomainStr(ScopeOrg, sid), permission.Resource, permission.Action,
		)
		if err != nil {
			return nil, err
		}
		if !allowed {
			continue
		}
		orgID, perr := strconv.ParseInt(sid, 10, 64)
		if perr != nil {
			continue
		}
		ids = append(ids, orgID)
	}
	return ids, nil
}

// listAgentIDsWithPermission returns the agent IDs (UUIDs) where the context user
// is granted (resource, action), derived from their agent-scoped role assignments.
func (a *AccessServices) listAgentIDsWithPermission(ctx context.Context, permission Permission) ([]string, error) {
	if !a.Initialized() || a.enforcer == nil {
		return nil, nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	scopeIDs, err := a.listUserScopeIDs(ctx, username, ScopeAgent)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, sid := range scopeIDs {
		allowed, err := a.enforcer.Enforce(
			username, formatDomainStr(ScopeAgent, sid), permission.Resource, permission.Action,
		)
		if err != nil {
			return nil, err
		}
		if allowed {
			ids = append(ids, sid)
		}
	}
	return ids, nil
}

// listUserScopeIDs returns the distinct scope IDs of the user's role assignments
// within the given scope type.
func (a *AccessServices) listUserScopeIDs(ctx context.Context, username, scopeType string) ([]string, error) {
	userID, err := a.resolveUserID(ctx, username)
	if err != nil {
		return nil, err
	}
	list, _, err := a.userRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
		UserID:    userID,
		ScopeType: scopeType,
	})
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(list))
	out := make([]string, 0, len(list))
	for _, ur := range list {
		if _, ok := seen[ur.ScopeID]; ok {
			continue
		}
		seen[ur.ScopeID] = struct{}{}
		out = append(out, ur.ScopeID)
	}
	return out, nil
}
