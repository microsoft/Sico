package impl

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationrepo "sico-backend/internal/store/integration/repository"
	organizationrepo "sico-backend/internal/store/organization/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
	"sico-backend/internal/transport/http/middleware"
)

type fakeIntegrationRepository struct {
	integrationrepo.IntegrationRepository
	connections       map[string]*integrationrepo.ConnectionModel
	createdBinding    *integrationrepo.BindingModel
	nextID            int64
	updateCalls       int
	credentials       map[fakeCredentialKey]*integrationrepo.CredentialModel
	activatedBindings []*integrationrepo.BindingModel
	deleteError       error
	metadataErrors    map[string]error
}

type fakeCredentialKey struct {
	connectionID int64
	version      int64
}

func (repository *fakeIntegrationRepository) CreateConnection(
	_ context.Context, connection *integrationrepo.ConnectionModel,
) error {
	repository.nextID++
	connection.ID = repository.nextID
	repository.connections[connection.ConnectionKey] = connection
	return nil
}

func (repository *fakeIntegrationRepository) GetConnectionByKey(
	_ context.Context, connectionKey string,
) (*integrationrepo.ConnectionModel, error) {
	connection := repository.connections[connectionKey]
	if connection == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return connectionSnapshot(connection), nil
}

func connectionSnapshot(connection *integrationrepo.ConnectionModel) *integrationrepo.ConnectionModel {
	snapshot := *connection
	snapshot.Metadata = append(datatypes.JSON(nil), connection.Metadata...)
	return &snapshot
}

func (repository *fakeIntegrationRepository) ListConnections(
	_ context.Context,
	filter *integrationrepo.ConnectionFilter,
	offset, limit int,
) ([]*integrationrepo.ConnectionModel, int64, error) {
	result := make([]*integrationrepo.ConnectionModel, 0)
	for _, connection := range repository.connections {
		if filter != nil {
			if connection.OrganizationID != filter.OrganizationID {
				continue
			}
			if filter.Provider != nil && connection.Provider != *filter.Provider {
				continue
			}
			if filter.Mode != nil && connection.Mode != *filter.Mode {
				continue
			}
			if filter.Status != nil && connection.Status != *filter.Status {
				continue
			}
			if connection.ProjectID != filter.ProjectID {
				continue
			}
			if filter.ProjectID == 0 && connection.Mode == int32(
				integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL,
			) && connection.OwnerUsername != filter.VisibleOwnerUsername {
				continue
			}
			search := strings.ToLower(filter.Search)
			if search != "" && !strings.Contains(strings.ToLower(connection.DisplayName), search) &&
				!strings.Contains(strings.ToLower(connection.OwnerUsername), search) {
				continue
			}
		}
		result = append(result, connectionSnapshot(connection))
	}
	total := int64(len(result))
	if offset >= len(result) {
		return []*integrationrepo.ConnectionModel{}, total, nil
	}
	result = result[offset:]
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, total, nil
}

func (repository *fakeIntegrationRepository) CreateOrReactivateBinding(
	_ context.Context,
	_ *integrationrepo.ConnectionModel,
	binding *integrationrepo.BindingModel,
) error {
	repository.nextID++
	binding.ID = repository.nextID
	repository.createdBinding = binding
	return nil
}

func (repository *fakeIntegrationRepository) ListBindings(
	_ context.Context,
	connectionID int64,
	filter *integrationrepo.BindingFilter,
	offset, limit int,
) ([]*integrationrepo.BindingModel, int64, error) {
	result := make([]*integrationrepo.BindingModel, 0)
	for _, binding := range repository.activatedBindings {
		if binding.ConnectionID != connectionID {
			continue
		}
		if filter != nil {
			if filter.Status != nil && binding.Status != *filter.Status {
				continue
			}
			if filter.ScopeType != nil && binding.SicoScopeType != *filter.ScopeType {
				continue
			}
			if filter.ScopeID != nil && binding.SicoScopeID != *filter.ScopeID {
				continue
			}
		}
		result = append(result, binding)
	}
	total := int64(len(result))
	if offset >= len(result) {
		return []*integrationrepo.BindingModel{}, total, nil
	}
	result = result[offset:]
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, total, nil
}

