package dal

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const tableNameSingleAgentLLMHubConfig = "t_single_agent_llmhubs_config"

type SingleAgentLLMHubConfig struct {
	ID                    int64    `gorm:"column:id;primaryKey;autoIncrement:true"`
	AgentID               string   `gorm:"column:agent_id;not null"`
	ModelKeys             []string `gorm:"column:model_keys;serializer:json"`
	DefaultGlobalModelKey string   `gorm:"column:default_global_model_key;not null"`
	CreatedAt             int64    `gorm:"column:created_at;not null;autoCreateTime:milli"`
	UpdatedAt             int64    `gorm:"column:updated_at;not null;autoUpdateTime:milli"`
}

func (*SingleAgentLLMHubConfig) TableName() string {
	return tableNameSingleAgentLLMHubConfig
}

type SingleAgentLLMHubConfigDAO struct {
	db *gorm.DB
}

func NewSingleAgentLLMHubConfigDAO(db *gorm.DB) *SingleAgentLLMHubConfigDAO {
	return &SingleAgentLLMHubConfigDAO{db: db}
}

func (d *SingleAgentLLMHubConfigDAO) Get(ctx context.Context, agentID string) (*SingleAgentLLMHubConfig, error) {
	var config SingleAgentLLMHubConfig
	err := d.db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		First(&config).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &config, nil
}

func (d *SingleAgentLLMHubConfigDAO) Upsert(ctx context.Context, config *SingleAgentLLMHubConfig) error {
	return d.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "agent_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"model_keys", "default_global_model_key", "updated_at"}),
		}).
		Create(config).Error
}

func (d *SingleAgentLLMHubConfigDAO) Delete(ctx context.Context, agentID string) error {
	return d.db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		Delete(&SingleAgentLLMHubConfig{}).Error
}
