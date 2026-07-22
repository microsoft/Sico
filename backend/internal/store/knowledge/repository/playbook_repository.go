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

package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/knowledge/internal/dal"
	knowledgeModel "sico-backend/internal/store/knowledge/internal/dal/model"
)

// Use generated GORM models.
type KnowledgePlaybookModel = knowledgeModel.TKnowledgePlaybook
type KnowledgePlaybookTagModel = knowledgeModel.TKnowledgePlaybookTag

// PlaybookFilter represents query filters for listing playbooks.
type PlaybookFilter = dal.PlaybookFilter

// PlaybookRepository defines data access for knowledge playbooks.
type PlaybookRepository interface {
	GetByID(ctx context.Context, id int64) (*KnowledgePlaybookModel, error)
	GetByProjectAndAgent(ctx context.Context, projectID, agentInstanceID int64) (*KnowledgePlaybookModel, error)
	List(ctx context.Context, filter *PlaybookFilter) ([]*KnowledgePlaybookModel, int64, error)
	Create(ctx context.Context, pb *KnowledgePlaybookModel) (int64, error)
	Update(ctx context.Context, pb *KnowledgePlaybookModel) error
	Delete(ctx context.Context, id int64) error
}

// PlaybookTagRepository defines mapping operations between playbooks and tags.
type PlaybookTagRepository interface {
	CreatePlaybookTags(ctx context.Context, playbookID int64, tagIDs []int64) error
	DeletePlaybookTags(ctx context.Context, playbookID int64) error
	GetTagsByPlaybookID(ctx context.Context, playbookID int64) ([]*KnowledgeTagModel, error)
}

func NewPlaybookRepo(db *gorm.DB) PlaybookRepository {
	return dal.NewPlaybookDAO(db)
}

func NewPlaybookTagRepo(db *gorm.DB) PlaybookTagRepository {
	return dal.NewPlaybookTagDAO(db)
}
