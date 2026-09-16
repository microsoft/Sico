package impl

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

func TestPersonalConnectionRequiresProjectOwnership(t *testing.T) {
	repository := &fakeIntegrationRepository{connections: make(map[string]*integrationrepo.ConnectionModel)}
	service := newTestService(repository, map[int64]*projectrepo.ProjectModel{
		100: {ID: 100, OrganizationID: 42},
	})
	_, err := service.CreateConnection(context.Background(), &integrationdto.CreateConnectionRequest{
		OrganizationId: 42,
		Provider:       azuredevops.ProviderKey,
		Mode:           integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL,
	}, "alice")
	requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	require.Empty(t, repository.connections)
}

func TestPersonalConnectionsAreIndependentAcrossProjects(t *testing.T) {
	accessToken := unsignedTestJWT(map[string]any{"tid": "22222222-2222-2222-2222-222222222222"})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(request.URL.Path, "/token") {
			_, _ = io.WriteString(response,
				`{"access_token":"`+accessToken+`","refresh_token":"refresh","expires_in":3600}`,
			)
		} else {
			_, _ = io.WriteString(response, `{"id":"same-account"}`)
		}
	}))
	defer server.Close()
	repository := &fakeIntegrationRepository{
		connections: make(map[string]*integrationrepo.ConnectionModel),
		credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
	}
	service := newTestServiceWithConnector(repository, map[int64]*projectrepo.ProjectModel{
		100: {ID: 100, OrganizationID: 42},
		200: {ID: 200, OrganizationID: 42},
	}, newAzureTestConnector(t, server.URL))
	authorize := func(projectID int64) (string, error) {
		request := &integrationdto.StartAzureDevOpsAuthorizationRequest{
			OrganizationId: 42, SicoProjectId: projectID,
		}
		start, err := service.StartAzureDevOpsPersonal(context.Background(), request, "alice")
		require.NoError(t, err)
		_, err = service.CompleteAzureDevOpsPersonal(context.Background(), authorizationState(t, start), "code")
		return start.Data.ConnectionKey, err
	}
	first, err := authorize(100)
	require.NoError(t, err)
	second, err := authorize(200)
	require.NoError(t, err)
	assert.NotEqual(t, first, second)
	assert.Equal(t, int64(100), repository.connections[first].ProjectID)
	assert.Equal(t, int64(200), repository.connections[second].ProjectID)
	assert.Len(t, repository.credentials, 2)
	duplicate, err := authorize(100)
	requireAppErrorCode(t, err, errcode.CommonConflict)
	assert.Contains(t, err.Error(), "already connected in this project")
	assert.Zero(t, repository.connections[duplicate].CredentialVersion)
	assert.Equal(t, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_FAILED), repository.connections[duplicate].Status)
	assert.Len(t, repository.credentials, 2)
	_, err = service.StartAzureDevOpsPersonal(context.Background(), &integrationdto.StartAzureDevOpsAuthorizationRequest{
		OrganizationId: 42, SicoProjectId: 200, ConnectionKey: &first,
	}, "alice")
	requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	_, err = service.DeleteConnection(context.Background(), first, "alice")
	require.NoError(t, err)
	assert.NotContains(t, repository.connections, first)
	assert.Contains(t, repository.connections, second)
	assert.Len(t, repository.credentials, 1)
}

func TestExpiredCredentialSnapshotUsesSuccessfulConcurrentRefresh(t *testing.T) {
	connection := &integrationrepo.ConnectionModel{
		ID: 1, ConnectionKey: "personal", OrganizationID: 42, ProjectID: 100,
		Provider: azuredevops.ProviderKey, Mode: 1, Status: 4, OwnerUsername: "alice",
	}
	repository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{"personal": connection},
		credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
	}
	service := newTestServiceWithConnector(repository, nil, newAzureTestConnector(t, "https://unused.invalid"))
	require.NoError(t, service.saveAzureCredential(context.Background(), connection, &azuredevops.TokenBundle{
		SchemaVersion: 1, AccessToken: "expired-token", ExpiresAt: time.Now().Add(-time.Minute).UnixMilli(),
	}, nil, "alice", map[string]any{}))
	stale, err := repository.GetConnectionByKey(context.Background(), "personal")
	require.NoError(t, err)
	require.NoError(t, service.saveAzureCredential(context.Background(), connection, &azuredevops.TokenBundle{
		SchemaVersion: 1, AccessToken: "new-token", RefreshToken: "rotated-token",
		ExpiresAt: time.Now().Add(time.Hour).UnixMilli(),
	}, nil, "alice", map[string]any{}))

	bundle, err := service.azureDelegatedBundle(context.Background(), stale, "alice")

	require.NoError(t, err)
	assert.Equal(t, "new-token", bundle.AccessToken)
	assert.Equal(t, int32(4), connection.Status)
	assert.Equal(t, int64(2), connection.CredentialVersion)
}
