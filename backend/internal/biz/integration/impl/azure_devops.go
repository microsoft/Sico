package impl

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

const azureResourceAccessAllProjects = "all_accessible_projects"

type azureConnectionMetadata struct {
	SchemaVersion  int             `json:"schemaVersion"`
	Stage          string          `json:"stage"`
	ResourceAccess string          `json:"resourceAccess,omitempty"`
	Operation      *azureOperation `json:"operation,omitempty"`
	TargetTenantID string          `json:"targetTenantId,omitempty"`
	ProfileID      string          `json:"profileId,omitempty"`
}

func (s *Service) StartAzureDevOpsPersonal(
	ctx context.Context,
	req *integrationdto.StartAzureDevOpsAuthorizationRequest,
	actor string,
) (*integrationdto.StartAzureDevOpsAuthorizationResponse, error) {
	connection, err := s.prepareAzureConnection(ctx, req, actor)
	if err != nil {
		return nil, err
	}

	start, err := s.AzureDevOps.StartAuthorization(
		ctx,
		azuredevops.FlowPersonal,
		connection.ConnectionKey,
		connection.OrganizationID,
		actor,
	)
	if err != nil {
		return nil, mapAzureError(err)
	}

	if err := s.bindAzureAuthorization(
		ctx,
		connection,
		start,
		azuredevops.FlowPersonal,
		connection.Status,
	); err != nil {
		return nil, err
	}

	return authorizationStartResponse(connection.ConnectionKey, start), nil
}

func (s *Service) CompleteAzureDevOpsPersonal(
	ctx context.Context,
	state, code string,
) (string, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return "", err
	}

	completion, completionErr := s.AzureDevOps.CompleteAuthorization(ctx, azuredevops.FlowPersonal, state, code)
	if completion == nil || completion.State == nil {
		if completionErr != nil {
			return "", mapAzureError(completionErr)
		}

		return "", apperr.New(errcode.IntegrationProviderFailure, "Azure DevOps authorization response is incomplete")
	}

	connection, err := s.validateCallbackConnection(ctx, completion.State)
	if err != nil {
		return "", err
	}

	if completionErr == nil {
		completionErr = s.savePersonalAuthorization(ctx, connection, completion)
	} else {
		completionErr = mapAzureError(completionErr)
	}
	if completionErr != nil {
		if err := s.endAzureOperation(ctx, connection); err != nil {
			return "", errors.Join(completionErr, mapConnectionStateConflict(err))
		}

		redirectURL := s.azureFrontendURL(
			"failed",
			connection.ConnectionKey,
			azuredevops.FlowPersonal,
			"authorization_failed",
		)
		return redirectURL, completionErr
	}

	return s.azureFrontendURL("authorized", connection.ConnectionKey, azuredevops.FlowPersonal, ""), nil
}

func (s *Service) savePersonalAuthorization(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	completion *azuredevops.AuthorizationCompletion,
) error {
	existingMetadata, err := decodeAzureMetadata(connection.Metadata)
	if err != nil {
		return err
	}

	if completion.TenantID == "" || completion.Profile == nil ||
		completion.Profile.ID == "" || completion.Bundle == nil {
		return apperr.New(errcode.IntegrationProviderFailure, "Azure DevOps account identity is incomplete")
	}

	sameTenant := existingMetadata.TargetTenantID == "" ||
		strings.EqualFold(existingMetadata.TargetTenantID, completion.TenantID)
	sameProfile := strings.EqualFold(existingMetadata.ProfileID, completion.Profile.ID)
	if existingMetadata.ProfileID != "" && (!sameProfile || !sameTenant) {
		return apperr.New(
			errcode.CommonConflict,
			"Azure DevOps account does not match this connection; create a new connection to use another account",
		)
	}

	metadata := existingMetadata
	metadata.Stage = "active"
	metadata.ResourceAccess = azureResourceAccessAllProjects
	metadata.TargetTenantID = completion.TenantID
	metadata.ProfileID = completion.Profile.ID
	finishAzureOperation(metadata, "authorized")

	return s.saveAzureCredential(
		ctx,
		connection,
		completion.Bundle,
		metadata,
		completion.State.Actor,
		map[string]any{
			"external_id": completion.Profile.ID,
			"status":      int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE),
		},
	)
}