func (repository *fakeIntegrationRepository) GetBinding(
	_ context.Context, connectionID, bindingID int64,
) (*integrationrepo.BindingModel, error) {
	for _, binding := range repository.activatedBindings {
		if binding.ConnectionID == connectionID && binding.ID == bindingID {
			return binding, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func (repository *fakeIntegrationRepository) DeleteBinding(
	_ context.Context, connectionID, bindingID int64,
) error {
	for index, binding := range repository.activatedBindings {
		if binding.ConnectionID == connectionID && binding.ID == bindingID {
			repository.activatedBindings = append(
				repository.activatedBindings[:index],
				repository.activatedBindings[index+1:]...,
			)
			return nil
		}
	}
	return gorm.ErrRecordNotFound
}

func (repository *fakeIntegrationRepository) UpdateConnectionFields(
	_ context.Context, connectionID int64, fields map[string]any,
) error {
	repository.updateCalls++
	connection := repository.connectionByID(connectionID)
	if connection == nil {
		return gorm.ErrRecordNotFound
	}
	applyConnectionFields(connection, fields)
	return nil
}

func (repository *fakeIntegrationRepository) UpdateConnectionState(
	_ context.Context, expected *integrationrepo.ConnectionModel, fields map[string]any,
) error {
	connection := repository.connectionByID(expected.ID)
	if connection == nil || connection.Status != expected.Status || string(connection.Metadata) != string(expected.Metadata) {
		return integrationrepo.ErrConnectionStateConflict
	}
	if encoded, ok := fields["metadata"].(datatypes.JSON); ok {
		metadata, err := decodeAzureMetadata(encoded)
		if err != nil {
			return err
		}
		if err := repository.metadataErrors[metadata.Stage]; err != nil {
			return err
		}
	}
	applyConnectionFields(connection, fields)
	connection.UpdatedAt = time.Now().UnixMilli()
	return nil
}

func (repository *fakeIntegrationRepository) MarkConnectionReauthorizationRequired(
	_ context.Context,
	connectionID int64,
	expectedStatus int32,
	expectedCredentialVersion int64,
	updaterUsername string,
) error {
	connection := repository.connectionByID(connectionID)
	if connection == nil {
		return gorm.ErrRecordNotFound
	}
	if connection.Status != expectedStatus || connection.CredentialVersion != expectedCredentialVersion {
		return integrationrepo.ErrConnectionStateConflict
	}
	connection.Status = int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_REAUTHORIZATION_REQUIRED)
	connection.UpdaterUsername = updaterUsername
	return nil
}

func (repository *fakeIntegrationRepository) DeleteConnection(
	_ context.Context, expected *integrationrepo.ConnectionModel, _ string,
) error {
	if repository.deleteError != nil {
		return repository.deleteError
	}
	connectionID := expected.ID
	for connectionKey, connection := range repository.connections {
		if connection.ID != connectionID {
			continue
		}
		if connection.Status != expected.Status || string(connection.Metadata) != string(expected.Metadata) {
			return integrationrepo.ErrConnectionStateConflict
		}
		delete(repository.connections, connectionKey)
		for key := range repository.credentials {
			if key.connectionID == connectionID {
				delete(repository.credentials, key)
			}
		}
		remaining := repository.activatedBindings[:0]
		for _, binding := range repository.activatedBindings {
			if binding.ConnectionID != connectionID {
				remaining = append(remaining, binding)
			}
		}
		repository.activatedBindings = remaining
		return nil
	}
	return gorm.ErrRecordNotFound
}

func (repository *fakeIntegrationRepository) GetCredentialVersion(
	_ context.Context, connectionID, version int64,
) (*integrationrepo.CredentialModel, error) {
	credential := repository.credentials[fakeCredentialKey{connectionID: connectionID, version: version}]
	if credential == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return credential, nil
}

func (repository *fakeIntegrationRepository) SaveCredentialVersion(
	_ context.Context,
	expected *integrationrepo.ConnectionModel,
	credential *integrationrepo.CredentialModel,
	connectionFields map[string]any,
) error {
	connectionID := expected.ID
	connection := repository.connectionByID(connectionID)
	if connection == nil {
		return gorm.ErrRecordNotFound
	}
	if connection.CredentialVersion != expected.CredentialVersion || connection.Status != expected.Status {
		return integrationrepo.ErrCredentialVersionConflict
	}
	_, changesMetadata := connectionFields["metadata"]
	if changesMetadata && string(connection.Metadata) != string(expected.Metadata) {
		return integrationrepo.ErrCredentialVersionConflict
	}
	if changesMetadata && isPersonalAzureConnection(connection) {
		next, err := decodeAzureMetadata(connectionFields["metadata"].(datatypes.JSON))
		if err != nil {
			return err
		}
		for _, other := range repository.connections {
			if other.ID == connection.ID || !isPersonalAzureConnection(other) ||
				other.ProjectID != connection.ProjectID ||
				other.OwnerUsername != connection.OwnerUsername {
				continue
			}
			existing, err := decodeAzureMetadata(other.Metadata)
			if err != nil {
				return err
			}
			if next.ProfileID != "" && strings.EqualFold(next.ProfileID, existing.ProfileID) &&
				strings.EqualFold(next.TargetTenantID, existing.TargetTenantID) {
				return gorm.ErrDuplicatedKey
			}
		}
	}
	credential.ConnectionID = connectionID
	repository.credentials[fakeCredentialKey{connectionID: connectionID, version: credential.Version}] = credential
	for key := range repository.credentials {
		if key.connectionID == connectionID && key.version <= credential.Version-3 {
			delete(repository.credentials, key)
		}
	}
	connection.CredentialVersion = credential.Version
	applyConnectionFields(connection, connectionFields)
	return nil
}

func (repository *fakeIntegrationRepository) connectionByID(connectionID int64) *integrationrepo.ConnectionModel {
	for _, connection := range repository.connections {
		if connection.ID == connectionID {
			return connection
		}
	}
	return nil
}

func applyConnectionFields(connection *integrationrepo.ConnectionModel, fields map[string]any) {
	if value, ok := fields["display_name"].(string); ok {
		connection.DisplayName = value
	}
	if value, ok := fields["status"].(int32); ok {
		connection.Status = value
	}
	if value, ok := fields["external_id"].(string); ok {
		connection.ExternalID = value
	}
	if value, ok := fields["metadata"].(datatypes.JSON); ok {
		connection.Metadata = value
	}
	if value, ok := fields["updater_username"].(string); ok {
		connection.UpdaterUsername = value
	}
}

type fakeOrganizationRepository struct {
	organizationrepo.OrganizationRepository
	organizations map[int64]*organizationrepo.OrganizationModel
}

func (repository *fakeOrganizationRepository) GetByID(
	_ context.Context, organizationID int64,
) (*organizationrepo.OrganizationModel, error) {
	organization := repository.organizations[organizationID]
	if organization == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return organization, nil
}

type fakeProjectRepository struct {
	projectrepo.ProjectRepository
	projects map[int64]*projectrepo.ProjectModel
}

func (repository *fakeProjectRepository) GetProjectByID(
	_ context.Context, projectID int64,
) (*projectrepo.ProjectModel, error) {
	project := repository.projects[projectID]
	if project == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return project, nil
}

func TestCreateConnectionSetsPersonalOwnerAndServerFields(t *testing.T) {
	integrationRepository := &fakeIntegrationRepository{
		connections: make(map[string]*integrationrepo.ConnectionModel),
	}
	service := newTestService(integrationRepository, nil)

	response, err := service.CreateConnection(context.Background(), &integrationdto.CreateConnectionRequest{
		OrganizationId: 42,
		Provider:       "source_control",
		Mode:           integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL,
		DisplayName:    "My source control",
	}, "alice")

	require.NoError(t, err)
	require.NotNil(t, response.Data)
	assert.NotEmpty(t, response.Data.ConnectionKey)
	assert.Equal(t, "alice", response.Data.OwnerUsername)
	assert.Equal(t, integrationdto.ConnectionStatus_CONNECTION_STATUS_DRAFT, response.Data.Status)
	stored := integrationRepository.connections[response.Data.ConnectionKey]
	require.NotNil(t, stored)
	assert.Zero(t, stored.CredentialVersion)
}

func TestPersonalConnectionRejectsDifferentUser(t *testing.T) {
	integrationRepository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{
			"personal": {
				ID:             1,
				ConnectionKey:  "personal",
				OrganizationID: 42,
				OwnerUsername:  "alice",
				Mode:           int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
			},
		},
	}
	service := newTestService(integrationRepository, nil)

	_, err := service.GetConnection(context.Background(), "personal", "bob")

	requireAppErrorCode(t, err, errcode.CommonForbidden)
}

func TestAzureDevOpsWorkflowsUnavailableWhenConnectorDisabled(t *testing.T) {
	integrationRepository := &fakeIntegrationRepository{
		connections: make(map[string]*integrationrepo.ConnectionModel),
	}
	service := newTestService(integrationRepository, nil)

	_, err := service.StartAzureDevOpsPersonal(
		context.Background(),
		&integrationdto.StartAzureDevOpsAuthorizationRequest{OrganizationId: 42},
		"alice",
	)
	requireAppErrorCode(t, err, errcode.IntegrationConnectorUnavailable)
	_, err = service.ListAzureDevOpsConnections(
		context.Background(),
		&integrationdto.ListConnectionsRequest{OrganizationId: 42},
		"alice",
	)
	requireAppErrorCode(t, err, errcode.IntegrationConnectorUnavailable)
	_, err = service.ListAzureDevOpsCandidates(
		context.Background(),
		&integrationdto.ListAzureDevOpsCandidatesRequest{ConnectionKey: "missing"},
		"alice",
	)
	requireAppErrorCode(t, err, errcode.IntegrationConnectorUnavailable)

	checks := []struct {
		name string
		run  func() error
	}{
		{
			name: "complete personal callback",
			run: func() error {
				_, callbackErr := service.CompleteAzureDevOpsPersonal(context.Background(), "state", "code")
				return callbackErr
			},
		},
		{
			name: "fail authorization callback",
			run: func() error {
				_, callbackErr := service.FailAzureDevOpsAuthorization(
					context.Background(),
					"state",
					"access_denied",
				)
				return callbackErr
			},
		},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			requireAppErrorCode(t, check.run(), errcode.IntegrationConnectorUnavailable)
		})
	}
	assert.Empty(t, integrationRepository.connections)
	assert.Zero(t, integrationRepository.updateCalls)
}

