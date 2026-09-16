package impl

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

func newAllProjectsService(test *testing.T) (*Service, *fakeIntegrationRepository, *atomic.Bool) {
	test.Helper()

	revoked := &atomic.Bool{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		assert.Equal(test, "Bearer full-access-token", request.Header.Get("Authorization"))

		switch request.URL.Path {
		case "/_apis/accounts":
			assert.Equal(test, "profile-id", request.URL.Query().Get("memberId"))
			_, _ = io.WriteString(response, `{"value":[{"accountId":"org-one","accountName":"office"},`+
				`{"accountId":"org-two","accountName":"engineering"}]}`)
		case "/office/_apis/projects", "/engineering/_apis/projects":
			_, _ = io.WriteString(response, `{"value":[{"id":"project-id","name":"Product"}]}`)
		case "/office/_apis/projects/project-id", "/engineering/_apis/projects/project-id":
			if revoked.Load() {
				response.WriteHeader(http.StatusForbidden)
				return
			}

			_, _ = io.WriteString(response, `{"id":"project-id","name":"Product"}`)
		case "/office/project-id/_apis/git/repositories", "/engineering/project-id/_apis/git/repositories":
			_, _ = io.WriteString(response, `{"value":[{"id":"repo-id","name":"Shared repository"}]}`)
		default:
			http.NotFound(response, request)
		}
	}))
	test.Cleanup(server.Close)

	connector := newAzureTestConnector(test, server.URL)
	connection := personalConnection("full-access", azuredevops.ProviderKey, 42)
	connection.ProjectID = 100
	connection.CredentialVersion = 1
	connection.Metadata = encodeAzureMetadata(&azureConnectionMetadata{
		SchemaVersion:  1,
		Stage:          "active",
		ProfileID:      "profile-id",
		ResourceAccess: azureResourceAccessAllProjects,
	})

	encrypted, err := connector.EncryptTokenBundle(1, 1, connection.Mode, &azuredevops.TokenBundle{
		SchemaVersion: 1,
		AccessToken:   "full-access-token",
		ProfileID:     "profile-id",
		Scope:         "vso.work vso.test",
		ExpiresAt:     time.Now().Add(time.Hour).UnixMilli(),
	})
	require.NoError(test, err)

	repository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{connection.ConnectionKey: connection},
		credentials: map[fakeCredentialKey]*integrationrepo.CredentialModel{
			{connectionID: 1, version: 1}: {
				Version:       1,
				Scheme:        encrypted.Scheme,
				KeyID:         encrypted.KeyID,
				EncryptedData: encrypted.Data,
			},
		},
	}
	service := newTestServiceWithConnector(
		repository,
		map[int64]*projectrepo.ProjectModel{
			100: {ID: 100, OrganizationID: 42},
			200: {ID: 200, OrganizationID: 42},
		},
		connector,
	)

	return service, repository, revoked
}

func TestAllProjectsConnectionSharesCurrentResourcesWithoutBindings(test *testing.T) {
	service, repository, _ := newAllProjectsService(test)

	candidates, err := service.ListAzureDevOpsCandidates(
		context.Background(),
		&integrationdto.ListAzureDevOpsCandidatesRequest{ConnectionKey: "full-access"},
		"member",
	)
	require.NoError(test, err)
	require.Len(test, candidates.Data.Organizations, 2)

	connections, err := service.ListAzureDevOpsProjectConnections(
		context.Background(),
		&integrationdto.ListAzureDevOpsProjectConnectionsRequest{
			OrganizationId: 42,
			SicoProjectId:  100,
		},
		"member",
	)
	require.NoError(test, err)
	require.Len(test, connections.Data.Connections, 1)

	for _, organization := range candidates.Data.Organizations {
		sources, err := service.ListAzureDevOpsCandidates(
			context.Background(),
			&integrationdto.ListAzureDevOpsCandidatesRequest{
				ConnectionKey:          "full-access",
				ExternalOrganizationId: organization.Id,
			},
			"member",
		)
		require.NoError(test, err)
		require.Len(test, sources.Data.Organizations, 1)
		require.Len(test, sources.Data.Organizations[0].Projects, 1)

		for _, project := range sources.Data.Organizations[0].Projects {
			request := &integrationdto.QueryAzureDevOpsContentRequest{
				ConnectionKey: "full-access",
				SicoProjectId: 100,
				ResourceKey:   project.ResourceKey,
				Kind:          azuredevops.ContentKindRepositories,
			}
			content, queryErr := service.QueryAzureDevOpsContent(context.Background(), request, "member")
			require.NoError(test, queryErr)
			require.Len(test, content.Data.Items, 1)
			assert.Equal(test, project.ResourceKey, content.Data.ResourceKey)
		}
	}

	assert.Empty(test, repository.activatedBindings)
	assert.Nil(test, repository.createdBinding)
}