func (s *Service) FailAzureDevOpsAuthorization(
	ctx context.Context,
	state, errorCode string,
) (string, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return "", err
	}

	transaction, err := s.AzureDevOps.ConsumeAuthorizationState(ctx, state)
	if err != nil {
		return "", mapAzureError(err)
	}

	if transaction.Flow != azuredevops.FlowPersonal {
		return "", apperr.New(errcode.CommonInvalidParam, "OAuth state does not match callback flow")
	}

	connection, err := s.validateCallbackConnection(ctx, transaction)
	if err != nil {
		return "", err
	}

	if err := s.endAzureOperation(ctx, connection); err != nil {
		return "", mapConnectionStateConflict(err)
	}

	return s.azureFrontendURL("failed", connection.ConnectionKey, transaction.Flow, errorCode), nil
}

func (s *Service) ListAzureDevOpsConnections(
	ctx context.Context,
	req *integrationdto.ListConnectionsRequest,
	actor string,
) (*integrationdto.ListConnectionsResponse, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return nil, err
	}

	provider := azuredevops.ProviderKey
	req.Provider = &provider

	return s.ListConnections(ctx, req, actor)
}

func (s *Service) ListAzureDevOpsCandidates(
	ctx context.Context,
	req *integrationdto.ListAzureDevOpsCandidatesRequest,
	actor string,
) (*integrationdto.ListAzureDevOpsCandidatesResponse, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return nil, err
	}

	connection, err := s.getAuthorizedConnection(ctx, req.ConnectionKey, actor, false)
	if err != nil {
		return nil, err
	}

	if !isPersonalAzureConnection(connection) {
		return nil, apperr.New(errcode.CommonInvalidParam, "connection is not a personal Azure DevOps connection")
	}
	if connection.Status != int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE) {
		return nil, apperr.New(errcode.CommonConflict, "selected Azure DevOps account is not active")
	}

	bundle, err := s.azureDelegatedBundle(ctx, connection, actor)
	if err != nil {
		return nil, err
	}

	organizations, err := s.AzureDevOps.DiscoverResources(
		ctx,
		bundle.AccessToken,
		bundle.ProfileID,
		req.ExternalOrganizationId,
	)
	if err != nil {
		return nil, mapAzureError(err)
	}

	return appresp.Success(&integrationdto.ListAzureDevOpsCandidatesResponse{
		Data: &integrationdto.ListAzureDevOpsCandidatesData{
			Organizations: azureOrganizationsToDTO(organizations),
		},
	}), nil
}

func (s *Service) prepareAzureConnection(
	ctx context.Context,
	req *integrationdto.StartAzureDevOpsAuthorizationRequest,
	actor string,
) (*integrationrepo.ConnectionModel, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return nil, err
	}

	connectionKey := strings.TrimSpace(req.GetConnectionKey())
	if connectionKey == "" {
		displayName := strings.TrimSpace(req.GetDisplayName())
		if displayName == "" {
			displayName = "Azure DevOps"
		}

		created, err := s.CreateConnection(
			ctx,
			&integrationdto.CreateConnectionRequest{
				OrganizationId: req.OrganizationId,
				SicoProjectId:  req.SicoProjectId,
				Provider:       azuredevops.ProviderKey,
				Mode:           integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL,
				DisplayName:    displayName,
			},
			actor,
		)
		if err != nil {
			return nil, err
		}

		connectionKey = created.Data.ConnectionKey
	}

	connection, err := s.getAzureConnection(ctx, connectionKey, actor)
	if err != nil {
		return nil, err
	}

	if connection.OrganizationID != req.OrganizationId {
		return nil, apperr.New(errcode.CommonForbidden, "connection organization does not match request")
	}
	if req.SicoProjectId <= 0 || req.SicoProjectId != connection.ProjectID {
		return nil, apperr.New(errcode.CommonInvalidParam, "sicoProjectId must match the connection's owning project")
	}

	if connection.Status != int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE) {
		switch integrationdto.ConnectionStatus(connection.Status) {
		case integrationdto.ConnectionStatus_CONNECTION_STATUS_DRAFT,
			integrationdto.ConnectionStatus_CONNECTION_STATUS_PENDING_AUTHORIZATION,
			integrationdto.ConnectionStatus_CONNECTION_STATUS_REAUTHORIZATION_REQUIRED,
			integrationdto.ConnectionStatus_CONNECTION_STATUS_SUSPENDED,
			integrationdto.ConnectionStatus_CONNECTION_STATUS_FAILED:
		default:
			return nil, apperr.New(errcode.CommonConflict, "connection workflow is already in progress")
		}

		if err := s.IntegrationRepo.UpdateConnectionState(
			ctx,
			connection,
			map[string]any{
				"status": int32(
					integrationdto.ConnectionStatus_CONNECTION_STATUS_PENDING_AUTHORIZATION,
				),
				"updater_username": actor,
			},
		); err != nil {
			return nil, mapConnectionStateConflict(err)
		}

		connection.Status = int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_PENDING_AUTHORIZATION)
	}

	return connection, nil
}

