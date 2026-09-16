package impl

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

func TestPersonalAuthorizationRejectsSupersededCallback(t *testing.T) {
	for _, failure := range []bool{false, true} {
		name := "success callback"
		if failure {
			name = "failure callback"
		}

		t.Run(name, func(t *testing.T) {
			accessToken := unsignedTestJWT(map[string]any{"tid": "22222222-2222-2222-2222-222222222222"})
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(request.URL.Path, "/token") {
					_, _ = io.WriteString(
						response,
						`{"access_token":"`+accessToken+`","refresh_token":"refresh","expires_in":3600}`,
					)
				} else {
					_, _ = io.WriteString(response, `{"id":"personal-profile"}`)
				}
			}))
			defer server.Close()

			repository := &fakeIntegrationRepository{
				connections: make(map[string]*integrationrepo.ConnectionModel),
				credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
			}
			service := newTestServiceWithConnector(
				repository,
				map[int64]*projectrepo.ProjectModel{
					100: {ID: 100, OrganizationID: 42},
				},
				newAzureTestConnector(t, server.URL),
			)

			request := &integrationdto.StartAzureDevOpsAuthorizationRequest{OrganizationId: 42, SicoProjectId: 100}
			first, err := service.StartAzureDevOpsPersonal(context.Background(), request, "alice")
			require.NoError(t, err)

			request.ConnectionKey = &first.Data.ConnectionKey
			second, err := service.StartAzureDevOpsPersonal(context.Background(), request, "alice")
			require.NoError(t, err)

			connection := repository.connections[first.Data.ConnectionKey]
			currentMetadata := string(connection.Metadata)

			if failure {
				_, err = service.FailAzureDevOpsAuthorization(
					context.Background(),
					authorizationState(t, first),
					"access_denied",
				)
			} else {
				_, err = service.CompleteAzureDevOpsPersonal(
					context.Background(),
					authorizationState(t, first),
					"code",
				)
			}
			requireAppErrorCode(t, err, errcode.CommonConflict)
			require.JSONEq(t, currentMetadata, string(connection.Metadata))
			require.Empty(t, repository.credentials)

			_, err = service.CompleteAzureDevOpsPersonal(context.Background(), authorizationState(t, second), "code")
			require.NoError(t, err)
			require.Equal(t, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE), connection.Status)
			require.Len(t, repository.credentials, 1)

			metadata, err := decodeAzureMetadata(connection.Metadata)
			require.NoError(t, err)
			require.Equal(t, "authorized", metadata.Operation.Result)
			require.Empty(t, metadata.Operation.Kind)

			cancelled, err := service.StartAzureDevOpsPersonal(context.Background(), request, "alice")
			require.NoError(t, err)

			_, err = service.FailAzureDevOpsAuthorization(
				context.Background(),
				authorizationState(t, cancelled),
				"access_denied",
			)
			require.NoError(t, err)
			require.Equal(t, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE), connection.Status)
			require.Len(t, repository.credentials, 1)

			metadata, err = decodeAzureMetadata(connection.Metadata)
			require.NoError(t, err)
			require.Equal(t, "failed", metadata.Operation.Result)
			require.Empty(t, metadata.Operation.Kind)
			require.Zero(t, metadata.Operation.ExpiresAt)

			_, err = service.FailAzureDevOpsAuthorization(
				context.Background(),
				authorizationState(t, cancelled),
				"access_denied",
			)
			requireAppErrorCode(t, err, errcode.IntegrationOAuthStateInvalid)
		})
	}
}

func TestPersonalTokenExchangeFailureEndsOnlyCurrentOperation(test *testing.T) {
	for _, active := range []bool{false, true} {
		service, repository, _ := newAllProjectsService(test)
		connection := repository.connections["full-access"]
		if !active {
			connection.Status = int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_DRAFT)
			connection.CredentialVersion = 0
			clear(repository.credentials)
		}

		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(response, `{"error":"invalid_grant"}`)
		}))
		service.AzureDevOps = newAzureTestConnector(test, server.URL)

		request := &integrationdto.StartAzureDevOpsAuthorizationRequest{
			OrganizationId: 42,
			SicoProjectId:  100,
			ConnectionKey:  stringPointer("full-access"),
		}
		start, err := service.StartAzureDevOpsPersonal(context.Background(), request, "admin")
		require.NoError(test, err)

		state := authorizationState(test, start)
		redirect, err := service.CompleteAzureDevOpsPersonal(context.Background(), state, "code")
		require.Error(test, err)
		require.Contains(test, redirect, "status=failed")

		metadata, err := decodeAzureMetadata(connection.Metadata)
		require.NoError(test, err)
		require.Equal(test, start.Data.OperationId, metadata.Operation.ID)
		require.Equal(test, "failed", metadata.Operation.Result)
		require.Empty(test, metadata.Operation.Kind)

		if active {
			require.Equal(test, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE), connection.Status)
			require.Equal(test, int64(1), connection.CredentialVersion)
			require.Len(test, repository.credentials, 1)
		} else {
			require.Equal(test, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_FAILED), connection.Status)
			require.Empty(test, repository.credentials)
		}

		server.Close()
	}
}

func authorizationState(t *testing.T, start *integrationdto.StartAzureDevOpsAuthorizationResponse) string {
	t.Helper()
	authorizationURL, err := url.Parse(start.Data.AuthorizationUrl)
	require.NoError(t, err)
	return authorizationURL.Query().Get("state")
}
