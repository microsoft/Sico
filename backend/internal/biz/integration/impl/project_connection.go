package impl

import (
	"context"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
	"sico-backend/internal/transport/http/middleware"
)

func isPersonalAzureConnection(connection *integrationrepo.ConnectionModel) bool {
	return connection.Provider == azuredevops.ProviderKey &&
		connection.Mode == int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL)
}

func (s *Service) authorizeConnectionList(ctx context.Context, req *integrationdto.ListConnectionsRequest) error {
	if req.SicoProjectId > 0 {
		return s.authorizeAzureProjectUse(ctx, req.OrganizationId, req.SicoProjectId)
	}
	if req.GetProvider() == azuredevops.ProviderKey {
		return apperr.New(errcode.CommonInvalidParam, "sicoProjectId is required for personal Azure DevOps connections")
	}
	return s.requireScope(ctx, rbac.ScopeOrg, req.OrganizationId, "integration", "use")
}

func (s *Service) authorizeConnectionDeletion(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	actor string,
) error {
	if isPersonalAzureConnection(connection) {
		if connection.OwnerUsername == actor {
			return nil
		}
		return s.requireScope(ctx, rbac.ScopeProject, connection.ProjectID, "integration", "bind")
	}
	return nil
}

func (s *Service) authorizePersonalCallback(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	actor string,
) error {
	actorContext := context.WithValue(ctx, middleware.ContextUserKey, middleware.UserInfo{Name: actor})
	return s.authorizeAzureProjectUse(actorContext, connection.OrganizationID, connection.ProjectID)
}
