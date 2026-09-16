package impl

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/knowledge"
	"sico-backend/internal/biz/project"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	organizationrepo "sico-backend/internal/store/organization/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

const (
	defaultPage     int32 = 1
	defaultPageSize int32 = 20
)

type Components struct {
	IntegrationRepo  integrationrepo.IntegrationRepository
	OrganizationRepo organizationrepo.OrganizationRepository
	ProjectRepo      projectrepo.ProjectRepository

	AzureDevOps      AzureDevOpsConnector
	ProjectService   project.Service
	KnowledgeService knowledge.Service

	Cache  *redis.Client
	Access rbac.Access
}

type Service struct {
	*Components
}

func NewService(components *Components) *Service {
	return &Service{Components: components}
}

func (s *Service) CreateConnection(
	ctx context.Context,
	req *integrationdto.CreateConnectionRequest,
	actor string,
) (*integrationdto.CreateConnectionResponse, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}
	if err := validateConnectionType(req.Provider, req.Mode); err != nil {
		return nil, err
	}

	if req.Provider != azuredevops.ProviderKey {
		if err := s.requireScope(
			ctx, rbac.ScopeOrg, req.OrganizationId, "integration", "use",
		); err != nil {
			return nil, err
		}
	}
	if _, err := s.OrganizationRepo.GetByID(ctx, req.OrganizationId); err != nil {
		return nil, mapNotFound(err, "organization not found")
	}

	connection := &integrationrepo.ConnectionModel{
		ConnectionKey:   uuid.NewString(),
		OrganizationID:  req.OrganizationId,
		ProjectID:       req.SicoProjectId,
		OwnerUsername:   actor,
		Provider:        req.Provider,
		Mode:            int32(req.Mode),
		Status:          int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_DRAFT),
		DisplayName:     req.DisplayName,
		CreatorUsername: actor,
		UpdaterUsername: actor,
	}
	if isPersonalAzureConnection(connection) {
		if err := s.authorizeAzureProjectUse(ctx, connection.OrganizationID, connection.ProjectID); err != nil {
			return nil, err
		}
	} else if connection.ProjectID != 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "sicoProjectId is only supported for personal ADO connections")
	}

	if err := s.IntegrationRepo.CreateConnection(ctx, connection); err != nil {
		return nil, mapConflict(err, "connection already exists")
	}

	result, err := connectionModelToDTO(connection)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&integrationdto.CreateConnectionResponse{Data: result}), nil
}

func (s *Service) GetConnection(
	ctx context.Context,
	connectionKey, actor string,
) (*integrationdto.GetConnectionResponse, error) {
	connection, err := s.getAuthorizedConnection(ctx, connectionKey, actor, false)
	if err != nil {
		return nil, err
	}

	result, err := connectionModelToDTO(connection)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&integrationdto.GetConnectionResponse{Data: result}), nil
}

func (s *Service) ListConnections(
	ctx context.Context,
	req *integrationdto.ListConnectionsRequest,
	actor string,
) (*integrationdto.ListConnectionsResponse, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}
	if req.Mode != nil && *req.Mode != integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL {
		return nil, apperr.New(errcode.CommonInvalidParam, "only personal connections are supported")
	}
	if err := s.authorizeConnectionList(ctx, req); err != nil {
		return nil, err
	}

	page, pageSize := normalizePagination(req.Page, req.PageSize)
	mode := int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL)
	filter := &integrationrepo.ConnectionFilter{
		OrganizationID:       req.OrganizationId,
		ProjectID:            req.SicoProjectId,
		VisibleOwnerUsername: actor,
		Mode:                 &mode,
	}
	if req.Provider != nil {
		filter.Provider = req.Provider
	}
	if req.Status != nil {
		value := int32(*req.Status)
		filter.Status = &value
	}

	offset := int(page-1) * int(pageSize)
	connections, total, err := s.IntegrationRepo.ListConnections(ctx, filter, offset, int(pageSize))
	if err != nil {
		return nil, err
	}

	result := make([]*integrationdto.Connection, 0, len(connections))
	for _, connection := range connections {
		item, err := connectionModelToDTO(connection)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}

	return appresp.Success(&integrationdto.ListConnectionsResponse{
		Data: &integrationdto.ListConnectionsData{
			Connections: result,
			Total:       total,
			HasNext:     int64(offset+len(result)) < total,
		},
	}), nil
}

