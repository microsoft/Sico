package dal

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sico-backend/internal/store/organization/internal/dal/model"
)

// OrganizationLLMConfigDAO handles persistence for t_organization_llmhubs_config.
type OrganizationLLMConfigDAO struct {
	db *gorm.DB
}

func NewOrganizationLLMConfigDAO(db *gorm.DB) *OrganizationLLMConfigDAO {
	return &OrganizationLLMConfigDAO{db: db}
}

// Get returns the LLM config for an organization, or nil when none is set.
func (d *OrganizationLLMConfigDAO) Get(
	ctx context.Context, organizationID int64,
) (*model.TOrganizationLlmhubsConfig, error) {
	var cfg model.TOrganizationLlmhubsConfig
	err := d.db.WithContext(ctx).
		Where("organization_id = ?", organizationID).
		First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Upsert creates or updates the LLM config for an organization (keyed by organization_id).
func (d *OrganizationLLMConfigDAO) Upsert(ctx context.Context, cfg *model.TOrganizationLlmhubsConfig) error {
	return d.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "organization_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"default_model_key", "updated_at"}),
		}).
		Create(cfg).Error
}

// Delete clears the LLM config for an organization.
func (d *OrganizationLLMConfigDAO) Delete(ctx context.Context, organizationID int64) error {
	return d.db.WithContext(ctx).
		Where("organization_id = ?", organizationID).
		Delete(&model.TOrganizationLlmhubsConfig{}).Error
}