func TestAzureDevOpsFailureCallbackRejectsWrongFlow(t *testing.T) {
	connection := personalConnection("personal", azuredevops.ProviderKey, 42)
	connection.Status = int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_PENDING_AUTHORIZATION)
	integrationRepository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{"personal": connection},
		credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
	}
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	cipher, err := azuredevops.NewAESGCMCipher(key, "test-key")
	require.NoError(t, err)
	states := azuredevops.NewMemoryStateStore(cipher, time.Minute)
	state, err := states.Create(context.Background(), &azuredevops.OAuthState{
		Flow: "organization", ConnectionKey: connection.ConnectionKey,
		OrganizationID: connection.OrganizationID, Actor: connection.OwnerUsername,
	})
	require.NoError(t, err)
	connector := azuredevops.NewConnectorWithDependencies(azuredevops.Config{Enabled: true}, nil, states, nil, nil)
	service := newTestServiceWithConnector(integrationRepository, nil, connector)

	_, err = service.FailAzureDevOpsAuthorization(context.Background(), state, "access_denied")

	requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	assert.Equal(t, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_PENDING_AUTHORIZATION), connection.Status)
	assert.Empty(t, integrationRepository.credentials)
	assert.Zero(t, integrationRepository.updateCalls)
	_, err = service.FailAzureDevOpsAuthorization(context.Background(), state, "access_denied")
	requireAppErrorCode(t, err, errcode.IntegrationOAuthStateInvalid)
}

func TestEmptyConnectionUpdateDoesNotWrite(t *testing.T) {
	integrationRepository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{
			"personal": {
				ID:             1,
				ConnectionKey:  "personal",
				OrganizationID: 42,
				OwnerUsername:  "alice",
				Mode:           int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
			},
		},
	}
	service := newTestService(integrationRepository, nil)

	_, err := service.UpdateConnection(
		context.Background(), "personal", &integrationdto.UpdateConnectionRequest{}, "alice",
	)

	require.NoError(t, err)
	assert.Zero(t, integrationRepository.updateCalls)
}

func TestCreateConnectionRejectsInvalidConnectorKey(t *testing.T) {
	integrationRepository := &fakeIntegrationRepository{
		connections: make(map[string]*integrationrepo.ConnectionModel),
	}
	service := newTestService(integrationRepository, nil)

	_, err := service.CreateConnection(context.Background(), &integrationdto.CreateConnectionRequest{
		OrganizationId: 42,
		Provider:       "Invalid Provider",
		Mode:           integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL,
	}, "admin")

	requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	assert.Empty(t, integrationRepository.connections)
}

func TestCreateBindingRejectsProjectFromAnotherOrganization(t *testing.T) {
	integrationRepository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{
			"source": personalConnection("source", "source_control", 42),
		},
	}
	service := newTestService(integrationRepository, map[int64]*projectrepo.ProjectModel{
		7: {ID: 7, OrganizationID: 99},
	})

	_, err := service.CreateBinding(context.Background(), "source", &integrationdto.CreateBindingRequest{
		SicoScopeType: integrationdto.SicoScopeType_SICO_SCOPE_TYPE_PROJECT,
		SicoScopeId:   "7",
		ResourceType:  "repository",
		ResourceKey:   "456",
		ResourceName:  "repository",
	}, "admin")

	requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	assert.Nil(t, integrationRepository.createdBinding)
}

