package dal

import (
	"context"
	"time"

	"sico-backend/internal/store/knowledge/internal/dal/model"
	"sico-backend/internal/store/knowledge/internal/dal/query"

	"gorm.io/gorm"
)

type DocumentV2Filter struct {
	ProjectID       int64
	AgentID         string
	AssetID         int64
	LinkURL         string
	DocumentType    int32
	Status          int32
	CreatorUsername string
	Offset          int
	Limit           int
}

type DocumentV2DAO struct {
	query *query.Query
}

func NewDocumentV2DAO(db *gorm.DB) *DocumentV2DAO {
	return &DocumentV2DAO{query: query.Use(db)}
}

// Create inserts a knowledge document record.
func (d *DocumentV2DAO) Create(ctx context.Context, doc *model.TKnowledgeDocument) (int64, error) {
	now := time.Now().UnixMilli()
	doc.CreatedAt = now
	doc.UpdatedAt = now
	if err := d.query.TKnowledgeDocument.WithContext(ctx).Create(doc); err != nil {
		return 0, err
	}
	return doc.ID, nil
}

// Update updates mutable fields for a document record.
func (d *DocumentV2DAO) Update(ctx context.Context, doc *model.TKnowledgeDocument) error {
	now := time.Now().UnixMilli()
	q := d.query.TKnowledgeDocument
	_, err := q.WithContext(ctx).
		Where(q.ID.Eq(doc.ID)).
		UpdateSimple(
			q.AgentID.Value(doc.AgentID),
			q.Name.Value(doc.Name),
			q.AssetID.Value(doc.AssetID),
			q.IconURI.Value(doc.IconURI),
			q.LinkURL.Value(doc.LinkURL),
			q.DocumentType.Value(doc.DocumentType),
			q.Status.Value(doc.Status),
			q.FailReason.Value(doc.FailReason),
			q.UpdatedAt.Value(now),
		)
	return err
}

// GetByID retrieves a document by id.
func (d *DocumentV2DAO) GetByID(ctx context.Context, id int64) (*model.TKnowledgeDocument, error) {
	q := d.query.TKnowledgeDocument
	return q.WithContext(ctx).
		Where(q.ID.Eq(id)).
		First()
}

