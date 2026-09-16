package rbac_test

import (
	"context"
	"testing"

	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/transport/http/middleware"
)

func TestRequirePreservesUninitializedAllowBehavior(t *testing.T) {
	require.NoError(t, rbac.NewUninitializedAccessServices().Require(
		context.Background(), rbac.ProjectScope(42), rbac.PermissionProjectManage,
	))
}

func TestTypedAuthorizationFacade(t *testing.T) {
	model, err := casbinmodel.NewModelFromString(`
[request_definition]
r = sub, dom, obj, act
[policy_definition]
p = sub, dom, obj, act
[role_definition]
g = _, _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub, r.dom) && (r.dom == p.dom || p.dom == "*") && r.obj == p.obj && r.act == p.act
`)
	require.NoError(t, err)

	enforcer, err := casbin.NewEnforcer(model)
	require.NoError(t, err)
	for _, policy := range [][]string{
		{rbac.RolePlatformAdmin, "*", "organization", "admin"},
		{rbac.RoleOrgAdmin, "*", "organization", "manage"},
		{rbac.RoleOrgAdmin, "*", "project", "create"},
		{rbac.RoleProjectAdmin, "*", "project", "manage"},
		{rbac.RoleAgentEditor, "*", "agent", "manage"},
		{"workspace_owner", "*", "dw", "manage.own"},
	} {
		_, err = enforcer.AddPolicy(policy)
		require.NoError(t, err)
	}
	for _, grouping := range [][]string{
		{"platform-admin", rbac.RolePlatformAdmin, rbac.ScopePlatform},
		{"org-admin", rbac.RoleOrgAdmin, "org:7"},
		{"project-admin", rbac.RoleProjectAdmin, "project:9"},
		{"agent-editor", rbac.RoleAgentEditor, "agent:agent-1"},
		{"workspace-user", "workspace_owner", "project:9"},
	} {
		_, err = enforcer.AddGroupingPolicy(grouping)
		require.NoError(t, err)
	}

	authorizer := rbac.NewAccessServices(nil, nil, enforcer, nil)

	tests := []struct {
		name     string
		username string
		check    func(context.Context) error
		allowed  bool
	}{
		{name: "platform admin", username: "platform-admin", check: func(ctx context.Context) error {
			return authorizer.Require(ctx, rbac.PlatformScope(), rbac.PermissionOrganizationAdmin)
		}, allowed: true},
		{name: "organization manager", username: "org-admin", check: func(ctx context.Context) error {
			return authorizer.Require(ctx, rbac.OrganizationScope(7), rbac.PermissionOrganizationManage)
		}, allowed: true},
		{name: "project creator", username: "org-admin", check: func(ctx context.Context) error {
			return authorizer.Require(ctx, rbac.OrganizationScope(7), rbac.PermissionProjectCreate)
		}, allowed: true},
		{name: "project manager", username: "project-admin", check: func(ctx context.Context) error {
			return authorizer.Require(ctx, rbac.ProjectScope(9), rbac.PermissionProjectManage)
		}, allowed: true},
		{name: "wrong organization", username: "org-admin", check: func(ctx context.Context) error {
			return authorizer.Require(ctx, rbac.OrganizationScope(8), rbac.PermissionOrganizationManage)
		}},
		{name: "wrong action", username: "project-admin", check: func(ctx context.Context) error {
			return authorizer.Require(ctx, rbac.OrganizationScope(9), rbac.PermissionProjectCreate)
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.WithValue(
				context.Background(),
				middleware.ContextUserKey,
				middleware.UserInfo{Name: test.username},
			)
			err := test.check(ctx)
			if test.allowed {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			appError, ok := apperr.As(err)
			require.True(t, ok)
			require.Equal(t, errcode.CommonForbidden, appError.Code())
		})
	}
}

func TestOwnerAuthorizationSemanticsRemainDistinct(t *testing.T) {
	model, err := casbinmodel.NewModelFromString(`
[request_definition]
r = sub, dom, obj, act
[policy_definition]
p = sub, dom, obj, act
[role_definition]
g = _, _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub, r.dom) && (r.dom == p.dom || p.dom == "*") && r.obj == p.obj && r.act == p.act
`)
	require.NoError(t, err)
	enforcer, err := casbin.NewEnforcer(model)
	require.NoError(t, err)
	_, err = enforcer.AddPolicy("workspace_owner", "*", "dw", "manage.own")
	require.NoError(t, err)
	_, err = enforcer.AddGroupingPolicy("alice", "workspace_owner", "project:9")
	require.NoError(t, err)

	authorizer := rbac.NewAccessServices(nil, nil, enforcer, nil)

	aliceContext := context.WithValue(
		context.Background(), middleware.ContextUserKey, middleware.UserInfo{Name: "alice"},
	)
	bobContext := context.WithValue(
		context.Background(), middleware.ContextUserKey, middleware.UserInfo{Name: "bob"},
	)

	// Agent ownership is sufficient without an agent.manage.own policy.
	require.NoError(t, authorizer.RequireAgentManageOrOwner(bobContext, "agent-1", "bob"))

	// Workspace ownership additionally requires the existing dw.manage.own policy.
	require.NoError(t, authorizer.RequireWorkspaceManageOrOwner(aliceContext, 9, "alice"))
	require.Error(t, authorizer.RequireWorkspaceManageOrOwner(bobContext, 9, "bob"))
	require.Error(t, authorizer.RequireWorkspaceManageOrOwner(aliceContext, 9, "someone-else"))
	require.NoError(t, authorizer.RequireOrOwner(
		aliceContext, rbac.ProjectScope(9), rbac.PermissionWorkspaceManage, "alice",
	))
}