func (s *Service) requireAzureDevOps() error {
	if s.AzureDevOps == nil || !s.AzureDevOps.Enabled() {
		return apperr.New(
			errcode.IntegrationConnectorUnavailable,
			"Azure DevOps connector is not configured or enabled",
		)
	}

	return nil
}

func (s *Service) getAzureConnection(
	ctx context.Context,
	connectionKey, actor string,
) (*integrationrepo.ConnectionModel, error) {
	connection, err := s.getAuthorizedConnection(ctx, connectionKey, actor, true)
	if err != nil {
		return nil, err
	}

	if !isPersonalAzureConnection(connection) {
		return nil, apperr.New(errcode.CommonInvalidParam, "connection is not the expected Azure DevOps connection type")
	}

	return connection, nil
}

func (s *Service) validateCallbackConnection(
	ctx context.Context,
	state *azuredevops.OAuthState,
) (*integrationrepo.ConnectionModel, error) {
	connection, err := s.IntegrationRepo.GetConnectionByKey(ctx, state.ConnectionKey)
	if err != nil {
		return nil, mapNotFound(err, "connection not found")
	}

	if !isPersonalAzureConnection(connection) || connection.OrganizationID != state.OrganizationID {
		return nil, apperr.New(errcode.CommonForbidden, "OAuth state does not match connection")
	}
	if connection.OwnerUsername != state.Actor {
		return nil, apperr.New(errcode.CommonForbidden, "OAuth state does not match connection owner")
	}

	if err := validateAzureCallbackOperation(connection, state); err != nil {
		return nil, err
	}
	if err := s.authorizePersonalCallback(ctx, connection, state.Actor); err != nil {
		return nil, err
	}

	switch integrationdto.ConnectionStatus(connection.Status) {
	case integrationdto.ConnectionStatus_CONNECTION_STATUS_DRAFT,
		integrationdto.ConnectionStatus_CONNECTION_STATUS_PENDING_AUTHORIZATION,
		integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE,
		integrationdto.ConnectionStatus_CONNECTION_STATUS_REAUTHORIZATION_REQUIRED,
		integrationdto.ConnectionStatus_CONNECTION_STATUS_SUSPENDED,
		integrationdto.ConnectionStatus_CONNECTION_STATUS_FAILED:
	default:
		return nil, apperr.New(errcode.CommonConflict, "connection workflow is already in progress")
	}

	return connection, nil
}

func (s *Service) saveAzureCredential(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	bundle *azuredevops.TokenBundle,
	metadata *azureConnectionMetadata,
	actor string,
	fields map[string]any,
) error {
	version := connection.CredentialVersion + 1
	encrypted, err := s.AzureDevOps.EncryptTokenBundle(connection.ID, version, connection.Mode, bundle)
	if err != nil {
		return mapAzureError(err)
	}

	if metadata != nil {
		fields["metadata"] = encodeAzureMetadata(metadata)
	}
	fields["updater_username"] = actor

	credential := &integrationrepo.CredentialModel{
		Version:       version,
		Scheme:        encrypted.Scheme,
		KeyID:         encrypted.KeyID,
		EncryptedData: encrypted.Data,
	}

	if err := s.IntegrationRepo.SaveCredentialVersion(
		ctx,
		connection,
		credential,
		fields,
	); err != nil {
		if isPersonalAzureConnection(connection) && errors.Is(err, gorm.ErrDuplicatedKey) {
			return apperr.New(
				errcode.CommonConflict,
				"account already connected in this project; select it to reauthorize",
			)
		}
		if errors.Is(err, integrationrepo.ErrCredentialVersionConflict) {
			return apperr.Wrap(
				errcode.CommonConflict,
				"connection credentials changed concurrently",
				integrationrepo.ErrCredentialVersionConflict,
			)
		}

		return mapConnectionStateConflict(err)
	}

	connection.CredentialVersion = version
	if metadata != nil {
		connection.Metadata = fields["metadata"].(datatypes.JSON)
	}
	if status, ok := fields["status"].(int32); ok {
		connection.Status = status
	}

	return nil
}

