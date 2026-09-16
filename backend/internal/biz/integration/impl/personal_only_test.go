package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

func TestConnectionsRejectNonPersonalModes(t *testing.T) {
	repository := &fakeIntegrationRepository{connections: make(map[string]*integrationrepo.ConnectionModel)}
	service := newTestService(repository, nil)
	for _, mode := range []integrationdto.ConnectionMode{0, 2, 99} {
		_, err := service.CreateConnection(context.Background(), &integrationdto.CreateConnectionRequest{
			OrganizationId: 42, Provider: azuredevops.ProviderKey, Mode: mode,
		}, "alice")
		requireAppErrorCode(t, err, errcode.CommonInvalidParam)
		_, err = service.ListConnections(context.Background(), &integrationdto.ListConnectionsRequest{
			OrganizationId: 42, Mode: &mode,
		}, "alice")
		requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	}
	require.Empty(t, repository.connections)
}

func TestAzurePersonalWorkflowsRejectInvalidConnection(t *testing.T) {
	for _, test := range []struct {
		name     string
		mode     int32
		provider string
		actor    string
		code     int32
	}{
		{
			name:     "unspecified mode",
			mode:     0,
			provider: azuredevops.ProviderKey,
			actor:    "admin",
			code:     errcode.CommonInvalidParam,
		},
		{
			name:     "organization mode",
			mode:     2,
			provider: azuredevops.ProviderKey,
			actor:    "admin",
			code:     errcode.CommonInvalidParam,
		},
		{
			name:     "other provider",
			mode:     1,
			provider: "source_control",
			actor:    "admin",
			code:     errcode.CommonInvalidParam,
		},
		{
			name:     "different owner",
			mode:     1,
			provider: azuredevops.ProviderKey,
			actor:    "bob",
			code:     errcode.CommonForbidden,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			connection := personalConnection("personal", test.provider, 42)
			connection.Mode = test.mode
			connection.ProjectID = 100
			repository := &fakeIntegrationRepository{
				connections: map[string]*integrationrepo.ConnectionModel{connection.ConnectionKey: connection},
			}
			service := newTestServiceWithConnector(repository, map[int64]*projectrepo.ProjectModel{
				100: {ID: 100, OrganizationID: 42},
			}, newAzureTestConnector(t, "https://provider-must-not-be-called.invalid"))

			_, err := service.StartAzureDevOpsPersonal(
				context.Background(),
				&integrationdto.StartAzureDevOpsAuthorizationRequest{
					OrganizationId: 42,
					SicoProjectId:  100,
					ConnectionKey:  &connection.ConnectionKey,
				},
				test.actor,
			)
			requireAppErrorCode(t, err, test.code)
			_, err = service.ListAzureDevOpsCandidates(
				context.Background(),
				&integrationdto.ListAzureDevOpsCandidatesRequest{
					ConnectionKey: connection.ConnectionKey,
				},
				test.actor,
			)
			if test.name == "different owner" {
				requireAppErrorCode(t, err, errcode.CommonConflict)
			} else {
				requireAppErrorCode(t, err, test.code)
			}
			_, err = service.validateCallbackConnection(context.Background(), &azuredevops.OAuthState{
				ConnectionKey: connection.ConnectionKey, OrganizationID: 42, Actor: test.actor,
			})
			requireAppErrorCode(t, err, errcode.CommonForbidden)
			require.Equal(t, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE), connection.Status)
			require.Zero(t, connection.CredentialVersion)
			require.Zero(t, repository.updateCalls)
		})
	}
}
