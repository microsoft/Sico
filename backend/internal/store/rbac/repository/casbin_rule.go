package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/rbac/internal/dal"
	"sico-backend/internal/store/rbac/internal/dal/model"
)

type PolicyModel = model.TCasbinRule

type CasbinRuleRepository interface {
	Create(ctx context.Context, rule *PolicyModel) error
	Update(ctx context.Context, rule *PolicyModel) error
	Delete(ctx context.Context, id int64) error
	Get(ctx context.Context, id int64) (*PolicyModel, error)
	GetByRule(ctx context.Context, ptype string, rule []string) (*PolicyModel, error)
	Query(ctx context.Context, ptype, v0, v1, v2 string, page, pageSize int32) ([]*PolicyModel, int64, error)
}

func NewCasbinRuleRepository(db *gorm.DB) CasbinRuleRepository {
	return WithTracingCasbinRuleRepository(dal.NewCasbinRuleDAO(db))
}