func (s *Service) azureDelegatedBundle(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	actor string,
) (*azuredevops.TokenBundle, error) {
	if connection.CredentialVersion <= 0 {
		return nil, apperr.New(errcode.CommonConflict, "Azure DevOps authorization is required")
	}

	credential, err := s.IntegrationRepo.GetCredentialVersion(
		ctx,
		connection.ID,
		connection.CredentialVersion,
	)
	if err != nil {
		return nil, mapNotFound(err, "Azure DevOps credential not found")
	}

	bundle, err := s.AzureDevOps.DecryptTokenBundle(
		connection.ID,
		credential.Version,
		connection.Mode,
		&azuredevops.EncryptedData{
			Scheme: credential.Scheme,
			KeyID:  credential.KeyID,
			Data:   credential.EncryptedData,
		},
	)
	if err != nil {
		return nil, mapAzureError(err)
	}

	refreshed, changed, err := s.AzureDevOps.RefreshToken(ctx, bundle)
	if errors.Is(err, azuredevops.ErrReauthorizationRequired) {
		return s.recoverAzureRefresh(ctx, connection, actor)
	}
	if err != nil {
		return nil, mapAzureError(err)
	}
	if !changed {
		return refreshed, nil
	}

	if err := s.saveAzureCredential(ctx, connection, refreshed, nil, actor, map[string]any{}); err != nil {
		if errors.Is(err, integrationrepo.ErrCredentialVersionConflict) {
			return s.reloadAzureDelegatedBundle(ctx, connection.ConnectionKey)
		}

		return nil, err
	}

	return refreshed, nil
}

func (s *Service) recoverAzureRefresh(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	actor string,
) (*azuredevops.TokenBundle, error) {
	err := s.IntegrationRepo.MarkConnectionReauthorizationRequired(
		ctx,
		connection.ID,
		connection.Status,
		connection.CredentialVersion,
		actor,
	)

	reauthorizationErr := apperr.New(errcode.IntegrationReauthorizationRequired, "Azure DevOps reauthorization is required")
	if err == nil {
		return nil, reauthorizationErr
	}
	if !errors.Is(err, integrationrepo.ErrConnectionStateConflict) {
		return nil, err
	}

	latest, err := s.IntegrationRepo.GetConnectionByKey(ctx, connection.ConnectionKey)
	if err != nil {
		return nil, mapNotFound(err, "connection not found")
	}
	if latest.CredentialVersion <= connection.CredentialVersion || latest.Status != connection.Status {
		return nil, reauthorizationErr
	}

	bundle, err := s.reloadAzureDelegatedBundle(ctx, connection.ConnectionKey)
	if err != nil {
		return nil, err
	}
	if bundle.ExpiresAt <= time.Now().UnixMilli() {
		return nil, reauthorizationErr
	}

	return bundle, nil
}

func (s *Service) reloadAzureDelegatedBundle(ctx context.Context, connectionKey string) (*azuredevops.TokenBundle, error) {
	connection, err := s.IntegrationRepo.GetConnectionByKey(ctx, connectionKey)
	if err != nil {
		return nil, mapNotFound(err, "connection not found")
	}

	credential, err := s.IntegrationRepo.GetCredentialVersion(
		ctx, connection.ID, connection.CredentialVersion,
	)
	if err != nil {
		return nil, mapNotFound(err, "Azure DevOps credential not found")
	}

	return s.AzureDevOps.DecryptTokenBundle(
		connection.ID,
		credential.Version,
		connection.Mode,
		&azuredevops.EncryptedData{
			Scheme: credential.Scheme,
			KeyID:  credential.KeyID,
			Data:   credential.EncryptedData,
		},
	)
}

