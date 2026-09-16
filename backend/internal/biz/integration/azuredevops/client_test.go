package azuredevops

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStartAndCompleteAuthorizationUsesPKCEAndConsumesState(t *testing.T) {
	var tokenForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/organizations/oauth2/v2.0/token":
			require.NoError(t, request.ParseForm())
			tokenForm = request.Form
			response.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(
				response,
				`{"access_token":"access","refresh_token":"refresh","token_type":"Bearer","expires_in":3600}`,
			)
		case "/_apis/profile/profiles/me":
			assert.Equal(t, "Bearer access", request.Header.Get("Authorization"))
			response.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(response, `{"id":"profile-id","displayName":"Test User"}`)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)

	start, err := connector.StartAuthorization(context.Background(), FlowPersonal, "connection", 42, "alice")
	require.NoError(t, err)
	authorizationURL, err := url.Parse(start.AuthorizationURL)
	require.NoError(t, err)
	assert.Equal(t, "S256", authorizationURL.Query().Get("code_challenge_method"))
	assert.NotEmpty(t, authorizationURL.Query().Get("code_challenge"))
	assert.NotEmpty(t, authorizationURL.Query().Get("state"))
	assert.Equal(t, "select_account", authorizationURL.Query().Get("prompt"))
	assert.Contains(t, authorizationURL.Query().Get("scope"), azureDevOpsResourceScope)

	completion, err := connector.CompleteAuthorization(
		context.Background(), FlowPersonal, authorizationURL.Query().Get("state"), "authorization-code",
	)
	require.NoError(t, err)
	assert.Equal(t, "profile-id", completion.Profile.ID)
	assert.Equal(t, "refresh", completion.Bundle.RefreshToken)
	assert.Equal(t, "authorization-code", tokenForm.Get("code"))
	assert.NotEmpty(t, tokenForm.Get("code_verifier"))
	assert.Empty(t, tokenForm.Get("client_secret"))
	assert.Equal(t, clientAssertionType, tokenForm.Get("client_assertion_type"))
	assert.Equal(t, "managed-identity-token", tokenForm.Get("client_assertion"))

	_, err = connector.CompleteAuthorization(
		context.Background(), FlowPersonal, authorizationURL.Query().Get("state"), "authorization-code",
	)
	assert.ErrorIs(t, err, ErrOAuthStateInvalid)
}

func TestCompleteAuthorizationUsesManagedIdentityClientAssertion(t *testing.T) {
	var tokenForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/organizations/oauth2/v2.0/token":
			require.NoError(t, request.ParseForm())
			tokenForm = request.Form
			response.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(
				response,
				`{"access_token":"access","refresh_token":"refresh","token_type":"Bearer","expires_in":3600}`,
			)
		case "/_apis/profile/profiles/me":
			response.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(response, `{"id":"profile-id"}`)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)
	connector.clientAssertions = &staticClientAssertion{assertion: "managed-identity-token"}

	start, err := connector.StartAuthorization(context.Background(), FlowPersonal, "connection", 42, "alice")
	require.NoError(t, err)
	authorizationURL, err := url.Parse(start.AuthorizationURL)
	require.NoError(t, err)
	_, err = connector.CompleteAuthorization(
		context.Background(), FlowPersonal, authorizationURL.Query().Get("state"), "authorization-code",
	)

	require.NoError(t, err)
	assert.Empty(t, tokenForm.Get("client_secret"))
	assert.Equal(t, clientAssertionType, tokenForm.Get("client_assertion_type"))
	assert.Equal(t, "managed-identity-token", tokenForm.Get("client_assertion"))
}

func TestDisabledConnectorRejectsStateCallbacksWithoutPanic(t *testing.T) {
	connector := NewConnectorWithDependencies(Config{}, nil, nil, nil, nil)

	_, err := connector.CompleteAuthorization(context.Background(), FlowPersonal, "state", "code")
	assert.ErrorIs(t, err, ErrConnectorDisabled)

	_, err = connector.ConsumeAuthorizationState(context.Background(), "state")
	assert.ErrorIs(t, err, ErrConnectorDisabled)
}

func TestRefreshTokenStoresRotatedRefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "/tenant-id/oauth2/v2.0/token", request.URL.Path)
		require.NoError(t, request.ParseForm())
		assert.Equal(t, "old-refresh", request.Form.Get("refresh_token"))
		assert.Empty(t, request.Form.Get("client_secret"))
		assert.Equal(t, clientAssertionType, request.Form.Get("client_assertion_type"))
		assert.Equal(t, "managed-identity-token", request.Form.Get("client_assertion"))
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(
			response,
			`{"access_token":"new-access","refresh_token":"new-refresh","token_type":"Bearer","expires_in":3600}`,
		)
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)

	refreshed, changed, err := connector.RefreshToken(context.Background(), &TokenBundle{
		SchemaVersion: 1,
		AccessToken:   "old-access",
		RefreshToken:  "old-refresh",
		ExpiresAt:     time.Now().Add(-time.Minute).UnixMilli(),
		TenantID:      "tenant-id",
		ProfileID:     "profile-id",
	})

	require.NoError(t, err)
	assert.True(t, changed)
	assert.Equal(t, "new-access", refreshed.AccessToken)
	assert.Equal(t, "new-refresh", refreshed.RefreshToken)
	assert.Equal(t, "profile-id", refreshed.ProfileID)
}

