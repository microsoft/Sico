package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"sico-backend/internal/biz/rbac"
	repo "sico-backend/internal/store/organization/repository"
	dto "sico-backend/internal/transport/http/dto/organization"
)

type mockOrganizationRepository struct {
	repo.OrganizationRepository
	created *repo.OrganizationModel
}

func (m *mockOrganizationRepository) GetByName(context.Context, string) (*repo.OrganizationModel, error) {
	return nil, gorm.ErrRecordNotFound
}

func (m *mockOrganizationRepository) Create(_ context.Context, organization *repo.OrganizationModel) error {
	organization.ID = 42
	m.created = organization
	return nil
}

func TestCreateOrganizationStoresCreator(t *testing.T) {
	repository := &mockOrganizationRepository{}
	service := NewService(&Components{OrgRepo: repository})

	response, err := service.CreateOrganization(context.Background(), &dto.CreateOrganizationRequest{
		Name:        "Example Organization",
		Description: "Description",
	}, "creator@example.com")

	require.NoError(t, err)
	require.NotNil(t, repository.created)
	assert.Equal(t, "creator@example.com", repository.created.CreatorUsername)
	assert.Equal(t, int64(42), response.Data.Id)
}

func TestFilterExistingOrganizationMemberships(t *testing.T) {
	memberships := []rbac.OrganizationMembership{
		{OrganizationID: 30, RoleCodes: []string{rbac.RoleOrgMember}},
		{OrganizationID: 20, RoleCodes: []string{rbac.RoleOrgAdmin}},
		{OrganizationID: 10, RoleCodes: []string{rbac.RoleOrgMember}},
	}
	organizations := map[int64]*repo.OrganizationModel{
		30: {ID: 30},
		10: {ID: 10},
	}

	assert.Equal(t, []rbac.OrganizationMembership{
		{OrganizationID: 30, RoleCodes: []string{rbac.RoleOrgMember}},
		{OrganizationID: 10, RoleCodes: []string{rbac.RoleOrgMember}},
	}, filterExistingOrganizationMemberships(memberships, organizations))
}