func authorizationStartResponse(
	connectionKey string,
	start *azuredevops.AuthorizationStart,
) *integrationdto.StartAzureDevOpsAuthorizationResponse {
	return appresp.Success(&integrationdto.StartAzureDevOpsAuthorizationResponse{
		Data: &integrationdto.StartAzureDevOpsAuthorizationData{
			AuthorizationUrl: start.AuthorizationURL,
			ConnectionKey:    connectionKey,
			ExpiresAt:        start.ExpiresAt,
			OperationId:      start.OperationID,
		},
	})
}

func azureOrganizationsToDTO(organizations []azuredevops.Organization) []*integrationdto.AzureDevOpsOrganization {
	result := make([]*integrationdto.AzureDevOpsOrganization, 0, len(organizations))
	for _, organization := range organizations {
		projects := make([]*integrationdto.AzureDevOpsProject, 0, len(organization.Projects))
		for _, project := range organization.Projects {
			projects = append(projects, &integrationdto.AzureDevOpsProject{
				Id:          project.ID,
				Name:        project.Name,
				Description: project.Description,
				State:       project.State,
				Visibility:  project.Visibility,
				ParentId:    organization.ID,
				ParentName:  organization.Name,
				ResourceKey: organization.ID + "/" + project.ID,
			})
		}

		result = append(result, &integrationdto.AzureDevOpsOrganization{
			Id:       organization.ID,
			Name:     organization.Name,
			Projects: projects,
		})
	}

	return result
}

func encodeAzureMetadata(metadata *azureConnectionMetadata) datatypes.JSON {
	data, _ := json.Marshal(metadata)

	return datatypes.JSON(data)
}

func decodeAzureMetadata(data datatypes.JSON) (*azureConnectionMetadata, error) {
	metadata := &azureConnectionMetadata{SchemaVersion: 1}
	if len(data) == 0 || string(data) == "null" {
		return metadata, nil
	}
	if err := json.Unmarshal(data, metadata); err != nil || metadata.SchemaVersion != 1 {
		return nil, apperr.New(errcode.CommonConflict, "Azure DevOps connection metadata is invalid")
	}

	return metadata, nil
}

func (s *Service) azureFrontendURL(
	status, connectionKey, flow, errorCode string,
) string {
	frontend, err := url.Parse(s.AzureDevOps.FrontendReturnURL())
	if err != nil {
		return s.AzureDevOps.FrontendReturnURL()
	}

	query := frontend.Query()
	query.Set("status", status)
	query.Set("connectionKey", connectionKey)
	query.Set("flow", flow)
	if errorCode != "" {
		query.Set("error", truncatePublicValue(errorCode, 64))
	}
	frontend.RawQuery = query.Encode()

	return frontend.String()
}

func truncatePublicValue(value string, limit int) string {
	value = strings.Map(func(char rune) rune {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' ||
			char == '_' || char == '-' || char == '.' {
			return char
		}
		return -1
	}, value)
	if len(value) > limit {
		return value[:limit]
	}

	return value
}

func mapAzureError(err error) error {
	switch {
	case errors.Is(err, azuredevops.ErrConnectorDisabled):
		return apperr.New(
			errcode.IntegrationConnectorUnavailable,
			"Azure DevOps connector is not configured or enabled",
		)
	case errors.Is(err, azuredevops.ErrOAuthStateInvalid):
		return apperr.New(
			errcode.IntegrationOAuthStateInvalid,
			"OAuth state is invalid, expired, or already consumed",
		)
	case errors.Is(err, azuredevops.ErrDecryptCredential):
		return apperr.New(
			errcode.IntegrationCredentialUnavailable,
			"Azure DevOps credential could not be decrypted",
		)
	case errors.Is(err, azuredevops.ErrReauthorizationRequired):
		return apperr.New(
			errcode.IntegrationReauthorizationRequired,
			"Azure DevOps reauthorization is required",
		)
	case errors.Is(err, azuredevops.ErrInvalidContentQuery):
		message := strings.TrimPrefix(err.Error(), azuredevops.ErrInvalidContentQuery.Error()+": ")
		return apperr.New(errcode.CommonInvalidParam, message)
	default:
		return apperr.Wrap(
			errcode.IntegrationProviderFailure,
			"Azure DevOps provider request failed",
			err,
		)
	}
}

func mapConnectionStateConflict(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return apperr.New(
			errcode.CommonConflict, "this connection already exists",
		)
	}
	if errors.Is(err, integrationrepo.ErrConnectionStateConflict) {
		return apperr.New(errcode.CommonConflict, "connection state changed; retry the operation")
	}

	return err
}