func TestDiscoverResourcesMapsAccountsAndProjects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer access", request.Header.Get("Authorization"))
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
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
	connector := testConnector(t, server.URL)

	organizations, err := connector.DiscoverResources(context.Background(), "access", "profile-id", "")

	require.NoError(t, err)
	require.Len(t, organizations, 1)
	assert.Equal(t, "org-id", organizations[0].ID)
	assert.Empty(t, organizations[0].Projects)

	organizations, err = connector.DiscoverResources(context.Background(), "access", "profile-id", "org-id")
	require.NoError(t, err)
	require.Len(t, organizations[0].Projects, 1)
	assert.Equal(t, "project-id", organizations[0].Projects[0].ID)
}

func TestDiscoveryLoadsOnlyTheSelectedOrganization(test *testing.T) {
	requests := make([]string, 0)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests = append(requests, request.URL.Path)
		response.Header().Set("Content-Type", "application/json")

		switch request.URL.Path {
		case "/_apis/accounts":
			_, _ = io.WriteString(response, `{"value":[{"accountId":"office-id","accountName":"office"},`+
				`{"accountId":"blocked-id","accountName":"blocked"}]}`)
		case "/office/_apis/projects":
			_, _ = io.WriteString(response, `{"value":[{"id":"project-id","name":"Product"}]}`)
		case "/blocked/_apis/projects":
			response.WriteHeader(http.StatusForbidden)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	connector := testConnector(test, server.URL)
	organizations, err := connector.DiscoverResources(context.Background(), "access", "profile-id", "")
	require.NoError(test, err)
	require.Len(test, organizations, 2)
	assert.Equal(test, []string{"/_apis/accounts"}, requests)

	_, err = connector.DiscoverResources(context.Background(), "access", "profile-id", "blocked-id")
	require.Error(test, err)

	organizations, err = connector.DiscoverResources(context.Background(), "access", "profile-id", "office-id")
	require.NoError(test, err)
	require.Len(test, organizations, 1)
	require.Len(test, organizations[0].Projects, 1)
	assert.Equal(test, "Product", organizations[0].Projects[0].Name)

	before := len(requests)
	_, err = connector.DiscoverResources(context.Background(), "access", "profile-id", "unknown-id")
	require.ErrorIs(test, err, ErrInvalidContentQuery)
	assert.Equal(test, []string{"/_apis/accounts"}, requests[before:])
}

func TestListProjectsFollowsContinuationToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if request.URL.Query().Get("continuationToken") == "" {
			response.Header().Set("X-MS-ContinuationToken", "next-project")
			_, _ = io.WriteString(response, `{"value":[{"id":"one","name":"One"}]}`)
			return
		}
		assert.Equal(t, "next-project", request.URL.Query().Get("continuationToken"))
		_, _ = io.WriteString(response, `{"value":[{"id":"two","name":"Two"}]}`)
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)

	projects, err := connector.ListProjects(context.Background(), "access", "office")

	require.NoError(t, err)
	require.Len(t, projects, 2)
	assert.Equal(t, "two", projects[1].ID)
}

func TestProviderErrorDoesNotEchoUnknownBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(response, "upstream-secret-body")
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)

	_, err := connector.GetProfile(context.Background(), "access")

	require.Error(t, err)
	assert.NotContains(t, err.Error(), "upstream-secret-body")
}

func TestProviderClientDoesNotFollowRedirects(t *testing.T) {
	redirectReached := false
	target := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		redirectReached = true
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, target.URL, http.StatusFound)
	}))
	defer source.Close()
	connector := testConnector(t, source.URL)
	connector.httpClient = newProviderHTTPClient(time.Second)

	_, err := connector.GetProfile(context.Background(), "access-secret")

	require.Error(t, err)
	assert.False(t, redirectReached)
}

func testConnector(t *testing.T, endpoint string) *Connector {
	t.Helper()
	config := Config{
		Enabled:             true,
		ClientID:            "client-id",
		PersonalRedirectURL: "https://sico.test/personal/callback",
		FrontendReturnURL:   "https://sico.test/lab",
		AuthorityURL:        endpoint,
		OAuthTenant:         "organizations",
		PersonalOAuthScopes: personalDelegatedScopes,
		ProfileBaseURL:      endpoint,
		AccountsBaseURL:     endpoint,
		DevAzureBaseURL:     endpoint,
		StateTTL:            10 * time.Minute,
		HTTPTimeout:         time.Second,
	}
	cipher := newTestCipher(t)
	states := NewMemoryStateStore(cipher, config.StateTTL)
	return NewConnectorWithDependencies(
		config,
		serverClient(endpoint),
		states,
		cipher,
		&staticClientAssertion{assertion: "managed-identity-token"},
	)
}

func serverClient(_ string) *http.Client { return &http.Client{Timeout: time.Second} }

type staticClientAssertion struct {
	assertion string
}

func (provider *staticClientAssertion) GetClientAssertion(context.Context) (string, error) {
	return provider.assertion, nil
}