// List returns paged documents filtered by the provided filter.
func (d *DocumentV2DAO) List(ctx context.Context, filter *DocumentV2Filter) ([]*model.TKnowledgeDocument, int64, error) {
	q := d.query.TKnowledgeDocument
	do := q.WithContext(ctx)

	if filter.ProjectID > 0 {
		do = do.Where(q.ProjectID.Eq(filter.ProjectID))
	}
	if filter.AgentID != "" {
		do = do.Where(q.AgentID.Eq(filter.AgentID))
	}
	if filter.AssetID > 0 {
		do = do.Where(q.AssetID.Eq(filter.AssetID))
	}
	if filter.LinkURL != "" {
		do = do.Where(q.LinkURL.Eq(filter.LinkURL))
	}
	if filter.DocumentType > 0 {
		do = do.Where(q.DocumentType.Eq(filter.DocumentType))
	}
	if filter.Status > 0 {
		do = do.Where(q.Status.Eq(filter.Status))
	}
	if filter.CreatorUsername != "" {
		do = do.Where(q.CreatorUsername.Eq(filter.CreatorUsername))
	}

	total, err := do.Count()
	if err != nil {
		return nil, 0, err
	}

	do = do.Offset(filter.Offset).Order(q.ID.Desc())
	if filter.Limit > 0 {
		do = do.Limit(filter.Limit)
	}

	list, err := do.Find()
	if err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

// Delete marks a document v2 as deleted via soft delete.
func (d *DocumentV2DAO) Delete(ctx context.Context, id int64) error {
	q := d.query.TKnowledgeDocument
	_, err := q.WithContext(ctx).
		Where(q.ID.Eq(id)).
		Delete()
	return err
}

// KnowledgeTagDAO handles tag persistence.
type KnowledgeTagDAO struct {
	query *query.Query
}

func NewKnowledgeTagDAO(db *gorm.DB) *KnowledgeTagDAO {
	return &KnowledgeTagDAO{query: query.Use(db)}
}

func (d *KnowledgeTagDAO) Create(ctx context.Context, tag *model.TKnowledgeTag) (int64, error) {
	now := time.Now().UnixMilli()
	tag.CreatedAt = now
	tag.UpdatedAt = now
	if err := d.query.TKnowledgeTag.WithContext(ctx).Create(tag); err != nil {
		return 0, err
	}
	return tag.ID, nil
}

func (d *KnowledgeTagDAO) Update(ctx context.Context, tag *model.TKnowledgeTag) error {
	now := time.Now().UnixMilli()
	q := d.query.TKnowledgeTag
	_, err := q.WithContext(ctx).
		Where(q.ID.Eq(tag.ID)).
		UpdateSimple(q.Name.Value(tag.Name), q.Description.Value(tag.Description), q.UpdatedAt.Value(now))
	return err
}

func (d *KnowledgeTagDAO) GetByID(ctx context.Context, id int64) (*model.TKnowledgeTag, error) {
	q := d.query.TKnowledgeTag
	return q.WithContext(ctx).
		Where(q.ID.Eq(id)).
		First()
}

func (d *KnowledgeTagDAO) List(ctx context.Context, projectID int64, offset, limit int) ([]*model.TKnowledgeTag, int64, error) {
	q := d.query.TKnowledgeTag
	do := q.WithContext(ctx)
	if projectID > 0 {
		do = do.Where(q.ProjectID.Eq(projectID))
	}

	total, err := do.Count()
	if err != nil {
		return nil, 0, err
	}

	list, err := do.Offset(offset).Limit(limit).Order(q.ID.Desc()).Find()
	if err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (d *KnowledgeTagDAO) Delete(ctx context.Context, id int64) error {
	q := d.query.TKnowledgeTag
	_, err := q.WithContext(ctx).
		Where(q.ID.Eq(id)).
		Delete()
	return err
}

// DocumentTagDAO handles mappings between documents and tags.
type DocumentTagDAO struct {
	query *query.Query
}

func NewDocumentTagDAO(db *gorm.DB) *DocumentTagDAO {
	return &DocumentTagDAO{query: query.Use(db)}
}

func (d *DocumentTagDAO) DeleteDocumentTags(ctx context.Context, docID int64) error {
	tq := d.query.TKnowledgeDocumentTag
	_, err := tq.WithContext(ctx).Where(tq.KnowledgeDocumentID.Eq(docID)).Unscoped().Delete()
	return err
}

func (d *DocumentTagDAO) CreateDocumentTags(ctx context.Context, docID int64, tagIDs []int64) error {
	if len(tagIDs) == 0 {
		return nil
	}

	now := time.Now().UnixMilli()
	batch := make([]*model.TKnowledgeDocumentTag, 0, len(tagIDs))
	for _, tagID := range tagIDs {
		batch = append(batch, &model.TKnowledgeDocumentTag{
			KnowledgeDocumentID: docID,
			KnowledgeTagID:      tagID,
			CreatedAt:           now,
			UpdatedAt:           now,
		})
	}

	tq := d.query.TKnowledgeDocumentTag
	return tq.WithContext(ctx).Create(batch...)
}

func (d *DocumentTagDAO) GetTagsByDocumentID(ctx context.Context, docID int64) ([]*model.TKnowledgeTag, error) {
	dt := d.query.TKnowledgeDocumentTag
	t := d.query.TKnowledgeTag

	var tags []*model.TKnowledgeTag
	err := dt.WithContext(ctx).
		Select(t.ALL).
		Join(t, dt.KnowledgeTagID.EqCol(t.ID)).
		Where(dt.KnowledgeDocumentID.Eq(docID)).
		Order(t.ID.Desc()).
		Scan(&tags)
	if err != nil {
		return nil, err
	}
	return tags, nil
}
