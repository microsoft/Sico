package azuredevops

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"sico-backend/internal/biz/integration/connector"
)

const maxProviderResponseSize = 4 << 20

var ErrConnectorDisabled = errors.New("azure devops connector is not enabled")

type Connector struct {
	config           Config
	httpClient       *http.Client
	states           StateStore
	cipher           Cipher
	clientAssertions ClientAssertionProvider
}

type Profile = connector.Profile

type Organization struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Projects []Project `json:"projects"`
}

type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	State       string `json:"state,omitempty"`
	Visibility  string `json:"visibility,omitempty"`
}

type ResolvedProject struct {
	OrganizationID   string
	OrganizationName string
	Project
}

type providerResponseError struct {
	Operation string
	Status    int
	Detail    string
}

func (e *providerResponseError) Error() string {
	return fmt.Sprintf("%s failed with status %d: %s", e.Operation, e.Status, e.Detail)
}

func NewConnector(redisClient *redis.Client) (*Connector, error) {
	config, err := ConfigFromEnvironment()
	if err != nil {
		return nil, err
	}

	if !config.Enabled {
		return &Connector{
			config:     config,
			httpClient: newProviderHTTPClient(config.HTTPTimeout),
		}, nil
	}

	cipher, err := NewAESGCMCipher(config.CredentialKey, credentialKeyID)
	if err != nil {
		return nil, err
	}

	states, err := NewRedisStateStore(redisClient, cipher, config.StateTTL)
	if err != nil {
		return nil, err
	}

	assertions, err := NewClientAssertionProvider(config)
	if err != nil {
		return nil, err
	}

	return NewConnectorWithDependencies(
		config,
		newProviderHTTPClient(config.HTTPTimeout),
		states,
		cipher,
		assertions,
	), nil
}

func newProviderHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func NewConnectorWithDependencies(
	config Config,
	httpClient *http.Client,
	states StateStore,
	cipher Cipher,
	clientAssertions ClientAssertionProvider,
) *Connector {
	return &Connector{
		config:           config,
		httpClient:       httpClient,
		states:           states,
		cipher:           cipher,
		clientAssertions: clientAssertions,
	}
}

func (c *Connector) Enabled() bool { return c != nil && c.config.Enabled }

func (c *Connector) Key() string { return ProviderKey }

func (c *Connector) FrontendReturnURL() string { return c.config.FrontendReturnURL }

func (c *Connector) GetProfile(ctx context.Context, accessToken string) (*Profile, error) {
	endpoint := serviceEndpoint(c.config.ProfileBaseURL, "_apis/profile/profiles/me", restAPIVersion, nil)
	request, err := c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return nil, err
	}

	var profile Profile
	if err := c.doJSON(request, &profile); err != nil {
		return nil, err
	}

	if profile.ID == "" {
		return nil, errors.New("azure devops profile response did not contain an ID")
	}

	return &profile, nil
}

func (c *Connector) ListOrganizations(
	ctx context.Context,
	accessToken, profileID string,
) ([]Organization, error) {
	query := url.Values{
		"memberId": {profileID},
	}
	endpoint := serviceEndpoint(c.config.AccountsBaseURL, "_apis/accounts", restAPIVersion, query)
	request, err := c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return nil, err
	}

	var response struct {
		Value []struct {
			ID   string `json:"accountId"`
			Name string `json:"accountName"`
		} `json:"value"`
	}
	if err := c.doJSON(request, &response); err != nil {
		return nil, err
	}

	organizations := make([]Organization, 0, len(response.Value))
	for _, item := range response.Value {
		organizations = append(organizations, Organization{ID: item.ID, Name: item.Name})
	}

	return organizations, nil
}

func (c *Connector) ListProjects(
	ctx context.Context,
	accessToken, organizationName string,
) ([]Project, error) {
	projects := make([]Project, 0)
	continuation := ""

	for page := 0; page < 100; page++ {
		values, next, err := c.listProjectsPage(ctx, accessToken, organizationName, continuation)
		if err != nil {
			return nil, err
		}

		projects = append(projects, values...)
		if next == "" {
			return projects, nil
		}

		continuation = next
	}

	return nil, errors.New("azure devops project lookup exceeded the page limit")
}