func (s *Service) UpdateConnection(
	ctx context.Context,
	connectionKey string,
	req *integrationdto.UpdateConnectionRequest,
	actor string,
) (*integrationdto.UpdateConnectionResponse, error) {
	connection, err := s.getAuthorizedConnection(ctx, connectionKey, actor, true)
	if err != nil {
		return nil, err
	}

	if req.DisplayName != nil {
		if err := s.IntegrationRepo.UpdateConnectionFields(ctx, connection.ID, map[string]any{
			"display_name":     *req.DisplayName,
			"updater_username": actor,
		}); err != nil {
			return nil, mapNotFound(err, "connection not found")
		}
	}

	updated, err := s.IntegrationRepo.GetConnectionByKey(ctx, connectionKey)
	if err != nil {
		return nil, mapNotFound(err, "connection not found")
	}

	result, err := connectionModelToDTO(updated)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&integrationdto.UpdateConnectionResponse{Data: result}), nil
}

func (s *Service) DeleteConnection(
	ctx context.Context,
	connectionKey, actor string,
) (*integrationdto.DeleteConnectionResponse, error) {
	connection, err := s.getAuthorizedConnection(ctx, connectionKey, actor, false)
	if err != nil {
		return nil, err
	}
	if err := s.authorizeConnectionDeletion(ctx, connection, actor); err != nil {
		return nil, err
	}

	if err := s.IntegrationRepo.DeleteConnection(ctx, connection, actor); err != nil {
		return nil, mapConnectionStateConflict(err)
	}

	return appresp.Success(&integrationdto.DeleteConnectionResponse{}), nil
}

func (s *Service) CreateBinding(
	ctx context.Context,
	connectionKey string,
	req *integrationdto.CreateBindingRequest,
	actor string,
) (*integrationdto.CreateBindingResponse, error) {
	connection, err := s.getBindingConnection(ctx, connectionKey, actor, true)
	if err != nil {
		return nil, err
	}
	if connection.Status != int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE) {
		return nil, apperr.New(errcode.CommonConflict, "binding requires an active connection")
	}
	if err := validateResourceLocator(req); err != nil {
		return nil, err
	}
	if err := s.validateBindingScope(
		ctx, connection, req.SicoScopeType, req.SicoScopeId,
	); err != nil {
		return nil, err
	}

	binding := &integrationrepo.BindingModel{
		ConnectionID:    connection.ID,
		SicoScopeType:   int32(req.SicoScopeType),
		SicoScopeID:     req.SicoScopeId,
		ResourceType:    req.ResourceType,
		ResourceKey:     req.ResourceKey,
		ResourceName:    req.ResourceName,
		Status:          int32(integrationdto.BindingStatus_BINDING_STATUS_ACTIVE),
		CreatorUsername: actor,
	}
	if err := s.IntegrationRepo.CreateOrReactivateBinding(ctx, connection, binding); err != nil {
		if errors.Is(err, integrationrepo.ErrConnectionNotActive) {
			return nil, apperr.New(errcode.CommonConflict, "binding requires an active connection")
		}
		return nil, mapConflict(err, "binding already exists")
	}

	result, err := bindingModelToDTO(connectionKey, binding)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&integrationdto.CreateBindingResponse{Data: result}), nil
}

func (s *Service) GetBinding(
	ctx context.Context,
	connectionKey string,
	bindingID int64,
	actor string,
) (*integrationdto.GetBindingResponse, error) {
	connection, err := s.getBindingConnection(ctx, connectionKey, actor, false)
	if err != nil {
		return nil, err
	}

	binding, err := s.IntegrationRepo.GetBinding(ctx, connection.ID, bindingID)
	if err != nil {
		return nil, mapNotFound(err, "binding not found")
	}

	result, err := bindingModelToDTO(connectionKey, binding)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&integrationdto.GetBindingResponse{Data: result}), nil
}

