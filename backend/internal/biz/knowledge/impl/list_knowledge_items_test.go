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
	"os"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/infra/storage"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/internal/store/knowledge/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	agentdto "sico-backend/internal/transport/http/dto/agent/single_agent"
	"sico-backend/internal/transport/http/dto/knowledge"
)

// mockStorageClient is a minimal storage.Storage for tests.
type mockStorageClient struct{}

func (m *mockStorageClient) PutObject(_ context.Context, _ string, _ []byte, _ ...storage.PutOptFn) (string, error) {
	return "", nil
}
func (m *mockStorageClient) GetObject(_ context.Context, _ string, _ ...storage.GetOptFn) ([]byte, error) {
	return nil, nil
}
func (m *mockStorageClient) DeleteObject(_ context.Context, _ string, _ ...storage.DelOptFn) error {
	return nil
}
func (m *mockStorageClient) GetObjectUrl(_ context.Context, _ string, _ ...storage.GetOptFn) (string, error) {
	return "", nil
}
func (m *mockStorageClient) GetObjectUrlByPath(_ context.Context, _ string) (string, error) {
	return "", nil
}
func (m *mockStorageClient) DelObjectByPath(_ context.Context, _ string) error { return nil }

func TestMain(m *testing.M) {
	storage.SetDefault(&mockStorageClient{})
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Mocks for ListKnowledgeItems tests
// ---------------------------------------------------------------------------

type mockPlaybookRepo struct {
	repository.PlaybookRepository
	playbooks []*repository.KnowledgePlaybookModel
}

func (m *mockPlaybookRepo) GetByID(_ context.Context, id int64) (*repository.KnowledgePlaybookModel, error) {
	for _, pb := range m.playbooks {
		if pb.ID == id {
			return pb, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func (m *mockPlaybookRepo) Delete(_ context.Context, id int64) error {
	for i, pb := range m.playbooks {
		if pb.ID == id {
			m.playbooks = append(m.playbooks[:i], m.playbooks[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockPlaybookRepo) List(
	_ context.Context, filter *repository.PlaybookFilter,
) ([]*repository.KnowledgePlaybookModel, int64, error) {
	var result []*repository.KnowledgePlaybookModel
	for _, pb := range m.playbooks {
		if filter.ProjectID != 0 && pb.ProjectID != filter.ProjectID {
			continue
		}
		result = append(result, pb)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt > result[j].UpdatedAt
	})
	total := int64(len(result))
	if filter.Offset >= len(result) {
		return nil, total, nil
	}
	result = result[filter.Offset:]
	if filter.Limit > 0 && filter.Limit < len(result) {
		result = result[:filter.Limit]
	}
	return result, total, nil
}

type mockPlaybookTagRepo struct {
	repository.PlaybookTagRepository
	deletedIDs []int64
}

func (m *mockPlaybookTagRepo) GetTagsByPlaybookID(_ context.Context, _ int64) ([]*repository.KnowledgeTagModel, error) {
	return nil, nil
}

func (m *mockPlaybookTagRepo) DeletePlaybookTags(_ context.Context, playbookID int64) error {
	m.deletedIDs = append(m.deletedIDs, playbookID)
	return nil
}

type mockProjectRepo struct {
	projectrepo.ProjectRepository
	deliverables []*projectrepo.ProjectDeliverableModel
}

func (m *mockProjectRepo) ListProjectDeliverables(
	_ context.Context, projectID int64, offset, limit int,
) ([]*projectrepo.ProjectDeliverableModel, int64, error) {
	var result []*projectrepo.ProjectDeliverableModel
	for _, d := range m.deliverables {
		if d.ProjectID != projectID {
			continue
		}
		result = append(result, d)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt > result[j].UpdatedAt
	})
	total := int64(len(result))
	if offset >= len(result) {
		return nil, total, nil
	}
	result = result[offset:]
	if limit > 0 && limit < len(result) {
		result = result[:limit]
	}
	return result, total, nil
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func newListItemsService(
	docRepo *mockDocumentRepo,
	playbookRepo *mockPlaybookRepo,
	projectRepo *mockProjectRepo,
) *Service {
	return NewService(&Components{
		DocumentRepo:    docRepo,
		DocumentTagRepo: newMockDocumentTagRepo(),
		PlaybookRepo:    playbookRepo,
		PlaybookTagRepo: &mockPlaybookTagRepo{},
		ProjectRepo:     projectRepo,
	})
}

func TestListKnowledgeItems_CrossEntityOrdering(t *testing.T) {
	docRepo := newMockDocumentRepo()
	docRepo.docs[1] = &repository.KnowledgeDocumentV2Model{ID: 1, ProjectID: 1, UpdatedAt: 100}
	docRepo.docs[2] = &repository.KnowledgeDocumentV2Model{ID: 2, ProjectID: 1, UpdatedAt: 300}

	playbookRepo := &mockPlaybookRepo{
		playbooks: []*repository.KnowledgePlaybookModel{
			{ID: 1, ProjectID: 1, UpdatedAt: 200},
			{ID: 2, ProjectID: 1, UpdatedAt: 500},
		},
	}

	projectRepo := &mockProjectRepo{
		deliverables: []*projectrepo.ProjectDeliverableModel{
			{ID: 1, ProjectID: 1, UpdatedAt: 400},
		},
	}

	svc := newListItemsService(docRepo, playbookRepo, projectRepo)

	resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
		ProjectId: 1,
		Page:      1,
		PageSize:  10,
	})
	require.NoError(t, err)
	require.NotNil(t, resp.Data)

	items := resp.Data.Items
	assert.Equal(t, int32(5), resp.Data.Total)
	assert.Len(t, items, 5)

	// Verify descending order by UpdatedAt.
	expectedUpdatedAts := []int64{500, 400, 300, 200, 100}
	for i, item := range items {
		assert.Equal(t, expectedUpdatedAts[i], item.UpdatedAt, "item %d", i)
	}

	// Verify types match expected order.
	assert.Equal(t, knowledge.KnowledgeItemType_KNOWLEDGE_ITEM_TYPE_PLAYBOOK, items[0].Type)
	assert.Equal(t, knowledge.KnowledgeItemType_KNOWLEDGE_ITEM_TYPE_DELIVERABLE, items[1].Type)
	assert.Equal(t, knowledge.KnowledgeItemType_KNOWLEDGE_ITEM_TYPE_DOCUMENT, items[2].Type)
	assert.Equal(t, knowledge.KnowledgeItemType_KNOWLEDGE_ITEM_TYPE_PLAYBOOK, items[3].Type)
	assert.Equal(t, knowledge.KnowledgeItemType_KNOWLEDGE_ITEM_TYPE_DOCUMENT, items[4].Type)
}

func TestListKnowledgeItems_Pagination(t *testing.T) {
	docRepo := newMockDocumentRepo()
	docRepo.docs[1] = &repository.KnowledgeDocumentV2Model{ID: 1, ProjectID: 1, UpdatedAt: 100}
	docRepo.docs[2] = &repository.KnowledgeDocumentV2Model{ID: 2, ProjectID: 1, UpdatedAt: 200}
	docRepo.docs[3] = &repository.KnowledgeDocumentV2Model{ID: 3, ProjectID: 1, UpdatedAt: 300}

	svc := newListItemsService(docRepo, &mockPlaybookRepo{}, &mockProjectRepo{})

	t.Run("page 1 size 1", func(t *testing.T) {
		resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
			ProjectId: 1,
			Page:      1,
			PageSize:  1,
		})
		require.NoError(t, err)
		assert.Len(t, resp.Data.Items, 1)
		assert.Equal(t, int64(300), resp.Data.Items[0].UpdatedAt)
		assert.True(t, resp.Data.HasNext)
		assert.Equal(t, int32(3), resp.Data.Total)
	})

	t.Run("page 2 size 1", func(t *testing.T) {
		resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
			ProjectId: 1,
			Page:      2,
			PageSize:  1,
		})
		require.NoError(t, err)
		assert.Len(t, resp.Data.Items, 1)
		assert.Equal(t, int64(200), resp.Data.Items[0].UpdatedAt)
		assert.True(t, resp.Data.HasNext)
	})

	t.Run("page 3 size 1 last page", func(t *testing.T) {
		resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
			ProjectId: 1,
			Page:      3,
			PageSize:  1,
		})
		require.NoError(t, err)
		assert.Len(t, resp.Data.Items, 1)
		assert.Equal(t, int64(100), resp.Data.Items[0].UpdatedAt)
		assert.False(t, resp.Data.HasNext)
	})

	t.Run("page beyond total returns empty", func(t *testing.T) {
		resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
			ProjectId: 1,
			Page:      10,
			PageSize:  5,
		})
		require.NoError(t, err)
		assert.Empty(t, resp.Data.Items)
		assert.False(t, resp.Data.HasNext)
	})
}

