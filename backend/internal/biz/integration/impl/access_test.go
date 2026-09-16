package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/errcode"
)

// Unit fixtures explicitly opt out of authorization; production never does.
type allowTestAccess struct{ rbac.Access }

func (allowTestAccess) Initialized() bool                                          { return true }
func (allowTestAccess) Require(context.Context, rbac.Scope, rbac.Permission) error { return nil }
func (allowTestAccess) RequireOrOwner(context.Context, rbac.Scope, rbac.Permission, string) error {
	return nil
}

func TestIntegrationAccessFailsClosed(t *testing.T) {
	s := NewService(&Components{})
	err := s.requireScope(context.Background(), rbac.ScopeProject, 1, "integration", "use")
	requireAppErrorCode(t, err, errcode.CommonUnavailable)
	require.Error(t, s.requireScopeOrOwner(context.Background(), rbac.ProjectScope(1), rbac.PermissionAssetManage, "user"))
}