func TestAllProjectsAccessRejectsUnavailableAndCrossProjectResources(test *testing.T) {
	service, _, revoked := newAllProjectsService(test)
	request := &integrationdto.QueryAzureDevOpsContentRequest{
		ConnectionKey: "full-access",
		SicoProjectId: 200,
		ResourceKey:   "org-one/project-id",
		Kind:          azuredevops.ContentKindRepositories,
	}

	_, err := service.QueryAzureDevOpsContent(context.Background(), request, "member")
	requireAppErrorCode(test, err, errcode.CommonForbidden)

	request.SicoProjectId = 100
	for _, resourceKey := range []string{"", "org-one", "org-one/", "org-one/project-id/extra", "other-org/project-id"} {
		request.ResourceKey = resourceKey
		_, err = service.QueryAzureDevOpsContent(context.Background(), request, "member")
		requireAppErrorCode(test, err, errcode.CommonInvalidParam)
	}

	request.ResourceKey = "org-one/project-id"
	revoked.Store(true)
	_, err = service.QueryAzureDevOpsContent(context.Background(), request, "member")
	require.Error(test, err)

	revoked.Store(false)
	service.Access = forbiddenIntegrationAccess{}
	_, err = service.QueryAzureDevOpsContent(context.Background(), request, "outsider")
	requireAppErrorCode(test, err, errcode.CommonForbidden)
	_, err = service.ListAzureDevOpsCandidates(
		context.Background(),
		&integrationdto.ListAzureDevOpsCandidatesRequest{ConnectionKey: "full-access"},
		"outsider",
	)
	requireAppErrorCode(test, err, errcode.CommonForbidden)
}

func TestProjectConnectionListDoesNotContactProviderOrRefreshCredentials(test *testing.T) {
	service, repository, _ := newAllProjectsService(test)

	connection := *repository.connections["full-access"]
	connection.ID, connection.ConnectionKey = 2, "needs-reauthorization"
	connection.Status = int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_REAUTHORIZATION_REQUIRED)
	repository.connections[connection.ConnectionKey] = &connection
	service.AzureDevOps = newAzureTestConnector(test, "https://provider-must-not-be-called.invalid")
	service.IntegrationRepo = &connectionListOnlyRepository{IntegrationRepository: repository}

	response, err := service.ListAzureDevOpsProjectConnections(
		context.Background(),
		&integrationdto.ListAzureDevOpsProjectConnectionsRequest{
			OrganizationId: 42,
			SicoProjectId:  100,
		},
		"member",
	)
	require.NoError(test, err)
	require.Len(test, response.Data.Connections, 2)
	assert.Equal(test, int64(2), response.Data.Total)
	assert.False(test, response.Data.HasNext)
	assert.ElementsMatch(test, []integrationdto.ConnectionStatus{4, 5}, []integrationdto.ConnectionStatus{
		response.Data.Connections[0].Status,
		response.Data.Connections[1].Status,
	})
}

type connectionListOnlyRepository struct {
	integrationrepo.IntegrationRepository
}

func (*connectionListOnlyRepository) GetCredentialVersion(
	context.Context,
	int64,
	int64,
) (*integrationrepo.CredentialModel, error) {
	panic("listing connections must not read or refresh credentials")
}

