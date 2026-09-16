package impl

import (
	"context"
	"testing"

	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"sico-backend/internal/biz/rbac"
	repo "sico-backend/internal/store/organization/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	rolerepo "sico-backend/internal/store/rbac/repository"
	dto "sico-backend/internal/transport/http/dto/organization"
	"sico-backend/internal/transport/http/middleware"
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
		IconUri:     "organization/icon.png",
	}, "creator@example.com")

	require.NoError(t, err)
	require.NotNil(t, repository.created)
	assert.Equal(t, "creator@example.com", repository.created.CreatorUsername)
	assert.Equal(t, "organization/icon.png", repository.created.IconURI)
	assert.Equal(t, int64(42), response.Data.Id)
}

func TestCreateOrganizationInternalAllowsDuplicateName(t *testing.T) {
	repository := &mockOrganizationRepository{}
	service := NewService(&Components{OrgRepo: repository})

	response, err := service.CreateOrganizationInternal(context.Background(), &dto.CreateOrganizationRequest{
		Name: "alex's Organization",
	}, "alex@example.com")

	require.NoError(t, err)
	require.NotNil(t, repository.created)
	assert.Equal(t, "alex's Organization", repository.created.Name)
	assert.Equal(t, int64(42), response.Data.Id)
}

func TestOrganizationModelToDTO(t *testing.T) {
	organization := orgModelToDTO(&repo.OrganizationModel{
		ID:              42,
		Name:            "Example Organization",
		Description:     "Description",
		CreatorUsername: "creator@example.com",
		IconURI:         "",
	})

	assert.Equal(t, int64(42), organization.Id)
	assert.Equal(t, "Example Organization", organization.Name)
	assert.Empty(t, organization.IconSasUrl)
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

type visibilityOrganizationRepo struct {
	repo.OrganizationRepository
	organizations map[int64]*repo.OrganizationModel
}

func (r *visibilityOrganizationRepo) GetByIDs(
	_ context.Context,
	ids []int64,
) ([]*repo.OrganizationModel, error) {
	result := make([]*repo.OrganizationModel, 0, len(ids))
	for _, id := range ids {
		if organization := r.organizations[id]; organization != nil {
			result = append(result, organization)
		}
	}
	return result, nil
}

func (r *visibilityOrganizationRepo) GetByID(
	_ context.Context,
	id int64,
) (*repo.OrganizationModel, error) {
	organization := r.organizations[id]
	if organization == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return organization, nil
}

func (r *visibilityOrganizationRepo) List(
	context.Context,
	string,
	int32,
	int32,
) ([]*repo.OrganizationModel, int64, error) {
	result := make([]*repo.OrganizationModel, 0, len(r.organizations))
	for _, organization := range r.organizations {
		result = append(result, organization)
	}
	return result, int64(len(result)), nil
}

type visibilityProjectRepo struct {
	projectrepo.ProjectRepository
	projects map[int64]*projectrepo.ProjectModel
}

func (r *visibilityProjectRepo) GetProjectByIDs(
	_ context.Context,
	ids []int64,
) ([]*projectrepo.ProjectModel, error) {
	result := make([]*projectrepo.ProjectModel, 0, len(ids))
	for _, id := range ids {
		if project := r.projects[id]; project != nil {
			result = append(result, project)
		}
	}
	return result, nil
}

type visibilityUserRepo struct {
	rolerepo.UserRepository
	users map[string]*rolerepo.UserModel
}

func (r *visibilityUserRepo) GetUserByUsername(
	_ context.Context,
	username string,
) (*rolerepo.UserModel, error) {
	return r.users[username], nil
}

type visibilityRoleRepo struct {
	rolerepo.UserRoleRepository
	roles []*rolerepo.UserRoleModel
}

func (r *visibilityRoleRepo) List(
	_ context.Context,
	filter *rolerepo.UserRoleFilter,
) ([]*rolerepo.UserRoleModel, int64, error) {
	result := make([]*rolerepo.UserRoleModel, 0)
	for _, role := range r.roles {
		if filter.UserID > 0 && role.UserID != filter.UserID {
			continue
		}
		if filter.RoleCode != "" && role.RoleCode != filter.RoleCode {
			continue
		}
		if filter.ScopeType != "" && role.ScopeType != filter.ScopeType {
			continue
		}
		result = append(result, role)
	}
	return result, int64(len(result)), nil
}

func TestListVisibleOrganizationsPermissionMatrix(t *testing.T) {
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
		{rbac.RoleProjectAdmin, "*", "project", "manage"},
		{rbac.RoleProjectMember, "*", "project", "manage"},
	} {
		_, err = enforcer.AddPolicy(policy)
		require.NoError(t, err)
	}
	for _, grouping := range [][]string{
		{"platform@example.com", rbac.RolePlatformAdmin, rbac.ScopePlatform},
		{"org@example.com", rbac.RoleOrgAdmin, "org:10"},
		{"project@example.com", rbac.RoleProjectAdmin, "project:7"},
		{"member@example.com", rbac.RoleProjectMember, "project:7"},
	} {
		_, err = enforcer.AddGroupingPolicy(grouping)
		require.NoError(t, err)
	}
	users := map[string]*rolerepo.UserModel{
		"org@example.com":     {ID: 1, Username: "org@example.com"},
		"project@example.com": {ID: 2, Username: "project@example.com"},
		"member@example.com":  {ID: 3, Username: "member@example.com"},
	}
	userRepo := &visibilityUserRepo{users: users}
	roleRepo := &visibilityRoleRepo{roles: []*rolerepo.UserRoleModel{
		{UserID: 1, RoleCode: rbac.RoleOrgAdmin, ScopeType: rbac.ScopeOrg, ScopeID: "10"},
		{UserID: 2, RoleCode: rbac.RoleProjectAdmin, ScopeType: rbac.ScopeProject, ScopeID: "7"},
		{UserID: 3, RoleCode: rbac.RoleProjectMember, ScopeType: rbac.ScopeProject, ScopeID: "7"},
	}}
	access := rbac.NewAccessServices(userRepo, roleRepo, enforcer, nil)
	service := NewService(&Components{
		OrgRepo: &visibilityOrganizationRepo{organizations: map[int64]*repo.OrganizationModel{
			9: {ID: 9, Name: "Alpha"}, 10: {ID: 10, Name: "Beta"},
		}},
		ProjectRepo: &visibilityProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
			7: {ID: 7, OrganizationID: 9},
		}},
		Access: access,
	})

	tests := []struct {
		name      string
		username  string
		wantNames []string
	}{
		{name: "platform admin", username: "platform@example.com", wantNames: []string{"Alpha", "Beta"}},
		{name: "organization admin", username: "org@example.com", wantNames: []string{"Beta"}},
		{name: "project admin", username: "project@example.com", wantNames: []string{"Alpha"}},
		{name: "project member", username: "member@example.com"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.WithValue(
				context.Background(),
				middleware.ContextUserKey,
				middleware.UserInfo{Name: test.username},
			)
			response, err := service.ListVisibleOrganizations(ctx, &dto.ListOrganizationsRequest{
				Page: 1, PageSize: 10,
			})
			require.NoError(t, err)
			names := make([]string, 0, len(response.Data.Organizations))
			for _, organization := range response.Data.Organizations {
				names = append(names, organization.Name)
			}
			require.ElementsMatch(t, test.wantNames, names)
			require.Equal(t, int32(len(test.wantNames)), response.Data.Total)
			require.False(t, response.Data.HasNext)
		})
	}

	projectContext := context.WithValue(
		context.Background(),
		middleware.ContextUserKey,
		middleware.UserInfo{Name: "project@example.com"},
	)
	_, err = service.GetOrganization(projectContext, &dto.GetOrganizationRequest{Id: 9})
	require.NoError(t, err)
	_, err = service.GetOrganization(projectContext, &dto.GetOrganizationRequest{Id: 10})
	require.Error(t, err)

	orgContext := context.WithValue(
		context.Background(),
		middleware.ContextUserKey,
		middleware.UserInfo{Name: "org@example.com"},
	)
	_, err = service.GetOrganization(orgContext, &dto.GetOrganizationRequest{Id: 10})
	require.NoError(t, err)
	_, err = service.GetOrganization(orgContext, &dto.GetOrganizationRequest{Id: 9})
	require.Error(t, err)
}