func TestCreateBindingRejectsLegacyOrganizationConnection(t *testing.T) {
	integrationRepository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{
			"source": personalConnection("source", "source_control", 42),
		},
	}
	integrationRepository.connections["source"].Mode = 2
	service := newTestService(integrationRepository, nil)

	_, err := service.CreateBinding(context.Background(), "source", &integrationdto.CreateBindingRequest{
		SicoScopeType: integrationdto.SicoScopeType_SICO_SCOPE_TYPE_ORGANIZATION,
		SicoScopeId:   "42",
		ResourceType:  "repository",
		ResourceKey:   "456",
		ResourceName:  "repository",
	}, "admin")

	requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	assert.Nil(t, integrationRepository.createdBinding)
}

func TestCreateBindingRequiresCanonicalProjectScopeID(t *testing.T) {
	for _, scopeID := range []string{"100", "0100", "+100"} {
		t.Run(scopeID, func(t *testing.T) {
			repository := &fakeIntegrationRepository{
				connections: map[string]*integrationrepo.ConnectionModel{
					"source": personalConnection("source", "source_control", 42),
				},
			}
			service := newTestService(repository, map[int64]*projectrepo.ProjectModel{
				100: {ID: 100, OrganizationID: 42},
			})

			request := &integrationdto.CreateBindingRequest{
				SicoScopeType: integrationdto.SicoScopeType_SICO_SCOPE_TYPE_PROJECT,
				SicoScopeId:   scopeID,
				ResourceType:  "repository",
				ResourceKey:   "repo",
				ResourceName:  "Repository",
			}
			response, err := service.CreateBinding(context.Background(), "source", request, "admin")

			if scopeID != "100" {
				requireAppErrorCode(t, err, errcode.CommonInvalidParam)
				assert.Nil(t, repository.createdBinding)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "100", response.Data.SicoScopeId)
		})
	}
}

func TestProjectAdminCanDeleteSharedPersonalConnection(t *testing.T) {
	model, err := casbinmodel.NewModelFromString(`
[request_definition]
r = sub, dom, obj, act
[policy_definition]
p = sub, dom, obj, act
[role_definition]
g = _, _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub, r.dom) && (r.dom == p.dom || p.dom == "*") && r.obj == p.obj && r.act == p.act
`)
	require.NoError(t, err)
	enforcer, err := casbin.NewEnforcer(model)
	require.NoError(t, err)
	_, err = enforcer.AddPolicy(rbac.RoleProjectAdmin, "*", "integration", "bind")
	require.NoError(t, err)
	_, err = enforcer.AddPolicy(rbac.RoleProjectAdmin, "*", "integration", "use")
	require.NoError(t, err)
	_, err = enforcer.AddPolicy(rbac.RoleProjectMember, "*", "integration", "use")
	require.NoError(t, err)
	for _, grouping := range [][]string{
		{"alice", rbac.RoleProjectMember, "project:100"},
		{"admin-100", rbac.RoleProjectAdmin, "project:100"},
		{"admin-200", rbac.RoleProjectAdmin, "project:200"},
		{"member-100", rbac.RoleProjectMember, "project:100"},
	} {
		_, err = enforcer.AddGroupingPolicy(grouping)
		require.NoError(t, err)
	}
	miniRedis := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, redisClient.Close()) })
	access := rbac.NewAccessServices(nil, nil, enforcer, nil)

	connection := &integrationrepo.ConnectionModel{
		ID:             1,
		ConnectionKey:  "personal",
		OrganizationID: 42,
		ProjectID:      100,
		OwnerUsername:  "alice",
		Provider:       azuredevops.ProviderKey,
		Mode:           int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
		Status:         int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE),
	}
	repository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{"personal": connection},
		credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
	}
	service := newTestServiceWithConnector(repository, map[int64]*projectrepo.ProjectModel{
		100: {ID: 100, OrganizationID: 42},
	}, newAzureTestConnector(t, "https://provider-must-not-be-called.invalid"))
	service.Access = access
	actorContext := func(username string) context.Context {
		return context.WithValue(
			context.Background(),
			middleware.ContextUserKey,
			middleware.UserInfo{Name: username},
		)
	}

	_, err = service.GetConnection(actorContext("member-100"), "personal", "member-100")
	require.NoError(t, err)
	_, err = service.GetConnection(actorContext("admin-200"), "personal", "admin-200")
	requireAppErrorCode(t, err, errcode.CommonForbidden)
	_, err = service.UpdateConnection(
		actorContext("admin-100"), "personal", &integrationdto.UpdateConnectionRequest{}, "admin-100",
	)
	requireAppErrorCode(t, err, errcode.CommonForbidden)
	startRequest := &integrationdto.StartAzureDevOpsAuthorizationRequest{
		OrganizationId: 42, SicoProjectId: 100, ConnectionKey: stringPointer("personal"),
	}
	start, err := service.StartAzureDevOpsPersonal(actorContext("alice"), startRequest, "alice")
	require.NoError(t, err)
	state, err := service.AzureDevOps.ConsumeAuthorizationState(context.Background(), authorizationState(t, start))
	require.NoError(t, err)
	_, err = service.validateCallbackConnection(context.Background(), state)
	require.NoError(t, err)
	_, err = enforcer.RemoveGroupingPolicy("alice", rbac.RoleProjectMember, "project:100")
	require.NoError(t, err)
	_, err = service.validateCallbackConnection(context.Background(), state)
	requireAppErrorCode(t, err, errcode.CommonForbidden)
	_, err = service.DeleteConnection(actorContext("member-100"), "personal", "member-100")
	requireAppErrorCode(t, err, errcode.CommonForbidden)
	_, err = service.DeleteConnection(actorContext("admin-200"), "personal", "admin-200")
	requireAppErrorCode(t, err, errcode.CommonForbidden)
	_, err = service.DeleteConnection(actorContext("admin-100"), "personal", "admin-100")
	require.NoError(t, err)
	assert.Empty(t, repository.connections)
}

