package dal

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

const tableNameModelRegistry = "t_model_registry"

// ModelRegistry is the GORM model for the t_model_registry table.
type ModelRegistry struct {
	ID                   int64  `gorm:"column:id;primaryKey;autoIncrement:true"`
	ModelKey             string `gorm:"column:model_key;not null;uniqueIndex:uk_model_key"`
	DisplayName          string `gorm:"column:display_name;not null"`
	ModelType            int32  `gorm:"column:model_type;not null"`
	ProviderTemplateType int32  `gorm:"column:provider_template_type;not null"`
	AgentID              string `gorm:"column:agent_id;not null;default:''"`
	Status               int32  `gorm:"column:status;not null;default:1"`
	IsBuiltin            int32  `gorm:"column:is_builtin;not null;default:0"`
	Description          string `gorm:"column:description"`
	IconURI              string `gorm:"column:icon_uri;not null;default:''"`
	IoProfile            string `gorm:"column:io_profile;type:json"`
	Config               string `gorm:"column:config;type:json"`
	CreatorUsername      string `gorm:"column:creator_username;not null;default:''"`
	UpdaterUsername      string `gorm:"column:updater_username;not null;default:''"`
	CreatedAt            int64  `gorm:"column:created_at;not null;autoCreateTime:milli"`
	UpdatedAt            int64  `gorm:"column:updated_at;not null;autoUpdateTime:milli"`
}

// TableName returns the table name for the GORM model.
func (*ModelRegistry) TableName() string { return tableNameModelRegistry }

// ModelRegistryFilter represents query filters for listing model registry entries.
type ModelRegistryFilter struct {
	AgentID              string
	Status               int32
	ProviderTemplateType int32
	ModelType            int32
	Keyword              string
	IsBuiltin            int32 // -1=all, 0=custom, 1=builtin
	Offset               int
	Limit                int
}

// ModelRegistryDAO handles persistence for the t_model_registry table.
type ModelRegistryDAO struct {
	db *gorm.DB
}

// NewModelRegistryDAO creates a new DAO instance.
func NewModelRegistryDAO(db *gorm.DB) *ModelRegistryDAO { return &ModelRegistryDAO{db: db} }

// Create inserts a new model registry entry.
func (d *ModelRegistryDAO) Create(ctx context.Context, m *ModelRegistry) (int64, error) {
	if err := d.db.WithContext(ctx).Create(m).Error; err != nil {
		return 0, err
	}
	return m.ID, nil
}

// GetByID retrieves a model registry entry by primary key.
func (d *ModelRegistryDAO) GetByID(ctx context.Context, id int64) (*ModelRegistry, error) {
	var m ModelRegistry
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&m).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

// GetByModelKey retrieves a model registry entry by model_key.
func (d *ModelRegistryDAO) GetByModelKey(ctx context.Context, modelKey string) (*ModelRegistry, error) {
	var m ModelRegistry
	if err := d.db.WithContext(ctx).Where("model_key = ?", modelKey).First(&m).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

// ExistsByModelKey checks whether a model_key already exists.
func (d *ModelRegistryDAO) ExistsByModelKey(ctx context.Context, modelKey string) (bool, error) {
	var count int64
	if err := d.db.WithContext(ctx).
		Model(&ModelRegistry{}).
		Where("model_key = ?", modelKey).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// List returns paginated model registry entries matching the filter.
func (d *ModelRegistryDAO) List(ctx context.Context, filter *ModelRegistryFilter) ([]*ModelRegistry, int64, error) {
	tx := d.db.WithContext(ctx).Model(&ModelRegistry{})

	if filter.AgentID != "" {
		tx = tx.Where("agent_id = ?", filter.AgentID)
	}
	if filter.Status >= 0 {
		tx = tx.Where("status = ?", filter.Status)
	}
	if filter.ProviderTemplateType > 0 {
		tx = tx.Where("provider_template_type = ?", filter.ProviderTemplateType)
	}
	if filter.ModelType > 0 {
		tx = tx.Where("model_type = ?", filter.ModelType)
	}
	switch filter.IsBuiltin {
	case 0, 1:
		tx = tx.Where("is_builtin = ?", filter.IsBuiltin)
	}
	if filter.Keyword != "" {
		tx = tx.Where("display_name LIKE ?", "%"+filter.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []*ModelRegistry
	if err := tx.Order("id DESC").Offset(filter.Offset).Limit(filter.Limit).Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

// Delete permanently removes a model registry entry.
func (d *ModelRegistryDAO) Delete(ctx context.Context, id int64) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&ModelRegistry{}).Error
}

// IsNotFoundErr reports whether the error is a GORM "record not found" error.
func IsNotFoundErr(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }
