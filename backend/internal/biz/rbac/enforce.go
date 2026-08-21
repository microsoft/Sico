package rbac

import (
	"context"
	"fmt"

	"github.com/casbin/casbin/v2"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/transport/http/middleware"
)

// CheckAccess verifies that the user has the specified permission within a scoped domain.
// scopeType is "platform", "org", or "project"; scopeID is the entity ID (0 for platform).
func CheckAccess(
	enforcer *casbin.Enforcer,
	username, scopeType string,
	scopeID int64,
	resource, action string,
) error {
	domain := formatDomain(scopeType, scopeID)
	allowed, err := enforcer.Enforce(username, domain, resource, action)
	if err != nil {
		return fmt.Errorf("casbin enforce: %w", err)
	}
	if !allowed {
		return apperr.New(errcode.CommonForbidden, "forbidden")
	}
	return nil
}

// CheckAccessOrOwner tries the full permission first, then falls back to the .own
// variant with an ownership check against ownerUsername.
func CheckAccessOrOwner(
	enforcer *casbin.Enforcer,
	username, scopeType string,
	scopeID int64,
	resource, action, ownerUsername string,
) error {
	firstErr := CheckAccess(enforcer, username, scopeType, scopeID, resource, action)
	if firstErr == nil {
		return nil
	}
	if ae, ok := apperr.As(firstErr); !ok || ae.Code() != errcode.CommonForbidden {
		return firstErr
	}
	if err := CheckAccess(enforcer, username, scopeType, scopeID, resource, action+".own"); err != nil {
		return err
	}
	if username != ownerUsername {
		return apperr.New(errcode.CommonForbidden, "can only manage own resources")
	}
	return nil
}

// CheckCtxAccess is a convenience wrapper that extracts the username from the context
// and checks access using the default RBAC enforcer.
// Returns nil (allow) when the RBAC service is not initialized (e.g. in tests).
func CheckCtxAccess(
	ctx context.Context,
	scopeType string,
	scopeID int64,
	resource, action string,
) error {
	svc := Default()
	if svc == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	return CheckAccess(svc.GetEnforcer(), username, scopeType, scopeID, resource, action)
}

// CheckCtxAccessOrOwner is a convenience wrapper that extracts the username from
// the context and checks access with ownership fallback.
// Returns nil (allow) when the RBAC service is not initialized (e.g. in tests).
func CheckCtxAccessOrOwner(
	ctx context.Context,
	scopeType string,
	scopeID int64,
	resource, action, ownerUsername string,
) error {
	svc := Default()
	if svc == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	return CheckAccessOrOwner(svc.GetEnforcer(), username, scopeType, scopeID, resource, action, ownerUsername)
}

func formatDomain(scopeType string, scopeID int64) string {
	if scopeType == "platform" {
		return "platform"
	}
	return fmt.Sprintf("%s:%d", scopeType, scopeID)
}

// formatDomainStr is the string-scope variant of formatDomain, used for scopes
// whose identifier is not numeric (e.g. an agent UUID).
func formatDomainStr(scopeType, scopeID string) string {
	if scopeType == ScopePlatform {
		return ScopePlatform
	}
	return scopeType + ":" + scopeID
}

// checkAccessDomain enforces resource/action for an already-formatted domain.
func checkAccessDomain(enforcer *casbin.Enforcer, username, domain, resource, action string) error {
	allowed, err := enforcer.Enforce(username, domain, resource, action)
	if err != nil {
		return fmt.Errorf("casbin enforce: %w", err)
	}
	if !allowed {
		return apperr.New(errcode.CommonForbidden, "forbidden")
	}
	return nil
}

// CheckCtxAccessScoped is the string-scope variant of CheckCtxAccess, for scopes
// keyed by a non-numeric identifier (e.g. an agent UUID).
// Returns nil (allow) when the RBAC service is not initialized (e.g. in tests).
func CheckCtxAccessScoped(
	ctx context.Context,
	scopeType, scopeID string,
	resource, action string,
) error {
	svc := Default()
	if svc == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	return checkAccessDomain(svc.GetEnforcer(), username, formatDomainStr(scopeType, scopeID), resource, action)
}

// CheckCtxAccessScopedOrIsOwner allows the request when the caller owns the
// resource (caller == ownerUsername), otherwise it requires the scoped
// permission. Unlike CheckCtxAccessOrOwner this does not require a separate
// ".own" permission grant — ownership alone is sufficient.
// Returns nil (allow) when the RBAC service is not initialized (e.g. in tests).
func CheckCtxAccessScopedOrIsOwner(
	ctx context.Context,
	scopeType, scopeID string,
	resource, action, ownerUsername string,
) error {
	svc := Default()
	if svc == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	if username == ownerUsername {
		return nil
	}
	return checkAccessDomain(svc.GetEnforcer(), username, formatDomainStr(scopeType, scopeID), resource, action)
}

// CheckCtxAccessOrPlatformAdmin checks the specified scoped permission, but also
// allows users with organization.admin at platform scope (i.e. platform admins).
func CheckCtxAccessOrPlatformAdmin(
	ctx context.Context,
	scopeType string,
	scopeID int64,
	resource, action string,
) error {
	svc := Default()
	if svc == nil {
		return nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	enforcer := svc.GetEnforcer()

	// Platform admins (organization.admin at platform scope) can do anything.
	if err := CheckAccess(enforcer, username, ScopePlatform, 0, "organization", "admin"); err == nil {
		return nil
	}

	return CheckAccess(enforcer, username, scopeType, scopeID, resource, action)
}
