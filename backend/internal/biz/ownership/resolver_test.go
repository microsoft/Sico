package ownership

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/tenantctx"
	"sico-backend/internal/transport/http/middleware"
)

type membershipAccessStub struct {
	memberships []rbac.OrganizationMembership
}

func (s membershipAccessStub) GetUserOrganizationListByUsername(
	context.Context,
	string, string,
) ([]rbac.OrganizationMembership, error) {
	return s.memberships, nil
}

func tenantTestContext(organizationID int64) context.Context {
	ctx := context.WithValue(context.Background(), middleware.ContextUserKey, middleware.UserInfo{Name: "member@example.com"})
	return tenantctx.WithSelectedOrganization(ctx, organizationID)
}

func TestRequireSelectedAcceptsMembership(t *testing.T) {
	resolver := newResolver(membershipAccessStub{memberships: []rbac.OrganizationMembership{
		{OrganizationID: 7, RoleCodes: []string{rbac.RoleOrgMember}},
	}}, nil, nil, nil, nil)

	organizationID, err := resolver.RequireSelected(tenantTestContext(7))

	require.NoError(t, err)
	require.Equal(t, int64(7), organizationID)
}

func TestRequireSelectedRejectsMissingAndForeignOrganizations(t *testing.T) {
	resolver := newResolver(membershipAccessStub{memberships: []rbac.OrganizationMembership{
		{OrganizationID: 7, RoleCodes: []string{rbac.RoleOrgMember}},
	}}, nil, nil, nil, nil)

	_, err := resolver.RequireSelected(context.WithValue(
		context.Background(), middleware.ContextUserKey, middleware.UserInfo{Name: "member@example.com"},
	))
	requireAppErrorCode(t, err, errcode.CommonInvalidParam)

	_, err = resolver.RequireSelected(tenantTestContext(8))
	requireAppErrorCode(t, err, errcode.CommonForbidden)
}

func TestRequireOrganizationHidesCrossOrganizationResources(t *testing.T) {
	resolver := newResolver(membershipAccessStub{memberships: []rbac.OrganizationMembership{
		{OrganizationID: 7, RoleCodes: []string{rbac.RoleOrgMember}},
	}}, nil, nil, nil, nil)

	require.NoError(t, resolver.RequireOrganization(tenantTestContext(7), 7, false))
	require.NoError(t, resolver.RequireOrganization(tenantTestContext(7), 0, true))
	requireAppErrorCode(t, resolver.RequireOrganization(tenantTestContext(7), 8, false), errcode.CommonNotFound)
}

func TestRequireOrganizationAllowsTrustedInternalOperation(t *testing.T) {
	resolver := newResolver(membershipAccessStub{}, nil, nil, nil, nil)
	ctx := tenantctx.WithTrustedInternal(context.Background())

	require.NoError(t, resolver.RequireOrganization(ctx, 7, false))
}

func requireAppErrorCode(t *testing.T, err error, code int32) {
	t.Helper()
	appError, ok := apperr.As(err)
	require.True(t, ok)
	require.Equal(t, code, appError.Code())
}