func (c *Connector) listProjectsPage(
	ctx context.Context,
	accessToken, organizationName, continuation string,
) ([]Project, string, error) {
	query := url.Values{
		"stateFilter": {"wellFormed"},
		"$top":        {"100"},
	}
	if continuation != "" {
		query.Set("continuationToken", continuation)
	}

	endpoint := c.organizationEndpoint(organizationName, "_apis/projects", restAPIVersion, query)
	request, err := c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return nil, "", err
	}

	var response struct {
		Value []Project `json:"value"`
	}
	headers, err := c.doJSONWithHeaders(request, &response)
	if err != nil {
		return nil, "", err
	}

	return response.Value, headers.Get("X-MS-ContinuationToken"), nil
}

func (c *Connector) DiscoverResources(
	ctx context.Context,
	accessToken, profileID, organizationID string,
) ([]Organization, error) {
	organizations, err := c.ListOrganizations(ctx, accessToken, profileID)
	if err != nil || organizationID == "" {
		return organizations, err
	}

	for _, organization := range organizations {
		if organization.ID != organizationID {
			continue
		}

		projects, projectErr := c.ListProjects(ctx, accessToken, organization.Name)
		if projectErr != nil {
			return nil, projectErr
		}

		organization.Projects = projects
		return []Organization{organization}, nil
	}

	return nil, invalidContentQuery("Azure DevOps organization is not accessible")
}

func (c *Connector) ResolveProject(
	ctx context.Context,
	accessToken, profileID, resourceKey string,
) (*ResolvedProject, error) {
	organizationID, projectID, found := strings.Cut(resourceKey, "/")
	if !found || organizationID == "" || projectID == "" || strings.Contains(projectID, "/") {
		return nil, invalidContentQuery("resourceKey must identify an Azure DevOps organization and project")
	}

	organizations, err := c.ListOrganizations(ctx, accessToken, profileID)
	if err != nil {
		return nil, err
	}

	for _, organization := range organizations {
		if organization.ID != organizationID {
			continue
		}

		name, err := c.contentProjectName(ctx, accessToken, organization.Name, projectID)
		if err != nil {
			return nil, err
		}

		return &ResolvedProject{
			OrganizationID:   organization.ID,
			OrganizationName: organization.Name,
			Project:          Project{ID: projectID, Name: name},
		}, nil
	}

	return nil, invalidContentQuery("Azure DevOps organization is not accessible")
}

func (c *Connector) bearerRequest(
	ctx context.Context, method, endpoint, accessToken string, body any,
) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal Azure DevOps request: %w", err)
		}
		reader = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, fmt.Errorf("create Azure DevOps request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return request, nil
}

func (c *Connector) doJSON(request *http.Request, target any) error {
	_, err := c.doJSONWithHeaders(request, target)
	return err
}

func (c *Connector) doJSONWithHeaders(request *http.Request, target any) (http.Header, error) {
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call provider: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxProviderResponseSize+1))
	if err != nil {
		return nil, fmt.Errorf("read provider response: %w", err)
	}
	if len(body) > maxProviderResponseSize {
		return nil, errors.New("provider response exceeds size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, providerError(request.URL.Host, response.StatusCode, safeProviderError(body))
	}
	if len(body) == 0 || target == nil {
		return response.Header.Clone(), nil
	}
	if err := json.Unmarshal(body, target); err != nil {
		return nil, fmt.Errorf("decode provider response: %w", err)
	}
	return response.Header.Clone(), nil
}

func (c *Connector) requireEnabled() error {
	if !c.Enabled() {
		return ErrConnectorDisabled
	}
	return nil
}

func safeProviderError(body []byte) string {
	var response struct {
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
		Message          string `json:"message"`
		TypeName         string `json:"typeName"`
	}
	if json.Unmarshal(body, &response) == nil {
		for _, value := range []string{response.Error, response.ErrorDescription, response.Message, response.TypeName} {
			if value != "" {
				return truncate(value, 512)
			}
		}
	}
	return http.StatusText(http.StatusBadGateway)
}

func providerError(operation string, status int, detail string) error {
	return &providerResponseError{Operation: operation, Status: status, Detail: truncate(detail, 512)}
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