func TestAzureDevOpsPersonalAuthorizationAndCandidateDiscovery(t *testing.T) {
	accessToken := unsignedTestJWT(map[string]any{"tid": "22222222-2222-2222-2222-222222222222"})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/organizations/oauth2/v2.0/token":
			require.NoError(t, request.ParseForm())
			assert.Equal(t, "authorization-code", request.Form.Get("code"))
			assert.NotEmpty(t, request.Form.Get("code_verifier"))
			_, _ = io.WriteString(
				response,
				`{"access_token":"`+accessToken+`","refresh_token":"refresh-secret",`+
					`"token_type":"Bearer","expires_in":3600}`,
			)
		case "/_apis/profile/profiles/me":
			assert.Equal(t, "Bearer "+accessToken, request.Header.Get("Authorization"))
			_, _ = io.WriteString(response, `{"id":"profile-id","displayName":"Test User"}`)
		case "/_apis/accounts":
			assert.Equal(t, "profile-id", request.URL.Query().Get("memberId"))
			_, _ = io.WriteString(response, `{"value":[{"accountId":"org-id","accountName":"office"}]}`)
		case "/office/_apis/projects":
			_, _ = io.WriteString(response, `{"value":[{"id":"project-id","name":"OC","state":"wellFormed"}]}`)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	integrationRepository := &fakeIntegrationRepository{
		connections: make(map[string]*integrationrepo.ConnectionModel),
		credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
	}
	connector := newAzureTestConnector(t, server.URL)
	service := newTestServiceWithConnector(integrationRepository, map[int64]*projectrepo.ProjectModel{
		100: {ID: 100, OrganizationID: 42},
	}, connector)

	start, err := service.StartAzureDevOpsPersonal(context.Background(), &integrationdto.StartAzureDevOpsAuthorizationRequest{
		OrganizationId: 42,
		SicoProjectId:  100,
		DisplayName:    stringPointer("Personal ADO"),
	}, "alice")
	require.NoError(t, err)
	authorizationURL, err := url.Parse(start.Data.AuthorizationUrl)
	require.NoError(t, err)
	connectionKey := start.Data.ConnectionKey
	assert.NotEmpty(t, connectionKey)

	redirectURL, err := service.CompleteAzureDevOpsPersonal(
		context.Background(), authorizationURL.Query().Get("state"), "authorization-code",
	)
	require.NoError(t, err)
	assert.Contains(t, redirectURL, "status=authorized")
	connection := integrationRepository.connections[connectionKey]
	assert.Equal(t, int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE), connection.Status)
	assert.Equal(t, int64(1), connection.CredentialVersion)
	metadata, err := decodeAzureMetadata(connection.Metadata)
	require.NoError(t, err)
	assert.Equal(t, azureResourceAccessAllProjects, metadata.ResourceAccess)
	assert.Equal(t, "active", metadata.Stage)
	assert.Empty(t, integrationRepository.activatedBindings)
	credential := integrationRepository.credentials[fakeCredentialKey{connectionID: connection.ID, version: 1}]
	require.NotNil(t, credential)
	assert.NotContains(t, string(credential.EncryptedData), accessToken)
	assert.NotContains(t, string(credential.EncryptedData), "refresh-secret")

	candidates, err := service.ListAzureDevOpsCandidates(
		context.Background(),
		&integrationdto.ListAzureDevOpsCandidatesRequest{ConnectionKey: connectionKey},
		"alice",
	)
	require.NoError(t, err)
	require.Len(t, candidates.Data.Organizations, 1)
	assert.Equal(t, "office", candidates.Data.Organizations[0].Name)
	assert.Empty(t, candidates.Data.Organizations[0].Projects)
	candidates, err = service.ListAzureDevOpsCandidates(context.Background(),
		&integrationdto.ListAzureDevOpsCandidatesRequest{
			ConnectionKey: connectionKey, ExternalOrganizationId: "org-id",
		}, "alice")
	require.NoError(t, err)
	require.Len(t, candidates.Data.Organizations[0].Projects, 1)
	assert.Equal(t, "org-id/project-id", candidates.Data.Organizations[0].Projects[0].ResourceKey)
}

