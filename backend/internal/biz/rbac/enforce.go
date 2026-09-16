package rbac

import (
	"fmt"

	"github.com/casbin/casbin/v2"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
)

// checkAccessDomainOrOwner tries the full permission first, then falls back to
// the .own variant with an ownership check against ownerUsername.
func checkAccessDomainOrOwner(
	enforcer *casbin.Enforcer,
	username, domain, resource, action, ownerUsername string,
) error {
	firstErr := checkAccessDomain(enforcer, username, domain, resource, action)
	if firstErr == nil {
		return nil
	}
	if ae, ok := apperr.As(firstErr); !ok || ae.Code() != errcode.CommonForbidden {
		return firstErr
	}
	if err := checkAccessDomain(enforcer, username, domain, resource, action+".own"); err != nil {
		return err
	}
	if username != ownerUsername {
		return apperr.New(errcode.CommonForbidden, "can only manage own resources")
	}
	return nil
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
