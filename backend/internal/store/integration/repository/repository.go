package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/integration/internal/dal"
	"sico-backend/internal/store/integration/internal/dal/model"
)

type ConnectionModel = model.TIntegrationConnection
type BindingModel = model.TIntegrationBinding
type CredentialModel = model.TIntegrationCredential
type ConnectionFilter = dal.ConnectionFilter
type BindingFilter = dal.BindingFilter

var ErrCredentialVersionConflict = dal.ErrCredentialVersionConflict
var ErrConnectionNotActive = dal.ErrConnectionNotActive
var ErrConnectionStateConflict = dal.ErrConnectionStateConflict

func NewRepository(db *gorm.DB) IntegrationRepository {
	return WithTracingIntegrationRepository(dal.NewIntegrationDAO(db))
}

type IntegrationRepository interface {
	CreateConnection(ctx context.Context, connection *ConnectionModel) error
	GetConnectionByKey(ctx context.Context, connectionKey string) (*ConnectionModel, error)
	ListConnections(
		ctx context.Context,
		filter *ConnectionFilter,
		offset, limit int,
	) ([]*ConnectionModel, int64, error)
	UpdateConnectionFields(ctx context.Context, connectionID int64, fields map[string]any) error
	UpdateConnectionState(ctx context.Context, expected *ConnectionModel, fields map[string]any) error
	MarkConnectionReauthorizationRequired(
		ctx context.Context,
		connectionID int64,
		expectedStatus int32,
		expectedCredentialVersion int64,
		updaterUsername string,
	) error
	DeleteConnection(ctx context.Context, expected *ConnectionModel, updaterUsername string) error
	CreateOrReactivateBinding(
		ctx context.Context,
		expected *ConnectionModel,
		binding *BindingModel,
	) error
	GetBinding(ctx context.Context, connectionID, bindingID int64) (*BindingModel, error)
	ListBindings(
		ctx context.Context,
		connectionID int64,
		filter *BindingFilter,
		offset, limit int,
	) ([]*BindingModel, int64, error)
	UpdateBindingStatus(
		ctx context.Context,
		expected *ConnectionModel,
		bindingID int64,
		status int32,
	) error
	DeleteBinding(ctx context.Context, connectionID, bindingID int64) error
	GetCredentialVersion(
		ctx context.Context,
		connectionID, version int64,
	) (*CredentialModel, error)
	SaveCredentialVersion(
		ctx context.Context,
		expected *ConnectionModel,
		credential *CredentialModel,
		connectionFields map[string]any,
	) error
}
