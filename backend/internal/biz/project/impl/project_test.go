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

package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"sico-backend/internal/infra/storage"
	"sico-backend/internal/store/project/repository"
	projectdto "sico-backend/internal/transport/http/dto/project"
)

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type mockProjectRepo struct {
	repository.ProjectRepository // embed for unimplemented methods
	projects                     map[int64]*repository.ProjectModel
	users                        []*repository.ProjectUserModel
	adminsByProj                 map[int64][]string
	assets                       map[int64]*repository.ProjectAssetModel
	nextProjectID                int64
}

func newMockProjectRepo() *mockProjectRepo {
	return &mockProjectRepo{
		projects:     make(map[int64]*repository.ProjectModel),
		adminsByProj: make(map[int64][]string),
		assets:       make(map[int64]*repository.ProjectAssetModel),
	}
}

func (m *mockProjectRepo) CreateProject(_ context.Context, p *repository.ProjectModel) error {
	m.nextProjectID++
	p.ID = m.nextProjectID
	m.projects[p.ID] = p
	return nil
}

func (m *mockProjectRepo) GetProjectByID(_ context.Context, id int64) (*repository.ProjectModel, error) {
	p, ok := m.projects[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return p, nil
}

func (m *mockProjectRepo) DeleteProject(_ context.Context, id int64) error {
	delete(m.projects, id)
	return nil
}

func (m *mockProjectRepo) UpdateProjectFields(_ context.Context, id int64, fields map[string]interface{}) error {
	p, ok := m.projects[id]
	if !ok {
		return gorm.ErrRecordNotFound
	}
	if v, ok := fields["name"]; ok {
		p.Name = v.(string)
	}
	if v, ok := fields["description"]; ok {
		p.Description = v.(string)
	}
	if v, ok := fields["icon_uri"]; ok {
		p.IconURI = v.(string)
	}
	return nil
}

func (m *mockProjectRepo) AddProjectUser(_ context.Context, u *repository.ProjectUserModel) error {
	m.users = append(m.users, u)
	return nil
}

func (m *mockProjectRepo) DeleteProjectUsers(_ context.Context, _ int64) error {
	return nil
}

func (m *mockProjectRepo) AddProjectAdminsByUsernames(_ context.Context, projectID int64, usernames []string) error {
	m.adminsByProj[projectID] = append(m.adminsByProj[projectID], usernames...)
	return nil
}

func (m *mockProjectRepo) GetProjectAdminUsernames(_ context.Context, projectIDs []int64) (map[int64][]string, error) {
	result := make(map[int64][]string)
	for _, id := range projectIDs {
		if admins, ok := m.adminsByProj[id]; ok {
			result[id] = admins
		}
	}
	return result, nil
}

func (m *mockProjectRepo) DeleteProjectAdmins(_ context.Context, _ int64) error {
	return nil
}

func (m *mockProjectRepo) DeleteProjectAdminsByUsernames(_ context.Context, _ int64, _ []string) error {
	return nil
}

func (m *mockProjectRepo) GetProjectAsset(_ context.Context, id int64) (*repository.ProjectAssetModel, error) {
	a, ok := m.assets[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return a, nil
}

func (m *mockProjectRepo) DeleteProjectAsset(_ context.Context, id int64) error {
	delete(m.assets, id)
	return nil
}

type mockBlobClient struct{}

func (m *mockBlobClient) PutObject(_ context.Context, _ string, _ []byte, _ ...storage.PutOptFn) (string, error) {
	return "blob://path", nil
}
func (m *mockBlobClient) GetObject(_ context.Context, _ string, _ ...storage.GetOptFn) ([]byte, error) {
	return nil, nil
}
func (m *mockBlobClient) DeleteObject(_ context.Context, _ string, _ ...storage.DelOptFn) error {
	return nil
}
func (m *mockBlobClient) GetObjectUrl(_ context.Context, _ string, _ ...storage.GetOptFn) (string, error) {
	return "https://blob.example.com/obj", nil
}
func (m *mockBlobClient) GetObjectUrlByPath(_ context.Context, _ string) (string, error) {
	return "https://blob.example.com/path", nil
}
func (m *mockBlobClient) DelObjectByPath(_ context.Context, _ string) error { return nil }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newProjectTestService(repo *mockProjectRepo) *Service {
	return NewService(&Components{
		ProjectRepo: repo,
		BlobClient:  &mockBlobClient{},
	})
}

// ===========================================================================
// Tests
// ===========================================================================

func TestCreateProject(t *testing.T) {
	repo := newMockProjectRepo()
	svc := newProjectTestService(repo)

	t.Run("success", func(t *testing.T) {
		resp, err := svc.CreateProject(context.Background(), &projectdto.CreateProjectRequest{
			Name:           "My Project",
			Description:    "Test project",
			IconUri:        "icon://test",
			OperatorAdmins: []string{"admin1", "admin2"},
		}, "creator1")
		require.NoError(t, err)
		require.NotNil(t, resp)
		projectID := resp.Data.Id
		assert.Greater(t, projectID, int64(0))

		// Project persisted
		p := repo.projects[projectID]
		require.NotNil(t, p)
		assert.Equal(t, "My Project", p.Name)
		assert.Equal(t, "creator1", p.OwnerUsername)
		assert.Equal(t, "creator1", p.CreatorUsername)

		// Owner membership created
		require.Len(t, repo.users, 1)
		assert.Equal(t, int32(projectdto.MemberType_MEMBER_TYPE_OWNER), repo.users[0].RoleType)
		assert.Equal(t, "creator1", repo.users[0].Username)

		// Admins added
		assert.Equal(t, []string{"admin1", "admin2"}, repo.adminsByProj[projectID])
	})
}

func TestUpdateProject(t *testing.T) {
	repo := newMockProjectRepo()
	repo.projects[1] = &repository.ProjectModel{ID: 1, Name: "Old", Description: "old desc"}
	svc := newProjectTestService(repo)

	t.Run("updates fields", func(t *testing.T) {
		_, err := svc.UpdateProject(context.Background(), &projectdto.UpdateProjectRequest{
			Id:          1,
			Name:        "New Name",
			Description: "new desc",
		})
		require.NoError(t, err)
		assert.Equal(t, "New Name", repo.projects[1].Name)
		assert.Equal(t, "new desc", repo.projects[1].Description)
	})
}

func TestDeleteProject(t *testing.T) {
	repo := newMockProjectRepo()
	repo.projects[1] = &repository.ProjectModel{ID: 1, Name: "ToDelete"}
	svc := newProjectTestService(repo)

	t.Run("success", func(t *testing.T) {
		_, err := svc.DeleteProject(context.Background(), &projectdto.DeleteProjectRequest{Id: 1})
		require.NoError(t, err)
		assert.Empty(t, repo.projects)
	})
}

func TestDeleteProjectAsset(t *testing.T) {
	repo := newMockProjectRepo()
	repo.assets[10] = &repository.ProjectAssetModel{ID: 10, ProjectID: "1", ObjectKey: "file.pdf"}
	svc := newProjectTestService(repo)

	t.Run("success", func(t *testing.T) {
		_, err := svc.DeleteProjectAsset(context.Background(), &projectdto.DeleteProjectAssetRequest{Id: 10})
		require.NoError(t, err)
		assert.Empty(t, repo.assets)
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.DeleteProjectAsset(context.Background(), &projectdto.DeleteProjectAssetRequest{Id: 999})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})
}

func TestGetProject(t *testing.T) {
	repo := newMockProjectRepo()
	svc := newProjectTestService(repo)

	t.Run("not found", func(t *testing.T) {
		_, err := svc.GetProject(context.Background(), &projectdto.GetProjectDetailRequest{Id: 999})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})
}
