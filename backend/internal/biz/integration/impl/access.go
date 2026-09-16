package impl

import (
	"context"
	"strconv"

	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
)

func (s *Service) requireScope(ctx context.Context, kind string, id int64, resource, action string) error {
	if s == nil || s.Components == nil || s.Access == nil || !s.Access.Initialized() {
		return apperr.New(errcode.CommonUnavailable, "RBAC service unavailable")
	}
	// Preserve the prior platform-admin fallback while using feature/dev's injected Access.
	if err := s.Access.Require(ctx, rbac.PlatformScope(), rbac.PermissionOrganizationAdmin); err == nil {
		return nil
	}
	scope := rbac.Scope{Type: kind, ID: strconv.FormatInt(id, 10)}
	return s.Access.Require(ctx, scope, rbac.Permission{Resource: resource, Action: action})
}

func (s *Service) requireScopeOrOwner(ctx context.Context, scope rbac.Scope, permission rbac.Permission, owner string) error {
	if s == nil || s.Components == nil || s.Access == nil || !s.Access.Initialized() {
		return apperr.New(errcode.CommonUnavailable, "RBAC service unavailable")
	}
	return s.Access.RequireOrOwner(ctx, scope, permission, owner)
}
