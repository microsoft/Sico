package impl

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/store/project/repository"
	projectdto "sico-backend/internal/transport/http/dto/project"
)

func TestMain(m *testing.M) {
	storage.SetDefault(&mockBlobClient{})
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type mockProjectRepo struct {
	repository.ProjectRepository // embed for unimplemented methods
	projects                     map[int64]*repository.ProjectModel
	assets                       map[int64]*repository.ProjectAssetModel
	deliverables                 []*repository.ProjectDeliverableModel
	nextProjectID                int64
	nextAssetID                  int64
	deliverableTotal             int64
	nextDeliverableID            int64
}

func newMockProjectRepo() *mockProjectRepo {
	return &mockProjectRepo{
		projects: make(map[int64]*repository.ProjectModel),
		assets:   make(map[int64]*repository.ProjectAssetModel),
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

func (m *mockProjectRepo) GetProjectAsset(_ context.Context, id int64) (*repository.ProjectAssetModel, error) {
	a, ok := m.assets[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return a, nil
}

func (m *mockProjectRepo) AddProjectAsset(
	_ context.Context, asset *repository.ProjectAssetModel,
) (int64, error) {
	m.nextAssetID++
	asset.ID = m.nextAssetID
	m.assets[asset.ID] = asset
	return asset.ID, nil
}

func (m *mockProjectRepo) GetProjectAssetByObjectKey(
	_ context.Context, projectID, objectKey string,
) (*repository.ProjectAssetModel, error) {
	for _, asset := range m.assets {
		if asset.ProjectID == projectID && asset.ObjectKey == objectKey {
			return asset, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func (m *mockProjectRepo) DeleteProjectAsset(_ context.Context, id int64) error {
	delete(m.assets, id)
	return nil
}

func (m *mockProjectRepo) CreateProjectDeliverable(_ context.Context, record *repository.ProjectDeliverableModel) (int64, error) {
	m.nextDeliverableID++
	record.ID = m.nextDeliverableID
	m.deliverables = append(m.deliverables, record)
	return record.ID, nil
}

func (m *mockProjectRepo) ListProjectDeliverables(
	_ context.Context, _ int64, _, _ int,
) ([]*repository.ProjectDeliverableModel, int64, error) {
	return m.deliverables, m.deliverableTotal, nil
}

func (m *mockProjectRepo) GetProjectDeliverable(_ context.Context, id int64) (*repository.ProjectDeliverableModel, error) {
	for _, d := range m.deliverables {
		if d.ID == id {
			return d, nil
		}
	}
	return nil, fmt.Errorf("not found")
}

func (m *mockProjectRepo) DeleteProjectDeliverable(_ context.Context, id int64) error {
	for i, d := range m.deliverables {
		if d.ID == id {
			m.deliverables = append(m.deliverables[:i], m.deliverables[i+1:]...)
			return nil
		}
	}
	return nil
}

type mockIDGen struct {
	nextID int64
}

func (m *mockIDGen) GenID(_ context.Context) (int64, error) {
	m.nextID++
	return m.nextID, nil
}

func (m *mockIDGen) GenMultiIDs(ctx context.Context, count int) ([]int64, error) {
	ids := make([]int64, 0, count)
	for range count {
		id, err := m.GenID(ctx)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

type mockBlobClient struct {
	streamContent []byte
	objectInfo    *storage.ObjectInfo
}

func (m *mockBlobClient) PutObject(_ context.Context, _ string, _ []byte, _ ...storage.PutOptFn) (string, error) {
	return "blob://path", nil
}
func (m *mockBlobClient) UploadObject(
	_ context.Context, objectKey string, content io.Reader, _ ...storage.PutOptFn,
) (*storage.UploadedObject, error) {
	data, err := io.ReadAll(content)
	if err != nil {
		return nil, err
	}
	m.streamContent = data
	return &storage.UploadedObject{Path: "assets/" + objectKey}, nil
}
func (m *mockBlobClient) CreateUploadURL(
	_ context.Context, objectKey string, _ ...storage.PutOptFn,
) (*storage.UploadURL, error) {
	return &storage.UploadURL{
		Path:      "assets/" + objectKey,
		URL:       "https://blob.example.com/upload/" + objectKey,
		Method:    "PUT",
		Headers:   map[string]string{"x-ms-blob-type": "BlockBlob"},
		ExpiresAt: time.Now().Add(time.Hour),
	}, nil
}
func (m *mockBlobClient) GetObject(_ context.Context, _ string, _ ...storage.GetOptFn) ([]byte, error) {
	return nil, nil
}
func (m *mockBlobClient) GetObjectInfo(
	_ context.Context, objectKey string, _ ...storage.GetOptFn,
) (*storage.ObjectInfo, error) {
	if m.objectInfo == nil {
		return nil, storage.ErrObjectNotFound
	}
	info := *m.objectInfo
	if info.Path == "" {
		info.Path = "assets/" + objectKey
	}
	return &info, nil
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
		IDGen:       &mockIDGen{},
		BlobClient:  &mockBlobClient{},
	})
}

func newProjectTestServiceWithBlob(repo *mockProjectRepo, blobClient *mockBlobClient) *Service {
	return NewService(&Components{ProjectRepo: repo, IDGen: &mockIDGen{}, BlobClient: blobClient})
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

		// Owner membership and admin assignments go through RBAC, which is not
		// initialized in unit tests.
	})
}

func TestProjectRolePriority(t *testing.T) {
	assert.Greater(t, projectRolePriority(rbac.RoleProjectAdmin), projectRolePriority(rbac.RoleProjectMember))
	assert.Greater(t, projectRolePriority(rbac.RoleProjectMember), projectRolePriority("unknown"))
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

func TestAddProjectAsset(t *testing.T) {
	repo := newMockProjectRepo()
	blobClient := &mockBlobClient{}
	svc := newProjectTestServiceWithBlob(repo, blobClient)

	resp, err := svc.AddProjectAsset(
		context.Background(),
		&projectdto.AddProjectAssetRequest{ProjectId: "project-1"},
		"creator1",
		strings.NewReader("hello asset"),
		FileExtraInfo{FileName: "asset.txt", FileSize: 11, ContentType: "text/plain", FileExt: "txt", FileType: "text"},
	)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, []byte("hello asset"), blobClient.streamContent)
	assert.Equal(t, int64(1), resp.Data.Id)
	assert.Equal(t, "assets/1.txt", resp.Data.Uri)
	assert.Equal(t, "asset.txt", resp.Data.MetaInfo.FileName)
	assert.Len(t, repo.assets, 1)
	assert.Equal(t, "1.txt", repo.assets[1].ObjectKey)
}

func TestCreateProjectAssetUploadURL(t *testing.T) {
	repo := newMockProjectRepo()
	svc := newProjectTestServiceWithBlob(repo, &mockBlobClient{})

	resp, err := svc.CreateProjectAssetUploadURL(
		context.Background(),
		&projectdto.CreateProjectAssetUploadURLRequest{
			ProjectId: "project-1", FileName: "video.mp4", FileSize: 20 << 20, ContentType: "video/mp4",
		},
		FileExtraInfo{
			FileName: "video.mp4", FileSize: 20 << 20, ContentType: "video/mp4", FileExt: "mp4", FileType: "video",
		},
	)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "https://blob.example.com/upload/1.mp4", resp.Data.UploadUrl)
	assert.Equal(t, "assets/1.mp4", resp.Data.Uri)
	assert.Equal(t, "1.mp4", resp.Data.ObjectKey)
	assert.Equal(t, "PUT", resp.Data.Method)
	assert.Equal(t, "BlockBlob", resp.Data.Headers["x-ms-blob-type"])
	assert.Empty(t, repo.assets)
}

func TestCompleteProjectAssetUpload(t *testing.T) {
	repo := newMockProjectRepo()
	blobClient := &mockBlobClient{
		objectInfo: &storage.ObjectInfo{Path: "project-1/1.mp4", Size: 20 << 20, ContentType: "video/mp4"},
	}
	svc := newProjectTestServiceWithBlob(repo, blobClient)

	resp, err := svc.CompleteProjectAssetUpload(
		context.Background(),
		&projectdto.CompleteProjectAssetUploadRequest{
			ProjectId:   "project-1",
			ObjectKey:   "1.mp4",
			FileName:    "video.mp4",
			FileSize:    20 << 20,
			ContentType: "video/mp4",
		},
		"creator1",
		FileExtraInfo{
			FileName: "video.mp4", FileSize: 20 << 20, ContentType: "video/mp4", FileExt: "mp4", FileType: "video",
		},
	)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, int64(1), resp.Data.Id)
	assert.Equal(t, "project-1/1.mp4", resp.Data.Uri)
	assert.Len(t, repo.assets, 1)
	assert.Equal(t, "creator1", repo.assets[1].CreatorUsername)
	assert.Equal(t, "1.mp4", repo.assets[1].ObjectKey)
}

func TestCompleteProjectAssetUploadMissingObject(t *testing.T) {
	repo := newMockProjectRepo()
	svc := newProjectTestServiceWithBlob(repo, &mockBlobClient{})

	_, err := svc.CompleteProjectAssetUpload(
		context.Background(),
		&projectdto.CompleteProjectAssetUploadRequest{ProjectId: "project-1", ObjectKey: "1.mp4", FileName: "video.mp4"},
		"creator1",
		FileExtraInfo{FileName: "video.mp4", FileExt: "mp4", FileType: "video"},
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
	assert.Empty(t, repo.assets)
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

// ---------------------------------------------------------------------------
// Deliverable tests
// ---------------------------------------------------------------------------

func TestCreateProjectDeliverable(t *testing.T) {
	repo := newMockProjectRepo()
	svc := newProjectTestService(repo)

	t.Run("success", func(t *testing.T) {
		resp, err := svc.CreateProjectDeliverable(context.Background(), &projectdto.CreateProjectDeliverableRequest{
			ProjectId:       1,
			AgentInstanceId: 100,
			FileUri:         "assets/report.pdf",
			FileName:        "report.pdf",
		}, "creator1")
		require.NoError(t, err)
		require.NotNil(t, resp)
		assert.Greater(t, resp.Data.Id, int64(0))

		// Verify persisted
		require.Len(t, repo.deliverables, 1)
		d := repo.deliverables[0]
		assert.Equal(t, int64(1), d.ProjectID)
		assert.Equal(t, int64(100), d.AgentInstanceID)
		assert.Equal(t, "assets/report.pdf", d.FileURI)
		assert.Equal(t, "report.pdf", d.FileName)
		assert.Equal(t, "creator1", d.CreatorUsername)
	})
}

func TestListProjectDeliverables(t *testing.T) {
	repo := newMockProjectRepo()
	svc := newProjectTestService(repo)

	// Seed deliverables
	repo.deliverables = []*repository.ProjectDeliverableModel{
		{ID: 1, ProjectID: 10, FileName: "a.pdf", FileURI: "assets/a.pdf", CreatorUsername: "u1"},
		{ID: 2, ProjectID: 10, FileName: "b.pdf", FileURI: "assets/b.pdf", CreatorUsername: "u2"},
	}
	repo.deliverableTotal = 2

	t.Run("success", func(t *testing.T) {
		resp, err := svc.ListProjectDeliverables(context.Background(), &projectdto.ListProjectDeliverablesRequest{
			ProjectId: 10,
			Page:      1,
			PageSize:  10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp)
		assert.Equal(t, int32(2), resp.Data.Total)
		assert.Len(t, resp.Data.Deliverables, 2)
		assert.Equal(t, "a.pdf", resp.Data.Deliverables[0].FileName)
	})
}

func TestDeleteProjectDeliverable(t *testing.T) {
	repo := newMockProjectRepo()
	repo.deliverables = []*repository.ProjectDeliverableModel{
		{ID: 1, ProjectID: 10, FileName: "a.pdf"},
		{ID: 2, ProjectID: 10, FileName: "b.pdf"},
	}
	svc := newProjectTestService(repo)

	t.Run("success", func(t *testing.T) {
		resp, err := svc.DeleteProjectDeliverable(
			context.Background(), &projectdto.DeleteProjectDeliverableRequest{Id: 1},
		)
		require.NoError(t, err)
		require.NotNil(t, resp)
		assert.Len(t, repo.deliverables, 1)
		assert.Equal(t, int64(2), repo.deliverables[0].ID)
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.DeleteProjectDeliverable(context.Background(), &projectdto.DeleteProjectDeliverableRequest{Id: 999})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})
}
