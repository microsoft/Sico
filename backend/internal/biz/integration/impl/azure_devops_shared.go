package impl

import (
	"context"
	"errors"
	"strings"

	"google.golang.org/protobuf/types/known/structpb"

	appresp "sico-backend/internal/biz/common/response"
	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

type azureSharedAccess struct {
	connection       *integrationrepo.ConnectionModel
	project          *azuredevops.ResolvedProject
	credentialBundle *azuredevops.TokenBundle
}

func (s *Service) ListAzureDevOpsProjectConnections(
	ctx context.Context,
	req *integrationdto.ListAzureDevOpsProjectConnectionsRequest,
	actor string,
) (*integrationdto.ListAzureDevOpsProjectConnectionsResponse, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return nil, err
	}
	if err := s.authorizeAzureProjectUse(ctx, req.OrganizationId, req.SicoProjectId); err != nil {
		return nil, err
	}

	page, pageSize := normalizePagination(req.Page, req.PageSize)
	provider := azuredevops.ProviderKey
	mode := int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL)

	connections, total, err := s.IntegrationRepo.ListConnections(
		ctx,
		&integrationrepo.ConnectionFilter{
			OrganizationID: req.OrganizationId,
			ProjectID:      req.SicoProjectId,
			Search:         strings.TrimSpace(req.Search),
			Provider:       &provider,
			Mode:           &mode,
		},
		int(page-1)*int(pageSize),
		int(pageSize),
	)
	if err != nil {
		return nil, err
	}

	result := make([]*integrationdto.AzureDevOpsProjectConnection, 0, len(connections))
	for _, connection := range connections {
		result = append(result, &integrationdto.AzureDevOpsProjectConnection{
			ConnectionKey:   connection.ConnectionKey,
			DisplayName:     connection.DisplayName,
			OwnerUsername:   connection.OwnerUsername,
			CreatorUsername: connection.CreatorUsername,
			Status:          integrationdto.ConnectionStatus(connection.Status),
			CreatedAt:       connection.CreatedAt,
			UpdatedAt:       connection.UpdatedAt,
		})
	}

	return appresp.Success(&integrationdto.ListAzureDevOpsProjectConnectionsResponse{
		Data: &integrationdto.ListAzureDevOpsProjectConnectionsData{
			Connections: result,
			Total:       total,
			HasNext:     int64(int(page-1)*int(pageSize)+len(result)) < total,
		},
	}), nil
}

func (s *Service) QueryAzureDevOpsContent(
	ctx context.Context,
	req *integrationdto.QueryAzureDevOpsContentRequest,
	actor string,
) (*integrationdto.QueryAzureDevOpsContentResponse, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return nil, err
	}

	access, err := s.azureSharedProjectAccess(
		ctx,
		req.ConnectionKey,
		req.SicoProjectId,
		req.ResourceKey,
		actor,
	)
	if err != nil {
		return nil, err
	}

	page, err := s.AzureDevOps.QueryProjectContentPage(
		ctx,
		access.credentialBundle.AccessToken,
		*access.project,
		azuredevops.ContentQuery{
			Kind:         req.Kind,
			Search:       strings.TrimSpace(req.Search),
			WorkItemType: strings.TrimSpace(req.WorkItemType),
			State:        strings.TrimSpace(req.State),
			AssignedTo:   strings.TrimSpace(req.AssignedTo),
			PlanID:       req.PlanId,
			SuiteID:      req.SuiteId,
			PipelineID:   req.PipelineId,
			Top:          req.Top,
			QueryID:      req.QueryId,
			WorkItemID:   req.WorkItemId,
			Offset:       req.Offset,
			AsOf:         req.AsOf,
		},
	)
	if err != nil {
		return nil, mapAzureError(err)
	}

	itemStructs := make([]*structpb.Struct, 0, len(page.Items))
	for _, item := range page.Items {
		value, conversionErr := structpb.NewStruct(item)
		if conversionErr != nil {
			return nil, errors.New("azure DevOps returned unsupported content data")
		}

		itemStructs = append(itemStructs, value)
	}

	var metadata *structpb.Struct
	if page.Metadata != nil {
		metadata, err = structpb.NewStruct(page.Metadata)
		if err != nil {
			return nil, errors.New("azure DevOps returned unsupported query metadata")
		}
	}

	return appresp.Success(&integrationdto.QueryAzureDevOpsContentResponse{
		Data: &integrationdto.QueryAzureDevOpsContentData{
			ConnectionKey: access.connection.ConnectionKey,
			OwnerUsername: access.connection.OwnerUsername,
			ResourceKey:   access.project.OrganizationID + "/" + access.project.ID,
			Kind:          req.Kind,
			Items:         itemStructs,
			Count:         int32(len(itemStructs)),
			Metadata:      metadata,
		},
	}), nil
}

func (s *Service) authorizeAzureProjectUse(
	ctx context.Context,
	organizationID, projectID int64,
) error {
	if projectID <= 0 {
		return apperr.New(errcode.CommonInvalidParam, "sicoProjectId must be positive")
	}

	project, err := s.ProjectRepo.GetProjectByID(ctx, projectID)
	if err != nil {
		return mapNotFound(err, "project not found")
	}

	if project.OrganizationID != organizationID {
		return apperr.New(errcode.CommonInvalidParam, "project does not belong to the requested organization")
	}

	return s.requireScope(
		ctx,
		rbac.ScopeProject,
		projectID,
		"integration",
		"use",
	)
}

func (s *Service) azureSharedProjectAccess(
	ctx context.Context,
	connectionKey string,
	sicoProjectID int64,
	resourceKey, actor string,
) (*azureSharedAccess, error) {
	project, err := s.ProjectRepo.GetProjectByID(ctx, sicoProjectID)
	if err != nil {
		return nil, mapNotFound(err, "project not found")
	}

	if err := s.requireScope(
		ctx,
		rbac.ScopeProject,
		sicoProjectID,
		"integration",
		"use",
	); err != nil {
		return nil, err
	}

	connection, err := s.IntegrationRepo.GetConnectionByKey(ctx, connectionKey)
	if err != nil {
		return nil, mapNotFound(err, "connection not found")
	}

	if connection.ProjectID != sicoProjectID || connection.OrganizationID != project.OrganizationID ||
		connection.Provider != azuredevops.ProviderKey ||
		connection.Mode != int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL) {
		return nil, apperr.New(errcode.CommonForbidden, "connection does not belong to this project")
	}
	if connection.Status != int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE) {
		return nil, apperr.New(errcode.CommonConflict, "selected Azure DevOps account is not active")
	}

	return s.azureAccessibleProject(ctx, connection, resourceKey, actor)
}

func (s *Service) azureAccessibleProject(
	ctx context.Context,
	connection *integrationrepo.ConnectionModel,
	resourceKey, actor string,
) (*azureSharedAccess, error) {
	bundle, err := s.azureDelegatedBundle(ctx, connection, actor)
	if err != nil {
		return nil, err
	}

	project, err := s.AzureDevOps.ResolveProject(ctx, bundle.AccessToken, bundle.ProfileID, resourceKey)
	if err != nil {
		return nil, mapAzureError(err)
	}

	return &azureSharedAccess{
		connection:       connection,
		credentialBundle: bundle,
		project:          project,
	}, nil
}
