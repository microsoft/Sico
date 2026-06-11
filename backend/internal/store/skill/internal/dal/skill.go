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
	db    *gorm.DB
}

func NewSkillDAO(db *gorm.DB) *SkillDAO {
	return &SkillDAO{query: query.Use(db), db: db}
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
	do := d.db.WithContext(ctx).Model(&model.TSkill{})

	if filter.ProjectID > 0 {
		do = do.Where("project_id = ?", filter.ProjectID)
	}
	if filter.AgentID != "" {
		do = do.Where("agent_id = ?", filter.AgentID)
	}
	if filter.Status > 0 {
		latestVersion := d.db.
			Model(&model.TSkillVersion{}).
			Select("skill_id, MAX(id) AS id").
			Group("skill_id")
		do = do.
			Joins("JOIN (?) AS latest_version ON latest_version.skill_id = t_skill.id", latestVersion).
			Joins("JOIN t_skill_version AS v ON v.id = latest_version.id").
			Where("v.status = ?", filter.Status)
	}

	var total int64
	if err := do.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []*model.TSkill
	if err := do.Offset(filter.Offset).Limit(filter.Limit).Order("t_skill.id DESC").Find(&list).Error; err != nil {
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

func (d *SkillDAO) CreateVersion(ctx context.Context, version *model.TSkillVersion) (int64, error) {
	now := time.Now().UnixMilli()
	version.CreatedAt = now
	version.UpdatedAt = now
	if err := d.query.TSkillVersion.WithContext(ctx).Create(version); err != nil {
		return 0, err
	}
	return version.ID, nil
}

func (d *SkillDAO) GetLatestVersion(ctx context.Context, skillID int64) (*model.TSkillVersion, error) {
	q := d.query.TSkillVersion
	return q.WithContext(ctx).
		Where(q.SkillID.Eq(skillID)).
		Order(q.CreatedAt.Desc(), q.ID.Desc()).
		First()
}

func (d *SkillDAO) GetVersion(ctx context.Context, skillID int64, version string) (*model.TSkillVersion, error) {
	q := d.query.TSkillVersion
	return q.WithContext(ctx).
		Where(q.SkillID.Eq(skillID), q.Version.Eq(version)).
		First()
}

func (d *SkillDAO) ListLatestVersionsBySkillIDs(ctx context.Context, skillIDs []int64) (map[int64]*model.TSkillVersion, error) {
	result := make(map[int64]*model.TSkillVersion, len(skillIDs))
	if len(skillIDs) == 0 {
		return result, nil
	}

	q := d.query.TSkillVersion
	versions, err := q.WithContext(ctx).
		Where(q.SkillID.In(skillIDs...)).
		Order(q.SkillID, q.CreatedAt.Desc(), q.ID.Desc()).
		Find()
	if err != nil {
		return nil, err
	}
	for _, version := range versions {
		if _, ok := result[version.SkillID]; ok {
			continue
		}
		result[version.SkillID] = version
	}
	return result, nil
}

func (d *SkillDAO) ListLatestVersions(ctx context.Context, skillID int64, limit int) ([]*model.TSkillVersion, error) {
	q := d.query.TSkillVersion
	do := q.WithContext(ctx).
		Where(q.SkillID.Eq(skillID)).
		Order(q.CreatedAt.Desc(), q.ID.Desc())
	if limit > 0 {
		do = do.Limit(limit)
	}
	return do.
		Find()
}

func (d *SkillDAO) DeleteVersions(ctx context.Context, skillID int64) error {
	q := d.query.TSkillVersion
	_, err := q.WithContext(ctx).
		Where(q.SkillID.Eq(skillID)).
		Delete()
	return err
}
