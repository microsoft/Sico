package dal

import (
	"context"
	"time"

	"sico-backend/internal/store/knowledge/internal/dal/model"
	"sico-backend/internal/store/knowledge/internal/dal/query"

	"gorm.io/gorm"
)

// PlaybookFilter represents query filters for listing playbooks.
type PlaybookFilter struct {
	ProjectID       int64
	AgentInstanceID int64
	Offset          int
	Limit           int
}

// PlaybookDAO handles knowledge playbook persistence.
type PlaybookDAO struct {
	query *query.Query
}

func NewPlaybookDAO(db *gorm.DB) *PlaybookDAO {
	return &PlaybookDAO{query: query.Use(db)}
}

// GetByID retrieves a playbook by id.
func (d *PlaybookDAO) GetByID(ctx context.Context, id int64) (*model.TKnowledgePlaybook, error) {
	q := d.query.TKnowledgePlaybook
	return q.WithContext(ctx).
		Where(q.ID.Eq(id)).
		First()
}

// GetByProjectAndAgent retrieves a playbook by project_id and agent_instance_id.
func (d *PlaybookDAO) GetByProjectAndAgent(
	ctx context.Context, projectID, agentInstanceID int64,
) (*model.TKnowledgePlaybook, error) {
	q := d.query.TKnowledgePlaybook
	return q.WithContext(ctx).
		Where(q.ProjectID.Eq(projectID)).
		Where(q.AgentInstanceID.Eq(agentInstanceID)).
		First()
}

// Create inserts a new playbook record and returns its ID.
func (d *PlaybookDAO) Create(ctx context.Context, pb *model.TKnowledgePlaybook) (int64, error) {
	q := d.query.TKnowledgePlaybook
	if err := q.WithContext(ctx).Create(pb); err != nil {
		return 0, err
	}
	return pb.ID, nil
}

// List returns paged playbooks filtered by the provided filter.
func (d *PlaybookDAO) List(ctx context.Context, filter *PlaybookFilter) ([]*model.TKnowledgePlaybook, int64, error) {
	q := d.query.TKnowledgePlaybook
	do := q.WithContext(ctx)

	if filter.ProjectID > 0 {
		do = do.Where(q.ProjectID.Eq(filter.ProjectID))
	}
	if filter.AgentInstanceID > 0 {
		do = do.Where(q.AgentInstanceID.Eq(filter.AgentInstanceID))
	}

	total, err := do.Count()
	if err != nil {
		return nil, 0, err
	}

	list, err := do.Offset(filter.Offset).Limit(filter.Limit).Order(q.ID.Desc()).Find()
	if err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

// Update updates the mutable fields (name) for a playbook.
func (d *PlaybookDAO) Update(ctx context.Context, pb *model.TKnowledgePlaybook) error {
	now := time.Now().UnixMilli()
	q := d.query.TKnowledgePlaybook
	_, err := q.WithContext(ctx).
		Where(q.ID.Eq(pb.ID)).
		UpdateSimple(
			q.Name.Value(pb.Name),
			q.UpdatedAt.Value(now),
		)
	return err
}

// PlaybookTagDAO handles mappings between playbooks and tags.
type PlaybookTagDAO struct {
	query *query.Query
}

func NewPlaybookTagDAO(db *gorm.DB) *PlaybookTagDAO {
	return &PlaybookTagDAO{query: query.Use(db)}
}

func (d *PlaybookTagDAO) DeletePlaybookTags(ctx context.Context, playbookID int64) error {
	tq := d.query.TKnowledgePlaybookTag
	_, err := tq.WithContext(ctx).Where(tq.KnowledgePlaybookID.Eq(playbookID)).Unscoped().Delete()
	return err
}

func (d *PlaybookTagDAO) CreatePlaybookTags(ctx context.Context, playbookID int64, tagIDs []int64) error {
	if len(tagIDs) == 0 {
		return nil
	}

	now := time.Now().UnixMilli()
	batch := make([]*model.TKnowledgePlaybookTag, 0, len(tagIDs))
	for _, tagID := range tagIDs {
		batch = append(batch, &model.TKnowledgePlaybookTag{
			KnowledgePlaybookID: playbookID,
			KnowledgeTagID:      tagID,
			CreatedAt:           now,
			UpdatedAt:           now,
		})
	}

	tq := d.query.TKnowledgePlaybookTag
	return tq.WithContext(ctx).Create(batch...)
}

func (d *PlaybookTagDAO) GetTagsByPlaybookID(ctx context.Context, playbookID int64) ([]*model.TKnowledgeTag, error) {
	pt := d.query.TKnowledgePlaybookTag
	t := d.query.TKnowledgeTag

	var tags []*model.TKnowledgeTag
	err := pt.WithContext(ctx).
		Select(t.ALL).
		Join(t, pt.KnowledgeTagID.EqCol(t.ID)).
		Where(pt.KnowledgePlaybookID.Eq(playbookID)).
		Order(t.ID.Desc()).
		Scan(&tags)
	if err != nil {
		return nil, err
	}
	return tags, nil
}
