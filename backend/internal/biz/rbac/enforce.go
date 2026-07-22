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
