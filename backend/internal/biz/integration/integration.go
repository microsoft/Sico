package integration

import (
	"context"

	"sico-backend/internal/biz/integration/azuredevops"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

type Service interface {
	CreateConnection(
		ctx context.Context,
		req *integrationdto.CreateConnectionRequest,
		actor string,
	) (*integrationdto.CreateConnectionResponse, error)

	GetConnection(
		ctx context.Context,
		connectionKey, actor string,
	) (*integrationdto.GetConnectionResponse, error)

	ListConnections(
		ctx context.Context,
		req *integrationdto.ListConnectionsRequest,
		actor string,
	) (*integrationdto.ListConnectionsResponse, error)

	UpdateConnection(
		ctx context.Context,
		connectionKey string,
		req *integrationdto.UpdateConnectionRequest,
		actor string,
	) (*integrationdto.UpdateConnectionResponse, error)

	DeleteConnection(
		ctx context.Context,
		connectionKey, actor string,
	) (*integrationdto.DeleteConnectionResponse, error)

	CreateBinding(
		ctx context.Context,
		connectionKey string,
		req *integrationdto.CreateBindingRequest,
		actor string,
	) (*integrationdto.CreateBindingResponse, error)

	GetBinding(
		ctx context.Context,
		connectionKey string,
		bindingID int64,
		actor string,
	) (*integrationdto.GetBindingResponse, error)

	ListBindings(
		ctx context.Context,
		connectionKey string,
		req *integrationdto.ListBindingsRequest,
		actor string,
	) (*integrationdto.ListBindingsResponse, error)

	UpdateBinding(
		ctx context.Context,
		connectionKey string,
		bindingID int64,
		req *integrationdto.UpdateBindingRequest,
		actor string,
	) (*integrationdto.UpdateBindingResponse, error)

	DeleteBinding(
		ctx context.Context,
		connectionKey string,
		bindingID int64,
		actor string,
	) (*integrationdto.DeleteBindingResponse, error)

	StartAzureDevOpsPersonal(
		ctx context.Context,
		req *integrationdto.StartAzureDevOpsAuthorizationRequest,
		actor string,
	) (*integrationdto.StartAzureDevOpsAuthorizationResponse, error)

	CompleteAzureDevOpsPersonal(
		ctx context.Context,
		state, code string,
	) (string, error)

	FailAzureDevOpsAuthorization(
		ctx context.Context,
		state, errorCode string,
	) (string, error)

	ListAzureDevOpsConnections(
		ctx context.Context,
		req *integrationdto.ListConnectionsRequest,
		actor string,
	) (*integrationdto.ListConnectionsResponse, error)

	ListAzureDevOpsCandidates(
		ctx context.Context,
		req *integrationdto.ListAzureDevOpsCandidatesRequest,
		actor string,
	) (*integrationdto.ListAzureDevOpsCandidatesResponse, error)

	ListAzureDevOpsProjectConnections(
		ctx context.Context,
		req *integrationdto.ListAzureDevOpsProjectConnectionsRequest,
		actor string,
	) (*integrationdto.ListAzureDevOpsProjectConnectionsResponse, error)

	QueryAzureDevOpsContent(
		ctx context.Context,
		req *integrationdto.QueryAzureDevOpsContentRequest,
		actor string,
	) (*integrationdto.QueryAzureDevOpsContentResponse, error)

	ListAzureDevOpsExportFields(
		ctx context.Context,
		req *integrationdto.ListAzureDevOpsExportFieldsRequest,
		actor string,
	) (*integrationdto.ListAzureDevOpsExportFieldsResponse, error)

	ExportAzureDevOpsQuery(
		ctx context.Context,
		req *integrationdto.ExportAzureDevOpsQueryRequest,
		actor string,
	) (*azuredevops.QueryExport, error)

	ImportAzureDevOpsKnowledge(
		ctx context.Context,
		req *integrationdto.ImportAzureDevOpsKnowledgeRequest,
		actor string,
	) (*integrationdto.ImportAzureDevOpsKnowledgeResponse, error)
}
