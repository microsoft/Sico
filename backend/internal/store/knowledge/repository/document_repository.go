package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/knowledge/internal/dal"
	knowledgeModel "sico-backend/internal/store/knowledge/internal/dal/model"
)

// Use generated GORM models instead of local structs.
type KnowledgeDocumentV2Model = knowledgeModel.TKnowledgeDocument
type KnowledgeTagModel = knowledgeModel.TKnowledgeTag
type KnowledgeDocumentTagModel = knowledgeModel.TKnowledgeDocumentTag

// DocumentRepository defines data access for knowledge documents.
type DocumentRepository interface {
	Create(ctx context.Context, doc *KnowledgeDocumentV2Model) (int64, error)
	Update(ctx context.Context, doc *KnowledgeDocumentV2Model) error
	GetByID(ctx context.Context, id int64) (*KnowledgeDocumentV2Model, error)
	List(ctx context.Context, filter *DocumentV2Filter) ([]*KnowledgeDocumentV2Model, int64, error)
	Delete(ctx context.Context, id int64) error
}

// KnowledgeTagRepository defines data access for knowledge tags.
type KnowledgeTagRepository interface {
	Create(ctx context.Context, tag *KnowledgeTagModel) (int64, error)
	Update(ctx context.Context, tag *KnowledgeTagModel) error
	GetByID(ctx context.Context, id int64) (*KnowledgeTagModel, error)
	List(ctx context.Context, projectID int64, offset, limit int) ([]*KnowledgeTagModel, int64, error)
	Delete(ctx context.Context, id int64) error
}

// DocumentTagRepository defines mapping operations between document and tags.
type DocumentTagRepository interface {
	CreateDocumentTags(ctx context.Context, docID int64, tagIDs []int64) error
	DeleteDocumentTags(ctx context.Context, docID int64) error
	GetTagsByDocumentID(ctx context.Context, docID int64) ([]*KnowledgeTagModel, error)
}

// DocumentV2Filter represents query filters for listing documents.
type DocumentV2Filter = dal.DocumentV2Filter

func NewDocumentRepo(db *gorm.DB) DocumentRepository {
	return WithTracingDocumentRepository(dal.NewDocumentV2DAO(db))
}

func NewKnowledgeTagRepo(db *gorm.DB) KnowledgeTagRepository {
	return WithTracingKnowledgeTagRepository(dal.NewKnowledgeTagDAO(db))
}

func NewDocumentTagRepo(db *gorm.DB) DocumentTagRepository {
	return WithTracingDocumentTagRepository(dal.NewDocumentTagDAO(db))
}
