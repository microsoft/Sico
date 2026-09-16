package impl

import (
	"context"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/integration/connector"
)

type AzureDevOpsConnector interface {
	connector.Connector

	DiscoverResources(
		ctx context.Context,
		accessToken, profileID, organizationID string,
	) ([]azuredevops.Organization, error)

	ResolveProject(
		ctx context.Context,
		accessToken, profileID, resourceKey string,
	) (*azuredevops.ResolvedProject, error)

	QueryProjectContentPage(
		ctx context.Context,
		accessToken string,
		project azuredevops.ResolvedProject,
		query azuredevops.ContentQuery,
	) (*azuredevops.ContentPage, error)

	ListExportFields(
		ctx context.Context,
		accessToken, organizationName, projectID string,
	) ([]azuredevops.ExportField, error)

	ExportSavedQueryFile(
		ctx context.Context,
		accessToken string,
		project azuredevops.ResolvedProject,
		queryID string,
		options azuredevops.ExportOptions,
	) (*azuredevops.QueryExport, error)
}