func TestAzureDevOpsRejectsResourceBindingAPIs(test *testing.T) {
	service, repository, _ := newAllProjectsService(test)
	ctx := context.Background()

	_, err := service.CreateBinding(
		ctx,
		"full-access",
		&integrationdto.CreateBindingRequest{
			SicoScopeType: 2,
			SicoScopeId:   "100",
			ResourceType:  "project",
			ResourceKey:   "org-one/project-id",
			ResourceName:  "office/Product",
		},
		"admin",
	)
	requireAppErrorCode(test, err, errcode.CommonInvalidParam)

	_, err = service.GetBinding(ctx, "full-access", 1, "admin")
	requireAppErrorCode(test, err, errcode.CommonInvalidParam)

	_, err = service.ListBindings(ctx, "full-access", &integrationdto.ListBindingsRequest{}, "admin")
	requireAppErrorCode(test, err, errcode.CommonInvalidParam)

	_, err = service.UpdateBinding(ctx, "full-access", 1, &integrationdto.UpdateBindingRequest{}, "admin")
	requireAppErrorCode(test, err, errcode.CommonInvalidParam)

	_, err = service.DeleteBinding(ctx, "full-access", 1, "admin")
	requireAppErrorCode(test, err, errcode.CommonInvalidParam)

	assert.Empty(test, repository.activatedBindings)
	assert.Nil(test, repository.createdBinding)
}

func TestAllProjectsKnowledgeImportKeepsSourceAndDestinationSeparate(test *testing.T) {
	service, repository, _ := newAllProjectsService(test)
	exporter := &allProjectsExporter{AzureDevOpsConnector: service.AzureDevOps}
	service.AzureDevOps = exporter
	assets, documents := &exportProjectService{}, &exportKnowledgeService{}
	service.ProjectService, service.KnowledgeService = assets, documents
	service.Cache = redis.NewClient(&redis.Options{Addr: miniredis.RunT(test).Addr()})
	test.Cleanup(func() { _ = service.Cache.Close() })

	request := &integrationdto.ImportAzureDevOpsKnowledgeRequest{
		Export: &integrationdto.ExportAzureDevOpsQueryRequest{
			ConnectionKey: "full-access",
			SicoProjectId: 100,
			ResourceKey:   "org-two/project-id",
			QueryId:       "query-id",
			ColumnOptions: []string{"System.Id", "System.WorkItemType", "System.Title"},
		},
		Name:            "Product snapshot",
		ConfirmSnapshot: true,
		RequestId:       "11111111-1111-4111-8111-111111111111",
	}

	response, err := service.ImportAzureDevOpsKnowledge(context.Background(), request, "member")
	require.NoError(test, err)

	assert.Equal(test, "9", response.Data.DocumentId)
	assert.Equal(test, "engineering", exporter.organizationName)
	assert.Equal(test, "project-id", exporter.projectID)
	assert.Equal(test, "query-id", exporter.queryID)
	assert.Equal(test, []string{"System.Id", "System.WorkItemType", "System.Title"}, exporter.options.ColumnOptions)
	assert.Equal(test, "100", assets.request.ProjectId)
	assert.Equal(test, int64(100), documents.request.ProjectId)
	assert.Equal(test, []byte("XLSX fixture"), assets.content)
	assert.Empty(test, repository.activatedBindings)
}

type allProjectsExporter struct {
	AzureDevOpsConnector
	organizationName string
	projectID        string
	queryID          string
	options          azuredevops.ExportOptions
}

func (exporter *allProjectsExporter) ExportSavedQueryFile(
	_ context.Context,
	_ string,
	project azuredevops.ResolvedProject,
	queryID string,
	options azuredevops.ExportOptions,
) (*azuredevops.QueryExport, error) {
	exporter.organizationName, exporter.projectID, exporter.queryID = project.OrganizationName, project.ID, queryID
	exporter.options = options

	return &azuredevops.QueryExport{
		Content:      []byte("XLSX fixture"),
		FileName:     "query.xlsx",
		FileExt:      "xlsx",
		ContentType:  azuredevops.XLSXContentType,
		Count:        1,
		QueryID:      queryID,
		ExportSource: azuredevops.ExportSourceWorkItems,
	}, nil
}

type forbiddenIntegrationAccess struct{ allowTestAccess }

func (forbiddenIntegrationAccess) Require(
	context.Context,
	rbac.Scope,
	rbac.Permission,
) error {
	return apperr.New(errcode.CommonForbidden, "project use denied")
}
