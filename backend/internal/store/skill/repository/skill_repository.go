package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/skill/internal/dal"
	skillModel "sico-backend/internal/store/skill/internal/dal/model"
)

// SkillModel is an alias for the generated GORM model.
type SkillModel = skillModel.TSkill

// SkillVersionModel is the immutable skill version table model.
type SkillVersionModel = skillModel.TSkillVersion

// SkillFilter represents query filters for listing skills.
type SkillFilter = dal.SkillFilter

// SkillRepository defines data access for skills.
type SkillRepository interface {
	Create(ctx context.Context, s *SkillModel) (int64, error)
	Update(ctx context.Context, s *SkillModel) error
	GetByID(ctx context.Context, id int64) (*SkillModel, error)
	List(ctx context.Context, filter *SkillFilter) ([]*SkillModel, int64, error)
	Delete(ctx context.Context, id int64) error
	CreateVersion(ctx context.Context, version *SkillVersionModel) (int64, error)
	GetLatestVersion(ctx context.Context, skillID int64) (*SkillVersionModel, error)
	GetVersion(ctx context.Context, skillID int64, version string) (*SkillVersionModel, error)
	ListLatestVersionsBySkillIDs(ctx context.Context, skillIDs []int64) (map[int64]*SkillVersionModel, error)
	ListLatestVersions(ctx context.Context, skillID int64, limit int) ([]*SkillVersionModel, error)
	DeleteVersions(ctx context.Context, skillID int64) error
}

func NewSkillRepo(db *gorm.DB) SkillRepository {
	return WithTracingSkillRepository(dal.NewSkillDAO(db))
}