func (s *Service) ListBindings(
	ctx context.Context,
	connectionKey string,
	req *integrationdto.ListBindingsRequest,
	actor string,
) (*integrationdto.ListBindingsResponse, error) {
	connection, err := s.getBindingConnection(ctx, connectionKey, actor, false)
	if err != nil {
		return nil, err
	}

	page, pageSize := normalizePagination(req.Page, req.PageSize)
	filter := &integrationrepo.BindingFilter{}
	if req.Status != nil {
		value := int32(*req.Status)
		filter.Status = &value
	}
	if req.ScopeType != nil {
		value := int32(*req.ScopeType)
		filter.ScopeType = &value
	}
	filter.ScopeID = req.ScopeId

	offset := int(page-1) * int(pageSize)
	bindings, total, err := s.IntegrationRepo.ListBindings(ctx, connection.ID, filter, offset, int(pageSize))
	if err != nil {
		return nil, err
	}

	result := make([]*integrationdto.Binding, 0, len(bindings))
	for _, binding := range bindings {
		item, err := bindingModelToDTO(connectionKey, binding)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}

	return appresp.Success(&integrationdto.ListBindingsResponse{
		Data: &integrationdto.ListBindingsData{
			Bindings: result,
			Total:    total,
			HasNext:  int64(offset+len(result)) < total,
		},
	}), nil
}

func (s *Service) UpdateBinding(
	ctx context.Context,
	connectionKey string,
	bindingID int64,
	req *integrationdto.UpdateBindingRequest,
	actor string,
) (*integrationdto.UpdateBindingResponse, error) {
	connection, err := s.getBindingConnection(ctx, connectionKey, actor, true)
	if err != nil {
		return nil, err
	}

	binding, err := s.IntegrationRepo.GetBinding(ctx, connection.ID, bindingID)
	if err != nil {
		return nil, mapNotFound(err, "binding not found")
	}
	if err := s.validateBindingScope(
		ctx,
		connection,
		integrationdto.SicoScopeType(binding.SicoScopeType),
		binding.SicoScopeID,
	); err != nil {
		return nil, err
	}

	if req.Status != nil {
		binding, err = s.applyBindingStatusUpdate(ctx, connection, binding, *req.Status)
		if err != nil {
			return nil, err
		}
	}

	result, err := bindingModelToDTO(connectionKey, binding)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&integrationdto.UpdateBindingResponse{Data: result}), nil
}

func (s *Service) DeleteBinding(
	ctx context.Context,
	connectionKey string,
	bindingID int64,
	actor string,
) (*integrationdto.DeleteBindingResponse, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}

	connection, err := s.IntegrationRepo.GetConnectionByKey(ctx, connectionKey)
	if err != nil {
		return nil, mapNotFound(err, "connection not found")
	}

	if connection.Provider == azuredevops.ProviderKey {
		return nil, apperr.New(errcode.CommonInvalidParam, "Azure DevOps connections do not use resource bindings")
	}

	binding, err := s.IntegrationRepo.GetBinding(ctx, connection.ID, bindingID)
	if err != nil {
		return nil, mapNotFound(err, "binding not found")
	}
	if err := s.authorizeBindingDeletion(ctx, connection, binding, actor); err != nil {
		return nil, err
	}

	if err := s.IntegrationRepo.DeleteBinding(ctx, connection.ID, bindingID); err != nil {
		return nil, mapNotFound(err, "binding not found")
	}

	return appresp.Success(&integrationdto.DeleteBindingResponse{}), nil
}

func (s *Service) authorizeBindingDeletion(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	binding *integrationrepo.BindingModel,
	actor string,
) error {
	if connection.Mode != int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL) {
		return apperr.New(errcode.CommonInvalidParam, "only personal connections are supported")
	}

	scopeType := integrationdto.SicoScopeType(binding.SicoScopeType)
	if scopeType == integrationdto.SicoScopeType_SICO_SCOPE_TYPE_ORGANIZATION {
		if binding.SicoScopeID != strconv.FormatInt(connection.OrganizationID, 10) {
			return apperr.New(errcode.CommonInvalidParam, "organization scope does not match connection organization")
		}
	} else if scopeType != integrationdto.SicoScopeType_SICO_SCOPE_TYPE_PROJECT {
		return apperr.New(errcode.CommonInvalidParam, "unsupported Sico scope type")
	}

	if connection.OwnerUsername == actor {
		return nil
	}
	if scopeType != integrationdto.SicoScopeType_SICO_SCOPE_TYPE_PROJECT {
		return apperr.New(errcode.CommonForbidden, "personal connection belongs to another user")
	}

	projectID, err := s.bindingProjectID(ctx, connection, binding.SicoScopeID)
	if err != nil {
		return err
	}

	return s.requireScope(
		ctx,
		rbac.ScopeProject,
		projectID,
		"integration",
		"bind",
	)
}