func TestListKnowledgeItems_DefaultPageSize(t *testing.T) {
	docRepo := newMockDocumentRepo()
	for i := int64(1); i <= 15; i++ {
		docRepo.docs[i] = &repository.KnowledgeDocumentV2Model{ID: i, ProjectID: 1, UpdatedAt: i * 10}
	}

	svc := newListItemsService(docRepo, &mockPlaybookRepo{}, &mockProjectRepo{})

	// Page=0 and PageSize=0 should default to page=1, pageSize=10.
	resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
		ProjectId: 1,
		Page:      0,
		PageSize:  0,
	})
	require.NoError(t, err)
	assert.Len(t, resp.Data.Items, 10)
	assert.True(t, resp.Data.HasNext)
	assert.Equal(t, int32(15), resp.Data.Total)
}

func TestListKnowledgeItems_EmptySources(t *testing.T) {
	svc := newListItemsService(newMockDocumentRepo(), &mockPlaybookRepo{}, &mockProjectRepo{})

	resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
		ProjectId: 1,
		Page:      1,
		PageSize:  10,
	})
	require.NoError(t, err)
	assert.Empty(t, resp.Data.Items)
	assert.Equal(t, int32(0), resp.Data.Total)
	assert.False(t, resp.Data.HasNext)
}

