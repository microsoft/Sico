package azuredevops

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServiceEndpointPreservesQueriesWithoutMutatingInput(test *testing.T) {
	values := url.Values{
		"memberId":          {"profile id"},
		"continuationToken": {"page+2&next"},
		"filter":            {"first", "second"},
	}

	endpoint := serviceEndpoint("https://provider.test/base///", "/_apis/accounts", restAPIVersion, values)

	assert.Equal(test,
		"https://provider.test/base/_apis/accounts?"+
			"api-version=7.1&continuationToken=page%2B2%26next&filter=first&filter=second&memberId=profile+id",
		endpoint,
	)
	assert.Equal(test, url.Values{
		"memberId":          {"profile id"},
		"continuationToken": {"page+2&next"},
		"filter":            {"first", "second"},
	}, values)
	assert.Equal(test,
		"https://provider.test/_apis/profile/profiles/me?api-version=7.1",
		serviceEndpoint("https://provider.test", "_apis/profile/profiles/me", restAPIVersion, nil),
	)
}

func TestOrganizationEndpointPreservesEscapedOrganizationAndPreviewVersion(test *testing.T) {
	connector := &Connector{config: Config{DevAzureBaseURL: "https://provider.test/root/"}}

	endpoint := connector.organizationEndpoint(
		"org/name #?",
		"/_apis/testplan/Suites",
		testPlanAPIVersion,
		url.Values{"testCaseId": {"123"}},
	)

	assert.Equal(test,
		"https://provider.test/root/org%2Fname%20%23%3F/_apis/testplan/Suites?api-version=7.1-preview.1&testCaseId=123",
		endpoint,
	)
	parsed, err := url.Parse(endpoint)
	require.NoError(test, err)
	assert.Equal(test, "7.1-preview.1", parsed.Query().Get("api-version"))
}

func TestProjectEndpointPreservesEscapedSegmentsAndRouteCase(test *testing.T) {
	connector := &Connector{config: Config{DevAzureBaseURL: "https://provider.test/root/"}}
	values := url.Values{"$top": {"50"}, "continuationToken": {"token+/="}}

	endpoint := connector.projectEndpoint(
		"org name",
		"project/with%slash",
		"/_apis/testplan/Plans/17/Suites/23/TestCase",
		testCaseAPIVersion,
		values,
	)

	assert.Equal(test,
		"https://provider.test/root/org%20name/project%2Fwith%25slash/_apis/testplan/Plans/17/Suites/23/TestCase?"+
			"%24top=50&api-version=7.1-preview.3&continuationToken=token%2B%2F%3D",
		endpoint,
	)
	assert.NotContains(test, values, "api-version")
}

func TestContentEndpointVersionsRemainRouteSpecific(test *testing.T) {
	for _, fixture := range []struct {
		query   ContentQuery
		path    string
		version string
	}{
		{
			query:   ContentQuery{Kind: ContentKindRepositories},
			path:    "_apis/git/repositories",
			version: "7.1",
		},
		{
			query:   ContentQuery{Kind: ContentKindTestPlans},
			path:    "_apis/testplan/plans",
			version: "7.1-preview.1",
		},
		{
			query:   ContentQuery{Kind: ContentKindTestCases, PlanID: 17, SuiteID: 23},
			path:    "_apis/testplan/Plans/17/Suites/23/TestCase",
			version: "7.1-preview.3",
		},
		{
			query:   ContentQuery{Kind: ContentKindPipelines},
			path:    "_apis/pipelines",
			version: "7.1",
		},
		{
			query:   ContentQuery{Kind: ContentKindPipelineRuns, PipelineID: 29},
			path:    "_apis/pipelines/29/runs",
			version: "7.1",
		},
	} {
		test.Run(fixture.query.Kind, func(test *testing.T) {
			path, version, err := projectContentListEndpoint(fixture.query)

			require.NoError(test, err)
			assert.Equal(test, fixture.path, path)
			assert.Equal(test, fixture.version, version)
		})
	}
}

func TestOAuthEndpointPreservesAuthorityAndTenantWithoutRESTVersion(test *testing.T) {
	connector := &Connector{config: Config{AuthorityURL: "https://identity.test/base///"}}

	for _, operation := range []string{"authorize", "token"} {
		endpoint := connector.oauthEndpoint("tenant/name #?", operation)

		assert.Equal(test,
			"https://identity.test/base/tenant%2Fname%20%23%3F/oauth2/v2.0/"+operation,
			endpoint,
		)
		parsed, err := url.Parse(endpoint)
		require.NoError(test, err)
		assert.Empty(test, parsed.RawQuery)
		assert.Empty(test, parsed.Fragment)
	}
}

func TestWorkItemURLPreservesBrowserLinkFormat(test *testing.T) {
	connector := &Connector{config: Config{DevAzureBaseURL: "https://provider.test/root/"}}

	assert.Equal(test,
		"https://provider.test/root/org%20name/project%2Fid/_workitems/edit/123",
		connector.workItemURL("org name", "project/id", 123),
	)
}
