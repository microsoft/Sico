package dal

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sico-backend/internal/store/integration/internal/dal/model"
)

var ErrCredentialVersionConflict = errors.New("integration credential version conflict")
var ErrConnectionNotActive = errors.New("integration connection is not active")
var ErrConnectionStateConflict = errors.New("integration connection state conflict")

const credentialVersionsRetained int64 = 3

type ConnectionFilter struct {
	OrganizationID       int64
	VisibleOwnerUsername string
	ProjectID            int64
	Search               string
	Provider             *string
	Mode                 *int32
	Status               *int32
}

type BindingFilter struct {
	Status    *int32
	ScopeType *int32
	ScopeID   *string
}

type IntegrationDAO struct {
	db *gorm.DB
}

func NewIntegrationDAO(db *gorm.DB) *IntegrationDAO {
	return &IntegrationDAO{db: db}
}

func (dao *IntegrationDAO) CreateConnection(ctx context.Context, connection *model.TIntegrationConnection) error {
	return dao.db.WithContext(ctx).Create(connection).Error
}

func (dao *IntegrationDAO) GetConnectionByKey(
	ctx context.Context, connectionKey string,
) (*model.TIntegrationConnection, error) {
	var connection model.TIntegrationConnection
	err := dao.db.WithContext(ctx).Where("connection_key = ?", connectionKey).Take(&connection).Error
	return &connection, err
}

func (dao *IntegrationDAO) ListConnections(
	ctx context.Context,
	filter *ConnectionFilter,
	offset, limit int,
) ([]*model.TIntegrationConnection, int64, error) {
	query := dao.db.WithContext(ctx).Model(&model.TIntegrationConnection{})
	if filter != nil {
		query = applyConnectionFilter(query, filter)
	}

	var total int64
	countQuery := query.Session(&gorm.Session{})
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var connections []*model.TIntegrationConnection
	query = query.Order("t_integration_connection.id DESC").Offset(offset)
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&connections).Error; err != nil {
		return nil, 0, err
	}
	return connections, total, nil
}

func applyConnectionFilter(query *gorm.DB, filter *ConnectionFilter) *gorm.DB {
	query = query.Where("t_integration_connection.organization_id = ?", filter.OrganizationID)
	if filter.ProjectID > 0 {
		query = query.Where("t_integration_connection.project_id = ?", filter.ProjectID)
	} else {
		query = query.Where("t_integration_connection.project_id = 0").Where(
			"t_integration_connection.owner_username = ?",
			filter.VisibleOwnerUsername,
		)
	}
	if filter.Search != "" {
		pattern := "%" + filter.Search + "%"
		query = query.Where(
			"t_integration_connection.display_name LIKE ? OR t_integration_connection.owner_username LIKE ?",
			pattern,
			pattern,
		)
	}
	if filter.Provider != nil {
		query = query.Where("t_integration_connection.provider = ?", *filter.Provider)
	}
	if filter.Mode != nil {
		query = query.Where("t_integration_connection.mode = ?", *filter.Mode)
	}
	if filter.Status != nil {
		query = query.Where("t_integration_connection.status = ?", *filter.Status)
	}
	return query
}

func (dao *IntegrationDAO) UpdateConnectionFields(
	ctx context.Context, connectionID int64, fields map[string]any,
) error {
	return dao.db.WithContext(ctx).
		Model(&model.TIntegrationConnection{}).
		Where("id = ?", connectionID).
		Updates(fields).Error
}

func connectionStateQuery(query *gorm.DB, expected *model.TIntegrationConnection) *gorm.DB {
	return query.Model(&model.TIntegrationConnection{}).
		Where("id = ? AND status = ?", expected.ID, expected.Status).
		Where("metadata <=> ?", expected.Metadata)
}

func (dao *IntegrationDAO) UpdateConnectionState(
	ctx context.Context, expected *model.TIntegrationConnection, fields map[string]any,
) error {
	result := connectionStateQuery(dao.db.WithContext(ctx), expected).Updates(fields)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		var matched int64
		if err := connectionStateQuery(dao.db.WithContext(ctx), expected).Count(&matched).Error; err != nil {
			return err
		}
		if matched != 1 {
			return ErrConnectionStateConflict
		}
	}
	return nil
}

func (dao *IntegrationDAO) MarkConnectionReauthorizationRequired(
	ctx context.Context,
	connectionID int64,
	expectedStatus int32,
	expectedCredentialVersion int64,
	updaterUsername string,
) error {
	result := dao.db.WithContext(ctx).
		Model(&model.TIntegrationConnection{}).
		Where(
			"id = ? AND status = ? AND credential_version = ?",
			connectionID,
			expectedStatus,
			expectedCredentialVersion,
		).
		Updates(map[string]any{
			"status":           5,
			"updater_username": updaterUsername,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrConnectionStateConflict
	}
	return nil
}

func (dao *IntegrationDAO) DeleteConnection(
	ctx context.Context, expected *model.TIntegrationConnection, updaterUsername string,
) error {
	return dao.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		connectionID := expected.ID
		result := connectionStateQuery(tx, expected).
			Updates(map[string]any{
				"status":           7,
				"updater_username": updaterUsername,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrConnectionStateConflict
		}

		if err := tx.Where("connection_id = ?", connectionID).Delete(&model.TIntegrationBinding{}).Error; err != nil {
			return err
		}
		if err := tx.Where("connection_id = ?", connectionID).Delete(&model.TIntegrationCredential{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", connectionID).Delete(&model.TIntegrationConnection{}).Error
	})
}

func (dao *IntegrationDAO) CreateOrReactivateBinding(
	ctx context.Context,
	expected *model.TIntegrationConnection,
	binding *model.TIntegrationBinding,
) error {
	if expected.ID != binding.ConnectionID {
		return ErrConnectionStateConflict
	}
	return dao.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockActiveConnection(tx, expected); err != nil {
			return err
		}

		return upsertBindingTx(tx, binding)
	})
}