func (s *Service) bindingProjectID(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	scopeID string,
) (int64, error) {
	projectID, err := strconv.ParseInt(scopeID, 10, 64)
	if err != nil || projectID <= 0 || strconv.FormatInt(projectID, 10) != scopeID {
		return 0, apperr.New(errcode.CommonInvalidParam, "project scope ID must be a canonical positive integer")
	}

	project, err := s.ProjectRepo.GetProjectByID(ctx, projectID)
	if err != nil {
		return 0, mapNotFound(err, "project not found")
	}

	if project.OrganizationID != connection.OrganizationID {
		return 0, apperr.New(errcode.CommonInvalidParam, "project scope does not belong to connection organization")
	}

	return projectID, nil
}

func (s *Service) ensureReady() error {
	if s == nil || s.Components == nil || s.IntegrationRepo == nil ||
		s.OrganizationRepo == nil || s.ProjectRepo == nil {
		return apperr.New(errcode.CommonUnavailable, "integration service not initialized")
	}

	return nil
}

func (s *Service) getAuthorizedConnection(
	ctx context.Context,
	connectionKey, actor string,
	mutate bool,
) (*integrationrepo.ConnectionModel, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}

	connection, err := s.IntegrationRepo.GetConnectionByKey(ctx, connectionKey)
	if err != nil {
		return nil, mapNotFound(err, "connection not found")
	}

	if connection.Mode != int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL) {
		return nil, apperr.New(errcode.CommonInvalidParam, "only personal connections are supported")
	}

	if isPersonalAzureConnection(connection) {
		if err := s.authorizeAzureProjectUse(ctx, connection.OrganizationID, connection.ProjectID); err != nil {
			return nil, err
		}
		if mutate && connection.OwnerUsername != actor {
			return nil, apperr.New(errcode.CommonForbidden, "only the authorizing user may change this connection")
		}

		return connection, nil
	}

	if connection.OwnerUsername != actor {
		return nil, apperr.New(errcode.CommonForbidden, "personal connection belongs to another user")
	}

	if err := s.requireScope(
		ctx,
		rbac.ScopeOrg,
		connection.OrganizationID,
		"integration",
		"use",
	); err != nil {
		return nil, err
	}

	return connection, nil
}

func (s *Service) getBindingConnection(
	ctx context.Context,
	connectionKey, actor string,
	mutate bool,
) (*integrationrepo.ConnectionModel, error) {
	connection, err := s.getAuthorizedConnection(ctx, connectionKey, actor, mutate)
	if err != nil {
		return nil, err
	}

	if connection.Provider == azuredevops.ProviderKey {
		return nil, apperr.New(errcode.CommonInvalidParam, "Azure DevOps connections do not use resource bindings")
	}

	return connection, nil
}

func (s *Service) validateBindingScope(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	scopeType integrationdto.SicoScopeType,
	scopeID string,
) error {
	switch scopeType {
	case integrationdto.SicoScopeType_SICO_SCOPE_TYPE_ORGANIZATION:
		if scopeID != strconv.FormatInt(connection.OrganizationID, 10) {
			return apperr.New(errcode.CommonInvalidParam, "organization scope does not match connection organization")
		}
		return nil
	case integrationdto.SicoScopeType_SICO_SCOPE_TYPE_PROJECT:
		projectID, err := s.bindingProjectID(ctx, connection, scopeID)
		if err != nil {
			return err
		}
		return s.requireScope(
			ctx, rbac.ScopeProject, projectID, "integration", "bind",
		)
	default:
		return apperr.New(errcode.CommonInvalidParam, "unsupported Sico scope type")
	}
}

func validateConnectionType(provider string, mode integrationdto.ConnectionMode) error {
	validMode := mode == integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL
	if !validMachineKey(provider, 64) || !validMode {
		return apperr.New(errcode.CommonInvalidParam, "unsupported connection provider or mode")
	}

	return nil
}

func validateResourceLocator(req *integrationdto.CreateBindingRequest) error {
	values := []string{
		req.SicoScopeId,
		req.ResourceType,
		req.ResourceKey,
		req.ResourceName,
	}
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return apperr.New(errcode.CommonInvalidParam, "binding resource locator fields are required")
		}
	}
	if !validMachineKey(req.ResourceType, 64) {
		return apperr.New(errcode.CommonInvalidParam, "resourceType must be a lowercase connector key")
	}

	return nil
}

