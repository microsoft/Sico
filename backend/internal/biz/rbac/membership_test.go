package rbac

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rolerepo "sico-backend/internal/store/rbac/repository"
)

func TestGroupOrganizationMembershipsPreservesRolesAndFiltersOrganizations(t *testing.T) {
	list := []*rolerepo.UserRoleModel{
		{ScopeID: "20", RoleCode: RoleOrgMember},
		{ScopeID: "20", RoleCode: RoleOrgAdmin},
		{ScopeID: "10", RoleCode: RoleOrgMember},
		{ScopeID: "invalid", RoleCode: RoleOrgAdmin},
	}

	assert.Equal(t, []OrganizationMembership{
		{OrganizationID: 20, RoleCodes: []string{RoleOrgAdmin, RoleOrgMember}},
	}, groupOrganizationMemberships(list, RoleOrgAdmin))
}

func TestAccessServicesPreserveUninitializedBehavior(t *testing.T) {
	ctx := context.Background()
	access := NewUninitializedAccessServices()
	require.False(t, access.Initialized())

	require.NoError(t, access.AssignOrganizationRole(ctx, "alice", RoleOrgMember, 7))
	require.NoError(t, access.RemoveAllOrganizationRoles(ctx, 7))
	require.NoError(t, access.AssignProjectRole(ctx, "alice", RoleProjectMember, 9))
	require.NoError(t, access.RemoveProjectRole(ctx, "alice", RoleProjectMember, 9))
	require.NoError(t, access.RemoveAllProjectRoles(ctx, 9))

	projectIDs, err := access.GetProjectIDsByAdminUsername(ctx, "alice")
	require.NoError(t, err)
	require.Nil(t, projectIDs)

	admins, err := access.ListProjectAdminUsernames(ctx, []int64{9})
	require.NoError(t, err)
	require.Empty(t, admins)

	organizationMemberships, err := access.GetUserOrganizationListByUsername(ctx, "alice", "")
	require.NoError(t, err)
	require.Nil(t, organizationMemberships)

	user, err := access.GetUserSummary(ctx, "alice")
	require.NoError(t, err)
	require.Nil(t, user)
}
