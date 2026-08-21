package rbac

import (
	"context"
	"strconv"

	rolerepo "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/transport/http/middleware"
)

// Initialized reports whether the RBAC service has been wired up. When false
// (e.g. in unit tests) callers should treat access as unrestricted.
func Initialized() bool { return defaultImplService() != nil }

// IsPlatformAdmin reports whether the context user holds organization.admin at
// platform scope. Returns true when RBAC is not initialized.
func IsPlatformAdmin(ctx context.Context) bool {
	return CheckCtxAccess(ctx, ScopePlatform, 0, "organization", "admin") == nil
}

// ListOrgIDsWithPermission returns the organization IDs where the context user is
// granted (resource, action), derived from their org-scoped role assignments.
func ListOrgIDsWithPermission(ctx context.Context, resource, action string) ([]int64, error) {
	svc := defaultImplService()
	if svc == nil || svc.GetEnforcer() == nil {
		return nil, nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	scopeIDs, err := listUserScopeIDs(ctx, username, ScopeOrg)
	if err != nil {
		return nil, err
	}
	enforcer := svc.GetEnforcer()
	var ids []int64
	for _, sid := range scopeIDs {
		allowed, err := enforcer.Enforce(username, formatDomainStr(ScopeOrg, sid), resource, action)
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

// ListAgentIDsWithPermission returns the agent IDs (UUIDs) where the context user
// is granted (resource, action), derived from their agent-scoped role assignments.
func ListAgentIDsWithPermission(ctx context.Context, resource, action string) ([]string, error) {
	svc := defaultImplService()
	if svc == nil || svc.GetEnforcer() == nil {
		return nil, nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	scopeIDs, err := listUserScopeIDs(ctx, username, ScopeAgent)
	if err != nil {
		return nil, err
	}
	enforcer := svc.GetEnforcer()
	var ids []string
	for _, sid := range scopeIDs {
		allowed, err := enforcer.Enforce(username, formatDomainStr(ScopeAgent, sid), resource, action)
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
func listUserScopeIDs(ctx context.Context, username, scopeType string) ([]string, error) {
	userID, err := resolveUserID(ctx, username)
	if err != nil {
		return nil, err
	}
	svc := defaultImplService()
	list, _, err := svc.UserRoleRepo.List(ctx, &rolerepo.UserRoleFilter{
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
