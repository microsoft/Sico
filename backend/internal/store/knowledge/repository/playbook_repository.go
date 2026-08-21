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
	return WithTracingPlaybookRepository(dal.NewPlaybookDAO(db))
}

func NewPlaybookTagRepo(db *gorm.DB) PlaybookTagRepository {
	return WithTracingPlaybookTagRepository(dal.NewPlaybookTagDAO(db))
}
