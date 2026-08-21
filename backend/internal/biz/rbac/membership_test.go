package rbac

import (
	"testing"

	"github.com/stretchr/testify/assert"

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
