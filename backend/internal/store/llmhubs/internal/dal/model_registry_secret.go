package dal

import (
	"context"
	"time"

	"gorm.io/gorm"
)

const tableNameModelRegistrySecret = "t_model_registry_secret"

// ModelRegistrySecret is the GORM model for the t_model_registry_secret table.
type ModelRegistrySecret struct {
	ID              int64  `gorm:"column:id;primaryKey;autoIncrement:true"`
	ModelRegistryID int64  `gorm:"column:model_registry_id;not null;index:idx_model_registry_id"`
	SecretKey       string `gorm:"column:secret_key;not null"`
	SecretValue     string `gorm:"column:secret_value"`
	CreatedAt       int64  `gorm:"column:created_at;not null;autoCreateTime:milli"`
	UpdatedAt       int64  `gorm:"column:updated_at;not null;autoUpdateTime:milli"`
}

// TableName returns the table name for the GORM model.
func (*ModelRegistrySecret) TableName() string { return tableNameModelRegistrySecret }

// ModelRegistrySecretDAO handles persistence for t_model_registry_secret.
type ModelRegistrySecretDAO struct {
	db *gorm.DB
}

// NewModelRegistrySecretDAO creates a new DAO instance.
func NewModelRegistrySecretDAO(db *gorm.DB) *ModelRegistrySecretDAO {
	return &ModelRegistrySecretDAO{db: db}
}

// UpsertSecrets replaces all secrets for a model registry entry, within a transaction.
func (d *ModelRegistrySecretDAO) UpsertSecrets(ctx context.Context, registryID int64, secrets []*ModelRegistrySecret) error {
	return d.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("model_registry_id = ?", registryID).Delete(&ModelRegistrySecret{}).Error; err != nil {
			return err
		}
		if len(secrets) == 0 {
			return nil
		}
		now := time.Now().UnixMilli()
		for _, s := range secrets {
			s.ModelRegistryID = registryID
			s.CreatedAt = now
			s.UpdatedAt = now
		}
		return tx.Create(&secrets).Error
	})
}

// GetSecrets retrieves all secrets for a model registry entry.
func (d *ModelRegistrySecretDAO) GetSecrets(ctx context.Context, registryID int64) ([]*ModelRegistrySecret, error) {
	var secrets []*ModelRegistrySecret
	if err := d.db.WithContext(ctx).Where("model_registry_id = ?", registryID).Find(&secrets).Error; err != nil {
		return nil, err
	}
	return secrets, nil
}

// DeleteSecrets removes all secrets for a model registry entry.
func (d *ModelRegistrySecretDAO) DeleteSecrets(ctx context.Context, registryID int64) error {
	return d.db.WithContext(ctx).Where("model_registry_id = ?", registryID).Delete(&ModelRegistrySecret{}).Error
}