func TestAzureDevOpsPersonalConnectionCannotMoveToAnotherProject(t *testing.T) {
	tenantID := "22222222-2222-2222-2222-222222222222"
	accessToken := unsignedTestJWT(map[string]any{"tid": tenantID})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/organizations/oauth2/v2.0/token":
			_, _ = io.WriteString(response, `{"access_token":"`+accessToken+`","refresh_token":"refresh",`+
				`"token_type":"Bearer","expires_in":3600}`)
		case "/_apis/profile/profiles/me":
			_, _ = io.WriteString(response, `{"id":"profile-id"}`)
		case "/_apis/accounts":
			_, _ = io.WriteString(response, `{"value":[{"accountId":"org-id","accountName":"office"}]}`)
		case "/office/_apis/projects":
			_, _ = io.WriteString(response, `{"value":[{"id":"ado-project","name":"ADO Project"}]}`)
		case "/office/ado-project/_apis/git/repositories":
			_, _ = io.WriteString(response, `{"value":[{"id":"repo-id","name":"Shared Repo"}]}`)
		case "/office/ado-project/_apis/wit/queries":
			_, _ = io.WriteString(response, `{"value":[{"id":"folder-id","name":"Shared Queries","isFolder":true}]}`)
		case "/office/ado-project/_apis/wit/queries/11111111-1111-4111-8111-111111111111":
			_, _ = io.WriteString(response, `{"id":"11111111-1111-4111-8111-111111111111","name":"Saved test cases"}`)
		case "/office/ado-project/_apis/wit/wiql/11111111-1111-4111-8111-111111111111":
			_, _ = io.WriteString(response, `{"queryType":"flat","workItems":[{"id":101}]}`)
		case "/office/_apis/projects/ado-project":
			_, _ = io.WriteString(response, `{"id":"ado-project","name":"ADO Project"}`)
		case "/office/ado-project/_apis/wit/workitems":
			_, _ = io.WriteString(response, `{"value":[{"id":101,`+
				`"fields":{"System.TeamProject":"ADO Project","System.Title":"Test"}}]}`)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	integrationRepository := &fakeIntegrationRepository{
		connections: make(map[string]*integrationrepo.ConnectionModel),
		credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
	}
	projects := map[int64]*projectrepo.ProjectModel{
		100: {ID: 100, OrganizationID: 42},
		200: {ID: 200, OrganizationID: 42},
		300: {ID: 300, OrganizationID: 42},
	}
	service := newTestServiceWithConnector(integrationRepository, projects, newAzureTestConnector(t, server.URL))
	start, err := service.StartAzureDevOpsPersonal(
		context.Background(),
		&integrationdto.StartAzureDevOpsAuthorizationRequest{OrganizationId: 42, SicoProjectId: 100},
		"alice",
	)
	require.NoError(t, err)
	authorizationURL, err := url.Parse(start.Data.AuthorizationUrl)
	require.NoError(t, err)
	_, err = service.CompleteAzureDevOpsPersonal(
		context.Background(), authorizationURL.Query().Get("state"), "authorization-code",
	)
	require.NoError(t, err)
	_, err = service.StartAzureDevOpsPersonal(
		context.Background(),
		&integrationdto.StartAzureDevOpsAuthorizationRequest{
			OrganizationId: 42, SicoProjectId: 300, ConnectionKey: &start.Data.ConnectionKey,
		},
		"alice",
	)
	requireAppErrorCode(t, err, errcode.CommonInvalidParam)

	shared, err := service.ListAzureDevOpsProjectConnections(
		context.Background(),
		&integrationdto.ListAzureDevOpsProjectConnectionsRequest{
			OrganizationId: 42,
			SicoProjectId:  100,
		},
		"bob",
	)
	require.NoError(t, err)
	require.Len(t, shared.Data.Connections, 1)
	assert.Equal(t, "alice", shared.Data.Connections[0].OwnerUsername)
	secondProject, err := service.ListAzureDevOpsProjectConnections(
		context.Background(),
		&integrationdto.ListAzureDevOpsProjectConnectionsRequest{
			OrganizationId: 42,
			SicoProjectId:  300,
		},
		"bob",
	)
	require.NoError(t, err)
	assert.Empty(t, secondProject.Data.Connections)

	content, err := service.QueryAzureDevOpsContent(
		context.Background(),
		&integrationdto.QueryAzureDevOpsContentRequest{
			ConnectionKey: start.Data.ConnectionKey,
			SicoProjectId: 100,
			ResourceKey:   "org-id/ado-project",
			Kind:          azuredevops.ContentKindRepositories,
		},
		"bob",
	)
	require.NoError(t, err)
	require.Len(t, content.Data.Items, 1)
	assert.Equal(t, "Shared Repo", content.Data.Items[0].Fields["name"].GetStringValue())
	for _, query := range []struct {
		kind       string
		queryID    string
		workItemID int64
	}{
		{kind: azuredevops.ContentKindSavedQueries},
		{kind: azuredevops.ContentKindQueryResults, queryID: "11111111-1111-4111-8111-111111111111"},
		{kind: azuredevops.ContentKindWorkItem, workItemID: 101},
	} {
		request := &integrationdto.QueryAzureDevOpsContentRequest{
			ConnectionKey: start.Data.ConnectionKey, SicoProjectId: 100, ResourceKey: "org-id/ado-project",
			Kind: query.kind, QueryId: query.queryID, WorkItemId: query.workItemID,
		}
		result, queryErr := service.QueryAzureDevOpsContent(context.Background(), request, "bob")
		require.NoError(t, queryErr)
		require.Len(t, result.Data.Items, 1)
		if query.kind == azuredevops.ContentKindQueryResults {
			require.NotNil(t, result.Data.Metadata)
			assert.Equal(t, query.queryID, result.Data.Metadata.Fields["queryId"].GetStringValue())
		}
		request.SicoProjectId = 200
		_, queryErr = service.QueryAzureDevOpsContent(context.Background(), request, "bob")
		requireAppErrorCode(t, queryErr, errcode.CommonForbidden)
	}
	_, err = service.QueryAzureDevOpsContent(
		context.Background(),
		&integrationdto.QueryAzureDevOpsContentRequest{
			ConnectionKey: start.Data.ConnectionKey,
			SicoProjectId: 100,
			ResourceKey:   "org-id/ado-project",
			Kind:          azuredevops.ContentKindTestCases,
		},
		"bob",
	)
	requireAppErrorCode(t, err, errcode.CommonInvalidParam)

	integrationRepository.connections[start.Data.ConnectionKey].Status = int32(
		integrationdto.ConnectionStatus_CONNECTION_STATUS_REAUTHORIZATION_REQUIRED,
	)
	unavailable, err := service.ListAzureDevOpsProjectConnections(
		context.Background(),
		&integrationdto.ListAzureDevOpsProjectConnectionsRequest{
			OrganizationId: 42,
			SicoProjectId:  100,
		},
		"bob",
	)
	require.NoError(t, err)
	require.Len(t, unavailable.Data.Connections, 1)
	assert.Equal(t, integrationdto.ConnectionStatus_CONNECTION_STATUS_REAUTHORIZATION_REQUIRED,
		unavailable.Data.Connections[0].Status)
	integrationRepository.connections[start.Data.ConnectionKey].Status = int32(
		integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE,
	)

	otherProject, err := service.ListAzureDevOpsProjectConnections(
		context.Background(),
		&integrationdto.ListAzureDevOpsProjectConnectionsRequest{
			OrganizationId: 42,
			SicoProjectId:  200,
		},
		"bob",
	)
	require.NoError(t, err)
	assert.Empty(t, otherProject.Data.Connections)
	_, err = service.QueryAzureDevOpsContent(
		context.Background(),
		&integrationdto.QueryAzureDevOpsContentRequest{
			ConnectionKey: start.Data.ConnectionKey,
			SicoProjectId: 200,
			ResourceKey:   "org-id/ado-project",
			Kind:          azuredevops.ContentKindRepositories,
		},
		"bob",
	)
	requireAppErrorCode(t, err, errcode.CommonForbidden)
}

