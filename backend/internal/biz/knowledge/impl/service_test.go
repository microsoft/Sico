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

	"sico-backend/internal/store/knowledge/repository"
	"sico-backend/internal/transport/http/dto/knowledge"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/jwtx"
)

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type mockDocumentRepo struct {
	repository.DocumentRepository
	docs   map[int64]*repository.KnowledgeDocumentV2Model
	nextID int64
}

func newMockDocumentRepo() *mockDocumentRepo {
	return &mockDocumentRepo{docs: make(map[int64]*repository.KnowledgeDocumentV2Model), nextID: 0}
}

func (m *mockDocumentRepo) Create(_ context.Context, doc *repository.KnowledgeDocumentV2Model) (int64, error) {
	m.nextID++
	doc.ID = m.nextID
	m.docs[m.nextID] = doc
	return m.nextID, nil
}

func (m *mockDocumentRepo) GetByID(_ context.Context, id int64) (*repository.KnowledgeDocumentV2Model, error) {
	d, ok := m.docs[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return d, nil
}

func (m *mockDocumentRepo) Update(_ context.Context, doc *repository.KnowledgeDocumentV2Model) error {
	if _, ok := m.docs[doc.ID]; !ok {
		return gorm.ErrRecordNotFound
	}
	m.docs[doc.ID] = doc
	return nil
}

func (m *mockDocumentRepo) Delete(_ context.Context, id int64) error {
	delete(m.docs, id)
	return nil
}

func (m *mockDocumentRepo) List(
	_ context.Context, filter *repository.DocumentV2Filter,
) ([]*repository.KnowledgeDocumentV2Model, int64, error) {
	var result []*repository.KnowledgeDocumentV2Model
	for _, d := range m.docs {
		if filter.ProjectID != 0 && d.ProjectID != filter.ProjectID {
			continue
		}
		result = append(result, d)
	}
	total := int64(len(result))
	end := filter.Offset + filter.Limit
	if end > len(result) {
		end = len(result)
	}
	if filter.Offset >= len(result) {
		return nil, total, nil
	}
	return result[filter.Offset:end], total, nil
}

type mockTagRepo struct {
	repository.KnowledgeTagRepository
	tags   map[int64]*repository.KnowledgeTagModel
	nextID int64
}

func newMockTagRepo() *mockTagRepo {
	return &mockTagRepo{tags: make(map[int64]*repository.KnowledgeTagModel), nextID: 0}
}

func (m *mockTagRepo) Create(_ context.Context, tag *repository.KnowledgeTagModel) (int64, error) {
	m.nextID++
	tag.ID = m.nextID
	m.tags[m.nextID] = tag
	return m.nextID, nil
}

func (m *mockTagRepo) GetByID(_ context.Context, id int64) (*repository.KnowledgeTagModel, error) {
	t, ok := m.tags[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return t, nil
}

func (m *mockTagRepo) Update(_ context.Context, tag *repository.KnowledgeTagModel) error {
	m.tags[tag.ID] = tag
	return nil
}

func (m *mockTagRepo) Delete(_ context.Context, id int64) error {
	delete(m.tags, id)
	return nil
}

type mockDocumentTagRepo struct {
	repository.DocumentTagRepository
	tagsByDoc map[int64][]int64
}

func newMockDocumentTagRepo() *mockDocumentTagRepo {
	return &mockDocumentTagRepo{tagsByDoc: make(map[int64][]int64)}
}

func (m *mockDocumentTagRepo) CreateDocumentTags(_ context.Context, docID int64, tagIDs []int64) error {
	m.tagsByDoc[docID] = append(m.tagsByDoc[docID], tagIDs...)
	return nil
}

func (m *mockDocumentTagRepo) DeleteDocumentTags(_ context.Context, docID int64) error {
	delete(m.tagsByDoc, docID)
	return nil
}

func (m *mockDocumentTagRepo) GetTagsByDocumentID(_ context.Context, _ int64) ([]*repository.KnowledgeTagModel, error) {
	return nil, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func ctxWithUser(username string) context.Context {
	// Use the same key ("user") and type (jwtx.UserInfo) that middleware uses,
	// without importing middleware (which triggers Redis init).
	return context.WithValue(
		context.Background(),
		middleware.ContextUserKey,
		jwtx.UserInfo{Name: username},
	)
}

func newKnowledgeTestService(docRepo *mockDocumentRepo, tagRepo *mockTagRepo, docTagRepo *mockDocumentTagRepo) *Service {
	return NewService(&Components{
		DocumentRepo:     docRepo,
		KnowledgeTagRepo: tagRepo,
		DocumentTagRepo:  docTagRepo,
	})
}

// ===========================================================================
// Knowledge Tag Tests
// ===========================================================================

func TestCreateKnowledgeTag(t *testing.T) {
	tagRepo := newMockTagRepo()
	svc := newKnowledgeTestService(nil, tagRepo, nil)

	t.Run("success", func(t *testing.T) {
		resp, err := svc.CreateKnowledgeTag(ctxWithUser("alice"), &knowledge.CreateKnowledgeTagRequest{
			ProjectId:   1,
			Name:        "important",
			Description: "high priority items",
		})
		require.NoError(t, err)
		require.NotNil(t, resp)
		assert.Greater(t, resp.Data.Id, int64(0))

		stored := tagRepo.tags[resp.Data.Id]
		assert.Equal(t, "important", stored.Name)
		assert.Equal(t, "alice", stored.CreatorUsername)
	})

	t.Run("missing project and name", func(t *testing.T) {
		_, err := svc.CreateKnowledgeTag(ctxWithUser("alice"), &knowledge.CreateKnowledgeTagRequest{})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "required")
	})
}

func TestGetKnowledgeTag(t *testing.T) {
	tagRepo := newMockTagRepo()
	tagRepo.tags[1] = &repository.KnowledgeTagModel{ID: 1, ProjectID: 10, Name: "tag1", Description: "desc"}
	svc := newKnowledgeTestService(nil, tagRepo, nil)

	t.Run("found", func(t *testing.T) {
		resp, err := svc.GetKnowledgeTag(ctxWithUser("alice"), &knowledge.GetKnowledgeTagRequest{Id: 1})
		require.NoError(t, err)
		assert.Equal(t, "tag1", resp.Data.Tag.Name)
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.GetKnowledgeTag(ctxWithUser("alice"), &knowledge.GetKnowledgeTagRequest{Id: 999})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})
}

func TestUpdateKnowledgeTag(t *testing.T) {
	tagRepo := newMockTagRepo()
	tagRepo.tags[1] = &repository.KnowledgeTagModel{ID: 1, ProjectID: 10, Name: "old", Description: "old desc"}
	svc := newKnowledgeTestService(nil, tagRepo, nil)

	t.Run("updates name and description", func(t *testing.T) {
		_, err := svc.UpdateKnowledgeTag(ctxWithUser("alice"), &knowledge.UpdateKnowledgeTagRequest{
			Id: 1, Name: "new", Description: "new desc",
		})
		require.NoError(t, err)
		assert.Equal(t, "new", tagRepo.tags[1].Name)
		assert.Equal(t, "new desc", tagRepo.tags[1].Description)
	})

	t.Run("partial update keeps existing fields", func(t *testing.T) {
		_, err := svc.UpdateKnowledgeTag(ctxWithUser("alice"), &knowledge.UpdateKnowledgeTagRequest{
			Id: 1, Name: "partial",
		})
		require.NoError(t, err)
		assert.Equal(t, "partial", tagRepo.tags[1].Name)
		assert.Equal(t, "new desc", tagRepo.tags[1].Description) // unchanged
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.UpdateKnowledgeTag(ctxWithUser("alice"), &knowledge.UpdateKnowledgeTagRequest{Id: 999, Name: "x"})
		require.Error(t, err)
	})
}

func TestDeleteKnowledgeTag(t *testing.T) {
	tagRepo := newMockTagRepo()
	tagRepo.tags[1] = &repository.KnowledgeTagModel{ID: 1, Name: "tag1"}
	svc := newKnowledgeTestService(nil, tagRepo, nil)

	t.Run("success", func(t *testing.T) {
		_, err := svc.DeleteKnowledgeTag(ctxWithUser("alice"), &knowledge.DeleteKnowledgeTagRequest{Id: 1})
		require.NoError(t, err)
		assert.Empty(t, tagRepo.tags)
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.DeleteKnowledgeTag(ctxWithUser("alice"), &knowledge.DeleteKnowledgeTagRequest{Id: 999})
		require.Error(t, err)
	})
}

// ===========================================================================
// Knowledge Document Tests
// ===========================================================================

func TestCreateDocument(t *testing.T) {
	docRepo := newMockDocumentRepo()
	docTagRepo := newMockDocumentTagRepo()
	svc := newKnowledgeTestService(docRepo, nil, docTagRepo)

	t.Run("file document", func(t *testing.T) {
		resp, err := svc.CreateDocument(ctxWithUser("bob"), &knowledge.CreateKnowledgeDocumentRequest{
			ProjectId:    1,
			AssetId:      100,
			DocumentType: knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE,
			TagIds:       []int64{10, 20},
		})
		require.NoError(t, err)
		assert.Greater(t, resp.Data.Id, int64(0))

		doc := docRepo.docs[resp.Data.Id]
		assert.Equal(t, int64(1), doc.ProjectID)
		assert.Equal(t, "bob", doc.CreatorUsername)

		// Tags should be associated
		assert.Equal(t, []int64{10, 20}, docTagRepo.tagsByDoc[resp.Data.Id])
	})

	t.Run("link document", func(t *testing.T) {
		resp, err := svc.CreateDocument(ctxWithUser("bob"), &knowledge.CreateKnowledgeDocumentRequest{
			ProjectId:    1,
			LinkUrl:      "https://example.com/doc",
			DocumentType: knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_LINK,
		})
		require.NoError(t, err)
		doc := docRepo.docs[resp.Data.Id]
		assert.Equal(t, "https://example.com/doc", doc.LinkURL)
	})

	t.Run("missing project and agent", func(t *testing.T) {
		_, err := svc.CreateDocument(ctxWithUser("bob"), &knowledge.CreateKnowledgeDocumentRequest{
			DocumentType: knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE,
			AssetId:      1,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "projectId or agentId")
	})

	t.Run("unknown document type", func(t *testing.T) {
		_, err := svc.CreateDocument(ctxWithUser("bob"), &knowledge.CreateKnowledgeDocumentRequest{
			ProjectId: 1,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "documentType")
	})

	t.Run("file without asset", func(t *testing.T) {
		_, err := svc.CreateDocument(ctxWithUser("bob"), &knowledge.CreateKnowledgeDocumentRequest{
			ProjectId:    1,
			DocumentType: knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "assetId")
	})

	t.Run("link without url", func(t *testing.T) {
		_, err := svc.CreateDocument(ctxWithUser("bob"), &knowledge.CreateKnowledgeDocumentRequest{
			ProjectId:    1,
			DocumentType: knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_LINK,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "linkUrl")
	})
}

func TestDeleteDocument(t *testing.T) {
	docRepo := newMockDocumentRepo()
	docTagRepo := newMockDocumentTagRepo()
	docRepo.docs[1] = &repository.KnowledgeDocumentV2Model{ID: 1, ProjectID: 10, Name: "doc1"}
	docTagRepo.tagsByDoc[1] = []int64{10, 20}
	svc := newKnowledgeTestService(docRepo, nil, docTagRepo)

	t.Run("success", func(t *testing.T) {
		_, err := svc.DeleteDocument(ctxWithUser("bob"), &knowledge.DeleteKnowledgeDocumentRequest{Id: 1})
		require.NoError(t, err)
		assert.Empty(t, docRepo.docs)
		assert.Empty(t, docTagRepo.tagsByDoc)
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.DeleteDocument(ctxWithUser("bob"), &knowledge.DeleteKnowledgeDocumentRequest{Id: 999})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})
}

func TestUpdateDocument(t *testing.T) {
	docRepo := newMockDocumentRepo()
	docTagRepo := newMockDocumentTagRepo()
	docRepo.docs[1] = &repository.KnowledgeDocumentV2Model{
		ID: 1, ProjectID: 10, Name: "original", LinkURL: "https://old.com",
	}
	svc := newKnowledgeTestService(docRepo, nil, docTagRepo)

	t.Run("partial update", func(t *testing.T) {
		_, err := svc.UpdateDocument(ctxWithUser("bob"), &knowledge.UpdateKnowledgeDocumentRequest{
			Id:      1,
			Name:    "updated",
			LinkUrl: "https://new.com",
			TagIds:  []int64{30},
		})
		require.NoError(t, err)
		doc := docRepo.docs[1]
		assert.Equal(t, "updated", doc.Name)
		assert.Equal(t, "https://new.com", doc.LinkURL)
		assert.Equal(t, []int64{30}, docTagRepo.tagsByDoc[1])
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.UpdateDocument(ctxWithUser("bob"), &knowledge.UpdateKnowledgeDocumentRequest{Id: 999, Name: "x"})
		require.Error(t, err)
	})
}