func TestListKnowledgeItems_NilRepos(t *testing.T) {
	// Service with nil repos should still work gracefully.
	svc := NewService(&Components{})

	resp, err := svc.ListKnowledgeItems(context.Background(), &knowledge.ListKnowledgeItemsRequest{
		ProjectId: 1,
		Page:      1,
		PageSize:  10,
	})
	require.NoError(t, err)
	assert.Empty(t, resp.Data.Items)
}

// ---------------------------------------------------------------------------
// mockAgentInstanceRepo for populate tests
// ---------------------------------------------------------------------------

type mockAgentInstanceRepo struct {
	agentrepo.SingleAgentInstanceRepository
	instances []*agententity.SingleAgentInstance
}

func (m *mockAgentInstanceRepo) MGet(_ context.Context, ids []int64) ([]*agententity.SingleAgentInstance, error) {
	idSet := make(map[int64]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}
	var result []*agententity.SingleAgentInstance
	for _, inst := range m.instances {
		if idSet[inst.Id] {
			result = append(result, inst)
		}
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// DeletePlaybook tests
// ---------------------------------------------------------------------------

func TestDeletePlaybook(t *testing.T) {
	playbookRepo := &mockPlaybookRepo{
		playbooks: []*repository.KnowledgePlaybookModel{
			{ID: 1, ProjectID: 1, Name: "pb1"},
			{ID: 2, ProjectID: 1, Name: "pb2"},
		},
	}
	tagRepo := &mockPlaybookTagRepo{}
	svc := NewService(&Components{
		PlaybookRepo:    playbookRepo,
		PlaybookTagRepo: tagRepo,
	})

	t.Run("success", func(t *testing.T) {
		resp, err := svc.DeletePlaybook(context.Background(), &knowledge.DeleteKnowledgePlaybookRequest{Id: 1})
		require.NoError(t, err)
		require.NotNil(t, resp)

		// Playbook removed
		assert.Len(t, playbookRepo.playbooks, 1)
		assert.Equal(t, int64(2), playbookRepo.playbooks[0].ID)

		// Tags cleaned up
		assert.Contains(t, tagRepo.deletedIDs, int64(1))
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.DeletePlaybook(context.Background(), &knowledge.DeleteKnowledgePlaybookRequest{Id: 999})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})

	t.Run("nil repo", func(t *testing.T) {
		nilSvc := NewService(&Components{})
		_, err := nilSvc.DeletePlaybook(context.Background(), &knowledge.DeleteKnowledgePlaybookRequest{Id: 1})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not initialized")
	})
}

// ---------------------------------------------------------------------------
// PopulateExtraInfo tests (OperatorUsername)
// ---------------------------------------------------------------------------

func TestPopulatePlaybookExtraInfo_OperatorUsername(t *testing.T) {
	agentRepo := &mockAgentInstanceRepo{
		instances: []*agententity.SingleAgentInstance{
			{SingleAgentInstance: &agentdto.SingleAgentInstance{
				Id: 100, Name: "Agent A", OperatorUsername: "alice",
			}},
			{SingleAgentInstance: &agentdto.SingleAgentInstance{
				Id: 200, Name: "Agent B", OperatorUsername: "bob",
			}},
		},
	}
	svc := NewService(&Components{AgentInstanceRepo: agentRepo})

	playbooks := []*knowledge.KnowledgePlaybook{
		{Id: 1, AgentInstanceId: 100},
		{Id: 2, AgentInstanceId: 200},
		{Id: 3, AgentInstanceId: 0}, // no agent
	}

	svc.populatePlaybookExtraInfo(context.Background(), playbooks)

	require.NotNil(t, playbooks[0].ExtraInfo)
	assert.Equal(t, "Agent A", playbooks[0].ExtraInfo.AgentInstance.AgentName)
	assert.Equal(t, "alice", playbooks[0].ExtraInfo.AgentInstance.OperatorUsername)

	require.NotNil(t, playbooks[1].ExtraInfo)
	assert.Equal(t, "Agent B", playbooks[1].ExtraInfo.AgentInstance.AgentName)
	assert.Equal(t, "bob", playbooks[1].ExtraInfo.AgentInstance.OperatorUsername)

	assert.Nil(t, playbooks[2].ExtraInfo) // no agent instance
}