func TestAzureDevOpsPersonalReauthorizationPreservesConnectionIdentity(t *testing.T) {
	tests := []struct {
		name           string
		profileID      string
		wantConflict   bool
		wantCredential int64
	}{
		{name: "same account", profileID: "original-profile", wantCredential: 5},
		{name: "different account", profileID: "different-profile", wantConflict: true, wantCredential: 4},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			accessToken := unsignedTestJWT(map[string]any{
				"tid": "22222222-2222-2222-2222-222222222222",
			})
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				switch request.URL.Path {
				case "/organizations/oauth2/v2.0/token":
					_, _ = io.WriteString(
						response,
						`{"access_token":"`+accessToken+`","refresh_token":"refresh",`+
							`"token_type":"Bearer","expires_in":3600}`,
					)
				case "/_apis/profile/profiles/me":
					_, _ = io.WriteString(response, `{"id":"`+test.profileID+`"}`)
				default:
					http.NotFound(response, request)
				}
			}))
			defer server.Close()
			connection := &integrationrepo.ConnectionModel{
				ID:                1,
				ConnectionKey:     "personal",
				OrganizationID:    42,
				ProjectID:         100,
				OwnerUsername:     "alice",
				Provider:          azuredevops.ProviderKey,
				Mode:              int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
				Status:            int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE),
				ExternalID:        "original-profile",
				CredentialVersion: 4,
				Metadata: encodeAzureMetadata(&azureConnectionMetadata{
					SchemaVersion: 1, Stage: "active", ProfileID: "original-profile",
					ResourceAccess: azureResourceAccessAllProjects,
				}),
			}
			integrationRepository := &fakeIntegrationRepository{
				connections: map[string]*integrationrepo.ConnectionModel{"personal": connection},
				credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
			}
			service := newTestServiceWithConnector(
				integrationRepository,
				map[int64]*projectrepo.ProjectModel{100: {ID: 100, OrganizationID: 42}},
				newAzureTestConnector(t, server.URL),
			)

			start, err := service.StartAzureDevOpsPersonal(
				context.Background(),
				&integrationdto.StartAzureDevOpsAuthorizationRequest{
					OrganizationId: 42,
					SicoProjectId:  100,
					ConnectionKey:  stringPointer(connection.ConnectionKey),
				},
				"alice",
			)
			require.NoError(t, err)
			authorizationURL, err := url.Parse(start.Data.AuthorizationUrl)
			require.NoError(t, err)

			_, err = service.CompleteAzureDevOpsPersonal(
				context.Background(), authorizationURL.Query().Get("state"), "authorization-code",
			)

			if test.wantConflict {
				requireAppErrorCode(t, err, errcode.CommonConflict)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, "personal", connection.ConnectionKey)
			assert.Equal(t, "alice", connection.OwnerUsername)
			assert.Equal(t, int64(42), connection.OrganizationID)
			assert.Equal(t, int64(100), connection.ProjectID)
			assert.Equal(t, test.wantCredential, connection.CredentialVersion)
			metadata, metadataErr := decodeAzureMetadata(connection.Metadata)
			require.NoError(t, metadataErr)
			assert.Equal(t, "active", metadata.Stage)
			assert.Equal(t, "original-profile", metadata.ProfileID)
			assert.Equal(t, "original-profile", connection.ExternalID)
			assert.Equal(t, azureResourceAccessAllProjects, metadata.ResourceAccess)
		})
	}
}

func TestAzureDevOpsExpiredCredentialRequiresReauthorization(t *testing.T) {
	connector := newAzureTestConnector(t, "https://provider-must-not-be-called.invalid")
	connection := &integrationrepo.ConnectionModel{
		ID:                1,
		ConnectionKey:     "personal",
		OrganizationID:    42,
		OwnerUsername:     "alice",
		Provider:          azuredevops.ProviderKey,
		Mode:              int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
		Status:            int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE),
		CredentialVersion: 1,
	}
	encrypted, err := connector.EncryptTokenBundle(connection.ID, 1, connection.Mode, &azuredevops.TokenBundle{
		SchemaVersion: 1,
		AccessToken:   "expired-access-token",
		ExpiresAt:     time.Now().Add(-time.Minute).UnixMilli(),
	})
	require.NoError(t, err)
	integrationRepository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{"personal": connection},
		credentials: map[fakeCredentialKey]*integrationrepo.CredentialModel{
			{connectionID: connection.ID, version: 1}: {
				Version:       1,
				Scheme:        encrypted.Scheme,
				KeyID:         encrypted.KeyID,
				EncryptedData: encrypted.Data,
			},
		},
	}
	service := newTestServiceWithConnector(integrationRepository, nil, connector)

	_, err = service.azureDelegatedBundle(context.Background(), connection, "alice")

	requireAppErrorCode(t, err, errcode.IntegrationReauthorizationRequired)
	assert.Equal(
		t,
		int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_REAUTHORIZATION_REQUIRED),
		connection.Status,
	)
}

func TestAzureCredentialAuthorizationRejectsStaleMetadata(t *testing.T) {
	connection := personalConnection("azure", azuredevops.ProviderKey, 42)
	connection.Metadata = encodeAzureMetadata(&azureConnectionMetadata{SchemaVersion: 1, Stage: "selected"})
	repository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{"azure": connection},
		credentials: make(map[fakeCredentialKey]*integrationrepo.CredentialModel),
	}
	service := newTestServiceWithConnector(repository, nil, newAzureTestConnector(t, "https://unused.invalid"))
	snapshot, err := repository.GetConnectionByKey(context.Background(), "azure")
	require.NoError(t, err)
	connection.Metadata = encodeAzureMetadata(&azureConnectionMetadata{
		SchemaVersion: 1, Stage: "active", Operation: &azureOperation{ID: "new-authorization"},
	})

	err = service.saveAzureCredential(
		context.Background(), snapshot, &azuredevops.TokenBundle{SchemaVersion: 1},
		&azureConnectionMetadata{SchemaVersion: 1, Stage: "authorized"}, "admin", map[string]any{},
	)

	requireAppErrorCode(t, err, errcode.CommonConflict)
	assert.Zero(t, connection.CredentialVersion)
	assert.Contains(t, string(connection.Metadata), "new-authorization")
	assert.Empty(t, repository.credentials)
	err = repository.UpdateConnectionState(context.Background(), snapshot, map[string]any{"metadata": snapshot.Metadata})
	assert.ErrorIs(t, err, integrationrepo.ErrConnectionStateConflict)
}