func (dao *IntegrationDAO) GetBinding(
	ctx context.Context, connectionID, bindingID int64,
) (*model.TIntegrationBinding, error) {
	var binding model.TIntegrationBinding
	err := dao.db.WithContext(ctx).
		Where("connection_id = ? AND id = ?", connectionID, bindingID).
		Take(&binding).Error
	return &binding, err
}

func (dao *IntegrationDAO) ListBindings(
	ctx context.Context,
	connectionID int64,
	filter *BindingFilter,
	offset, limit int,
) ([]*model.TIntegrationBinding, int64, error) {
	query := dao.db.WithContext(ctx).
		Model(&model.TIntegrationBinding{}).
		Where("connection_id = ?", connectionID)
	if filter != nil {
		if filter.Status != nil {
			query = query.Where("status = ?", *filter.Status)
		}
		if filter.ScopeType != nil {
			query = query.Where("sico_scope_type = ?", *filter.ScopeType)
		}
		if filter.ScopeID != nil {
			query = query.Where("sico_scope_id = ?", *filter.ScopeID)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var bindings []*model.TIntegrationBinding
	query = query.Order("id DESC").Offset(offset)
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&bindings).Error; err != nil {
		return nil, 0, err
	}
	return bindings, total, nil
}

func (dao *IntegrationDAO) UpdateBindingStatus(
	ctx context.Context,
	expected *model.TIntegrationConnection,
	bindingID int64,
	status int32,
) error {
	return dao.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		connectionID := expected.ID
		if status == 1 {
			if err := lockActiveConnection(tx, expected); err != nil {
				return err
			}
		}
		var binding model.TIntegrationBinding
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("connection_id = ? AND id = ?", connectionID, bindingID).
			Take(&binding).Error; err != nil {
			return err
		}
		if binding.Status == status {
			return nil
		}
		return tx.Model(&model.TIntegrationBinding{}).
			Where("id = ?", bindingID).
			Update("status", status).Error
	})
}

func (dao *IntegrationDAO) DeleteBinding(ctx context.Context, connectionID, bindingID int64) error {
	result := dao.db.WithContext(ctx).
		Where("connection_id = ? AND id = ?", connectionID, bindingID).
		Delete(&model.TIntegrationBinding{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (dao *IntegrationDAO) GetCredentialVersion(
	ctx context.Context, connectionID, version int64,
) (*model.TIntegrationCredential, error) {
	var credential model.TIntegrationCredential
	err := dao.db.WithContext(ctx).
		Where("connection_id = ? AND version = ?", connectionID, version).
		Take(&credential).Error
	return &credential, err
}

func (dao *IntegrationDAO) SaveCredentialVersion(
	ctx context.Context,
	expected *model.TIntegrationConnection,
	credential *model.TIntegrationCredential,
	connectionFields map[string]any,
) error {
	return dao.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		credential.ConnectionID = expected.ID
		if err := tx.Create(credential).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				return ErrCredentialVersionConflict
			}
			return err
		}

		fields := make(map[string]any, len(connectionFields)+1)
		for name, value := range connectionFields {
			fields[name] = value
		}
		fields["credential_version"] = credential.Version
		query := tx.Model(&model.TIntegrationConnection{}).
			Where(
				"id = ? AND credential_version = ? AND status = ?",
				expected.ID,
				expected.CredentialVersion,
				expected.Status,
			)
		if _, changesMetadata := fields["metadata"]; changesMetadata {
			query = query.Where("metadata <=> ?", expected.Metadata)
		}
		result := query.Updates(fields)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCredentialVersionConflict
		}
		if credential.Version > credentialVersionsRetained {
			if err := tx.Where(
				"connection_id = ? AND version <= ?",
				expected.ID,
				credential.Version-credentialVersionsRetained,
			).Delete(&model.TIntegrationCredential{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func upsertBindingTx(tx *gorm.DB, binding *model.TIntegrationBinding) error {
	var existing model.TIntegrationBinding
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Unscoped().
		Where(
			"connection_id = ? AND sico_scope_type = ? AND sico_scope_id = ? AND "+
				"resource_type = ? AND resource_key = ?",
			binding.ConnectionID,
			binding.SicoScopeType,
			binding.SicoScopeID,
			binding.ResourceType,
			binding.ResourceKey,
		).
		Take(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return tx.Create(binding).Error
	}
	if err != nil {
		return err
	}
	if !existing.DeletedAt.Valid {
		return gorm.ErrDuplicatedKey
	}

	now := time.Now().UnixMilli()
	if err := tx.Unscoped().Model(&model.TIntegrationBinding{}).
		Where("id = ?", existing.ID).
		Updates(map[string]any{
			"resource_name": binding.ResourceName,
			"status":        binding.Status,
			"metadata":      binding.Metadata,
			"updated_at":    now,
			"deleted_at":    nil,
		}).Error; err != nil {
		return err
	}

	binding.ID = existing.ID
	binding.CreatorUsername = existing.CreatorUsername
	binding.CreatedAt = existing.CreatedAt
	binding.UpdatedAt = now
	binding.DeletedAt = gorm.DeletedAt{}
	return nil
}

func lockActiveConnection(tx *gorm.DB, expected *model.TIntegrationConnection) error {
	if expected.Status != 4 {
		return ErrConnectionNotActive
	}
	var connection model.TIntegrationConnection
	err := connectionStateQuery(tx, expected).Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").
		Take(&connection).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrConnectionNotActive
	}
	return err
}
