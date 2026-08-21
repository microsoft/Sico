package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/organization/internal/dal"
	"sico-backend/internal/store/organization/internal/dal/model"
)

// OrganizationLLMConfigModel is the persisted organization LLM config entity.
type OrganizationLLMConfigModel = model.TOrganizationLlmhubsConfig

// OrganizationLLMConfigRepository exposes organization LLM config persistence.
type OrganizationLLMConfigRepository interface {
	Get(ctx context.Context, organizationID int64) (*OrganizationLLMConfigModel, error)
	Upsert(ctx context.Context, cfg *OrganizationLLMConfigModel) error
	Delete(ctx context.Context, organizationID int64) error
}

func NewOrganizationLLMConfigRepository(db *gorm.DB) OrganizationLLMConfigRepository {
	return WithTracingOrganizationLLMConfigRepository(dal.NewOrganizationLLMConfigDAO(db))
}