func validMachineKey(value string, maxLength int) bool {
	if len(value) == 0 || len(value) > maxLength || value[0] < 'a' || value[0] > 'z' {
		return false
	}

	for index := 1; index < len(value); index++ {
		char := value[index]
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '_' && char != '-' {
			return false
		}
	}

	return true
}

func validPublicBindingStatus(status integrationdto.BindingStatus) bool {
	return status >= integrationdto.BindingStatus_BINDING_STATUS_ACTIVE &&
		status <= integrationdto.BindingStatus_BINDING_STATUS_DISABLED
}

func (s *Service) applyBindingStatusUpdate(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	binding *integrationrepo.BindingModel,
	status integrationdto.BindingStatus,
) (*integrationrepo.BindingModel, error) {
	if err := s.updateBindingStatus(ctx, connection, binding.ID, status); err != nil {
		return nil, err
	}

	updated, err := s.IntegrationRepo.GetBinding(ctx, connection.ID, binding.ID)
	if err != nil {
		return nil, mapNotFound(err, "binding not found")
	}

	return updated, nil
}

func (s *Service) updateBindingStatus(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	bindingID int64,
	status integrationdto.BindingStatus,
) error {
	if !validPublicBindingStatus(status) {
		return apperr.New(errcode.CommonInvalidParam, "unsupported binding status")
	}

	err := s.IntegrationRepo.UpdateBindingStatus(ctx, connection, bindingID, int32(status))
	if err == nil {
		return nil
	}
	if errors.Is(err, integrationrepo.ErrConnectionNotActive) {
		return apperr.New(errcode.CommonConflict, "active binding requires an active connection")
	}

	return mapNotFound(err, "binding not found")
}

func connectionModelToDTO(connection *integrationrepo.ConnectionModel) (*integrationdto.Connection, error) {
	metadata, err := unmarshalMetadata(connection.Metadata)
	if err != nil {
		return nil, fmt.Errorf("decode connection metadata: %w", err)
	}

	return &integrationdto.Connection{
		Id:              connection.ID,
		ConnectionKey:   connection.ConnectionKey,
		OrganizationId:  connection.OrganizationID,
		SicoProjectId:   connection.ProjectID,
		OwnerUsername:   connection.OwnerUsername,
		Provider:        connection.Provider,
		Mode:            integrationdto.ConnectionMode(connection.Mode),
		Status:          integrationdto.ConnectionStatus(connection.Status),
		DisplayName:     connection.DisplayName,
		ExternalId:      connection.ExternalID,
		Metadata:        metadata,
		CreatorUsername: connection.CreatorUsername,
		UpdaterUsername: connection.UpdaterUsername,
		CreatedAt:       connection.CreatedAt,
		UpdatedAt:       connection.UpdatedAt,
	}, nil
}

func bindingModelToDTO(connectionKey string, binding *integrationrepo.BindingModel) (*integrationdto.Binding, error) {
	metadata, err := unmarshalMetadata(binding.Metadata)
	if err != nil {
		return nil, fmt.Errorf("decode binding metadata: %w", err)
	}

	return &integrationdto.Binding{
		Id:              binding.ID,
		ConnectionKey:   connectionKey,
		SicoScopeType:   integrationdto.SicoScopeType(binding.SicoScopeType),
		SicoScopeId:     binding.SicoScopeID,
		ResourceType:    binding.ResourceType,
		ResourceKey:     binding.ResourceKey,
		ResourceName:    binding.ResourceName,
		Status:          integrationdto.BindingStatus(binding.Status),
		Metadata:        metadata,
		CreatorUsername: binding.CreatorUsername,
		CreatedAt:       binding.CreatedAt,
		UpdatedAt:       binding.UpdatedAt,
	}, nil
}

func normalizePagination(page, pageSize int32) (int32, int32) {
	if page == 0 {
		page = defaultPage
	}
	if pageSize == 0 {
		pageSize = defaultPageSize
	}

	return page, pageSize
}

func mapNotFound(err error, message string) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return apperr.New(errcode.CommonNotFound, message)
	}

	return err
}

func mapConflict(err error, message string) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return apperr.New(errcode.CommonConflict, message)
	}

	return err
}
