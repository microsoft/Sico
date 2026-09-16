package impl

import (
	"context"
	"time"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

type azureOperation struct {
	ID        string `json:"id"`
	Kind      string `json:"kind,omitempty"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	Result    string `json:"result,omitempty"`
}

func (s *Service) beginAzureOperation(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	status int32,
	operation *azureOperation,
) error {
	metadata, err := decodeAzureMetadata(connection.Metadata)
	if err != nil {
		return err
	}

	metadata.Operation = operation
	fields := map[string]any{
		"status":   status,
		"metadata": encodeAzureMetadata(metadata),
	}
	if err := s.IntegrationRepo.UpdateConnectionState(ctx, connection, fields); err != nil {
		return mapConnectionStateConflict(err)
	}

	connection.Status = status
	connection.Metadata = encodeAzureMetadata(metadata)
	connection.UpdatedAt = time.Now().UnixMilli()

	return nil
}

func (s *Service) bindAzureAuthorization(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	start *azuredevops.AuthorizationStart,
	flow string,
	status int32,
) error {
	return s.beginAzureOperation(
		ctx,
		connection,
		status,
		&azureOperation{
			ID:        start.OperationID,
			Kind:      flow,
			ExpiresAt: start.ExpiresAt,
		},
	)
}

func validateAzureCallbackOperation(connection *integrationrepo.ConnectionModel, state *azuredevops.OAuthState) error {
	metadata, err := decodeAzureMetadata(connection.Metadata)
	if err != nil {
		return err
	}

	operation := metadata.Operation
	if operation == nil || operation.ID == "" || operation.ID != state.OperationID || operation.Kind != state.Flow ||
		operation.ExpiresAt <= time.Now().UnixMilli() {
		return apperr.New(errcode.CommonConflict, "authorization operation changed or expired; restart authorization")
	}

	return nil
}

func finishAzureOperation(metadata *azureConnectionMetadata, result string) {
	if metadata.Operation != nil {
		metadata.Operation = &azureOperation{ID: metadata.Operation.ID, Result: result}
	}
}

func (s *Service) endAzureOperation(ctx context.Context, connection *integrationrepo.ConnectionModel) error {
	metadata, err := decodeAzureMetadata(connection.Metadata)
	if err != nil {
		return err
	}

	finishAzureOperation(metadata, "failed")

	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	status := connection.Status
	if status == int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_PENDING_AUTHORIZATION) {
		status = int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_FAILED)
	}

	return s.IntegrationRepo.UpdateConnectionState(
		cleanupCtx,
		connection,
		map[string]any{
			"status":           status,
			"metadata":         encodeAzureMetadata(metadata),
			"updater_username": connection.OwnerUsername,
		},
	)
}
