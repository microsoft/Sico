package dal

import (
	"context"
	"time"

	"sico-backend/internal/store/skill/internal/dal/model"
	"sico-backend/internal/store/skill/internal/dal/query"

	"gorm.io/gorm"
)

// SkillFilter represents query filters for listing skills.
type SkillFilter struct {
	ProjectID int64
	AgentID   string
	Status    int32
	Offset    int
	Limit     int
}

// SkillDAO handles skill persistence.
type SkillDAO struct {
	query *query.Query
}

func NewSkillDAO(db *gorm.DB) *SkillDAO {
	return &SkillDAO{query: query.Use(db)}
}

// Create inserts a skill record.
func (d *SkillDAO) Create(ctx context.Context, s *model.TSkill) (int64, error) {
	now := time.Now().UnixMilli()
	s.CreatedAt = now
	s.UpdatedAt = now
	if err := d.query.TSkill.WithContext(ctx).Create(s); err != nil {
		return 0, err
	}
	return s.ID, nil
}

// Update updates mutable fields for a skill record.
func (d *SkillDAO) Update(ctx context.Context, s *model.TSkill) error {
	now := time.Now().UnixMilli()
	q := d.query.TSkill
	_, err := q.WithContext(ctx).
		Where(q.ID.Eq(s.ID)).
		UpdateSimple(
			q.Name.Value(s.Name),
			q.Description.Value(s.Description),
			q.AssetID.Value(s.AssetID),
			q.Status.Value(s.Status),
			q.FailReason.Value(s.FailReason),
			q.UpdatedAt.Value(now),
		)
	return err
}

// GetByID retrieves a skill by id.
func (d *SkillDAO) GetByID(ctx context.Context, id int64) (*model.TSkill, error) {
	q := d.query.TSkill
	return q.WithContext(ctx).
		Where(q.ID.Eq(id)).
		First()
}

// List returns paged skills filtered by the provided filter.
func (d *SkillDAO) List(ctx context.Context, filter *SkillFilter) ([]*model.TSkill, int64, error) {
	q := d.query.TSkill
	do := q.WithContext(ctx)

	if filter.ProjectID > 0 {
		do = do.Where(q.ProjectID.Eq(filter.ProjectID))
	}
	if filter.AgentID != "" {
		do = do.Where(q.AgentID.Eq(filter.AgentID))
	}
	if filter.Status > 0 {
		do = do.Where(q.Status.Eq(filter.Status))
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

// Delete marks a skill as deleted via soft delete.
func (d *SkillDAO) Delete(ctx context.Context, id int64) error {
	q := d.query.TSkill
	_, err := q.WithContext(ctx).
		Where(q.ID.Eq(id)).
		Delete()
	return err
}