func TestAzureDevOpsCredentialReadDoesNotRewriteCurrentCredential(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	cipher, err := azuredevops.NewAESGCMCipher(key, "test-key")
	require.NoError(t, err)
	bundle := &azuredevops.TokenBundle{
		SchemaVersion: 1,
		AccessToken:   "access-token",
		RefreshToken:  "refresh-token",
		ExpiresAt:     time.Now().Add(time.Hour).UnixMilli(),
		ProfileID:     "profile-id",
	}
	plaintext, err := json.Marshal(bundle)
	require.NoError(t, err)
	encrypted, err := cipher.Encrypt(
		plaintext,
		azuredevops.CredentialAAD(
			1,
			1,
			azuredevops.ProviderKey,
			int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
		),
	)
	require.NoError(t, err)
	connection := &integrationrepo.ConnectionModel{
		ID:                1,
		ConnectionKey:     "azure",
		OrganizationID:    42,
		OwnerUsername:     "alice",
		Provider:          azuredevops.ProviderKey,
		Mode:              int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
		Status:            int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE),
		CredentialVersion: 1,
		Metadata: encodeAzureMetadata(&azureConnectionMetadata{
			SchemaVersion: 1,
			Stage:         "active",
		}),
	}
	integrationRepository := &fakeIntegrationRepository{
		connections: map[string]*integrationrepo.ConnectionModel{"azure": connection},
		credentials: map[fakeCredentialKey]*integrationrepo.CredentialModel{
			{connectionID: 1, version: 1}: {
				ConnectionID:  1,
				Version:       1,
				Scheme:        encrypted.Scheme,
				KeyID:         encrypted.KeyID,
				EncryptedData: encrypted.Data,
			},
		},
	}
	connector := azuredevops.NewConnectorWithDependencies(
		azuredevops.Config{Enabled: true},
		serverHTTPClient(),
		azuredevops.NewMemoryStateStore(cipher, time.Minute),
		cipher,
		&fakeClientAssertion{},
	)
	service := newTestServiceWithConnector(integrationRepository, nil, connector)

	snapshot, err := integrationRepository.GetConnectionByKey(context.Background(), "azure")
	require.NoError(t, err)
	selectedMetadata := encodeAzureMetadata(&azureConnectionMetadata{
		SchemaVersion: 1, Stage: "active", Operation: &azureOperation{ID: "new-authorization"},
	})
	connection.Metadata = selectedMetadata

	loaded, err := service.azureDelegatedBundle(context.Background(), snapshot, "alice")

	require.NoError(t, err)
	assert.Equal(t, "access-token", loaded.AccessToken)
	assert.Equal(t, int64(1), connection.CredentialVersion)
	assert.JSONEq(t, string(selectedMetadata), string(connection.Metadata))
	require.Len(t, integrationRepository.credentials, 1)
	stored := integrationRepository.credentials[fakeCredentialKey{connectionID: 1, version: 1}]
	assert.Equal(t, encrypted.KeyID, stored.KeyID)
	assert.Equal(t, encrypted.Data, stored.EncryptedData)
}

func newTestService(
	integrationRepository *fakeIntegrationRepository,
	projects map[int64]*projectrepo.ProjectModel,
) *Service {
	return newTestServiceWithConnector(integrationRepository, projects, nil)
}

func newTestServiceWithConnector(
	integrationRepository *fakeIntegrationRepository,
	projects map[int64]*projectrepo.ProjectModel,
	connector *azuredevops.Connector,
) *Service {
	if projects == nil {
		projects = make(map[int64]*projectrepo.ProjectModel)
	}
	return NewService(&Components{Access: allowTestAccess{},
		IntegrationRepo: integrationRepository,
		OrganizationRepo: &fakeOrganizationRepository{
			organizations: map[int64]*organizationrepo.OrganizationModel{42: {ID: 42}},
		},
		ProjectRepo: &fakeProjectRepository{projects: projects},
		AzureDevOps: connector,
	})
}

func personalConnection(
	connectionKey, provider string, organizationID int64,
) *integrationrepo.ConnectionModel {
	return &integrationrepo.ConnectionModel{
		ID:             1,
		ConnectionKey:  connectionKey,
		OrganizationID: organizationID,
		OwnerUsername:  "admin",
		Provider:       provider,
		Mode:           int32(integrationdto.ConnectionMode_CONNECTION_MODE_PERSONAL),
		Status:         int32(integrationdto.ConnectionStatus_CONNECTION_STATUS_ACTIVE),
		ExternalID:     "external-connection",
	}
}

func requireAppErrorCode(t *testing.T, err error, code int32) {
	t.Helper()
	require.Error(t, err)
	appError, ok := apperr.As(err)
	require.True(t, ok)
	assert.Equal(t, code, appError.Code())
}

func newAzureTestConnector(t *testing.T, endpoint string) *azuredevops.Connector {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	cipher, err := azuredevops.NewAESGCMCipher(key, "test-key")
	require.NoError(t, err)
	config := azuredevops.Config{
		Enabled:             true,
		ClientID:            "client-id",
		PersonalRedirectURL: "https://sico.test/personal/callback",
		FrontendReturnURL:   "https://sico.test/lab",
		AuthorityURL:        endpoint,
		OAuthTenant:         "organizations",
		PersonalOAuthScopes: "499b84ac-1321-427f-aa17-267ca6975798/.default",
		ProfileBaseURL:      endpoint,
		AccountsBaseURL:     endpoint,
		DevAzureBaseURL:     endpoint,
		StateTTL:            time.Minute,
		HTTPTimeout:         time.Second,
	}
	return azuredevops.NewConnectorWithDependencies(
		config,
		serverHTTPClient(),
		azuredevops.NewMemoryStateStore(cipher, time.Minute),
		cipher,
		&fakeClientAssertion{},
	)
}

type fakeClientAssertion struct{}

func (*fakeClientAssertion) GetClientAssertion(context.Context) (string, error) {
	return "client-assertion", nil
}

func serverHTTPClient() *http.Client { return &http.Client{Timeout: time.Second} }

func unsignedTestJWT(claims map[string]any) string {
	payload, _ := json.Marshal(claims)
	return "header." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func stringPointer(value string) *string { return &value }
