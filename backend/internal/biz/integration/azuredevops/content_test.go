package azuredevops

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQueryProjectContentUsesFixedReadOnlyEndpoints(t *testing.T) {
	tests := []struct {
		kind       string
		planID     int64
		suiteID    int64
		pipelineID int64
		path       string
		apiVersion string
	}{
		{
			kind:       ContentKindRepositories,
			path:       "/office/project-id/_apis/git/repositories",
			apiVersion: "7.1",
		},
		{
			kind:       ContentKindTestPlans,
			path:       "/office/project-id/_apis/testplan/plans",
			apiVersion: "7.1-preview.1",
		},
		{
			kind:       ContentKindTestCases,
			planID:     11,
			suiteID:    12,
			path:       "/office/project-id/_apis/testplan/Plans/11/Suites/12/TestCase",
			apiVersion: "7.1-preview.3",
		},
		{kind: ContentKindPipelines, path: "/office/project-id/_apis/pipelines", apiVersion: "7.1"},
		{
			kind:       ContentKindPipelineRuns,
			pipelineID: 21,
			path:       "/office/project-id/_apis/pipelines/21/runs",
			apiVersion: "7.1",
		},
	}
	for _, test := range tests {
		t.Run(test.kind, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				assert.Equal(t, http.MethodGet, request.Method)
				assert.Equal(t, test.path, request.URL.Path)
				assert.Equal(t, test.apiVersion, request.URL.Query().Get("api-version"))
				assert.Equal(t, "Bearer delegated", request.Header.Get("Authorization"))
				response.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(response, `{"value":[{"id":1,"name":"Visible item"}]}`)
			}))
			defer server.Close()
			connector := testConnector(t, server.URL)

			items, err := connector.QueryProjectContent(
				context.Background(),
				"delegated",
				"office",
				"project-id",
				ContentQuery{
					Kind:       test.kind,
					PlanID:     test.planID,
					SuiteID:    test.suiteID,
					PipelineID: test.pipelineID,
					Top:        10,
				},
			)

			require.NoError(t, err)
			require.Len(t, items, 1)
			assert.Equal(t, "Visible item", items[0]["name"])
		})
	}
}

func TestQueryProjectContentBuildsSafeWIQLAndLoadsDetails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/office/project-id/_apis/wit/wiql":
			assert.Equal(t, http.MethodPost, request.Method)
			var body struct {
				Query string `json:"query"`
			}
			require.NoError(t, json.NewDecoder(request.Body).Decode(&body))
			assert.Contains(t, body.Query, "[System.Title] CONTAINS 'O''Brien'")
			assert.Contains(t, body.Query, "[System.WorkItemType] = 'Bug'")
			assert.Contains(t, body.Query, "[System.State] = 'Active'")
			assert.Equal(t, "5", request.URL.Query().Get("$top"))
			_, _ = io.WriteString(response, `{"workItems":[{"id":101},{"id":102}]}`)
		case "/office/project-id/_apis/wit/workitems":
			assert.Equal(t, "101,102", request.URL.Query().Get("ids"))
			assert.Contains(t, request.URL.Query().Get("fields"), "System.Title")
			_, _ = io.WriteString(response, `{"value":[{"id":101,"fields":{"System.Title":"O'Brien issue"}}]}`)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)

	items, err := connector.QueryProjectContent(
		context.Background(),
		"delegated",
		"office",
		"project-id",
		ContentQuery{
			Kind:         ContentKindWorkItems,
			Search:       "O'Brien",
			WorkItemType: "Bug",
			State:        "Active",
			Top:          5,
		},
	)

	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, float64(101), items[0]["id"])
}

func TestQueryProjectContentRequiresNestedResourceIDs(t *testing.T) {
	connector := testConnector(t, "https://provider.invalid")

	_, err := connector.QueryProjectContent(
		context.Background(), "delegated", "office", "project-id",
		ContentQuery{Kind: ContentKindTestCases},
	)
	assert.ErrorContains(t, err, "planId and suiteId")

	_, err = connector.QueryProjectContent(
		context.Background(), "delegated", "office", "project-id",
		ContentQuery{Kind: ContentKindPipelineRuns},
	)
	assert.ErrorContains(t, err, "pipelineId")
}

func TestQueryProjectContentFollowsContinuationTokenWhenFiltering(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			assert.Empty(t, request.URL.Query().Get("continuationToken"))
			response.Header().Set("x-ms-continuationtoken", "next page")
			_, _ = io.WriteString(response, `{"value":[{"id":1,"name":"Other plan"}]}`)
			return
		}
		assert.Equal(t, "next page", request.URL.Query().Get("continuationToken"))
		_, _ = io.WriteString(response, `{"value":[{"id":2,"name":"Release plan"}]}`)
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)

	items, err := connector.QueryProjectContent(
		context.Background(), "delegated", "office", "project-id",
		ContentQuery{Kind: ContentKindTestPlans, Search: "release", Top: 1},
	)

	require.NoError(t, err)
	assert.Equal(t, 2, requests)
	require.Len(t, items, 1)
	assert.Equal(t, "Release plan", items[0]["name"])
}

func TestQueryProjectContentRemovesSensitiveProviderFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"value":[{"id":1,"accessToken":"secret",`+
			`"client_secret":"secret","api-key":"secret","connectionString":"secret",`+
			`"nested":{"System.AccessToken":"secret","private.key":"secret",`+
			`"steps":[{"oauthToken":"secret"},{"servicePrincipalToken":"secret"}]},`+
			`"variables":{"safe":{"value":"visible"},"protected":{"isSecret":true,"value":"hidden"}}}]}`)
	}))
	defer server.Close()
	connector := testConnector(t, server.URL)

	items, err := connector.QueryProjectContent(
		context.Background(), "delegated", "office", "project-id",
		ContentQuery{Kind: ContentKindPipelineRuns, PipelineID: 10},
	)

	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.NotContains(t, items[0], "accessToken")
	assert.NotContains(t, items[0], "client_secret")
	assert.NotContains(t, items[0], "api-key")
	assert.NotContains(t, items[0], "connectionString")
	nested := items[0]["nested"].(map[string]any)
	assert.NotContains(t, nested, "System.AccessToken")
	assert.NotContains(t, nested, "private.key")
	steps := nested["steps"].([]any)
	assert.NotContains(t, steps[0].(map[string]any), "oauthToken")
	assert.NotContains(t, steps[1].(map[string]any), "servicePrincipalToken")
	variables := items[0]["variables"].(map[string]any)
	assert.Equal(t, "visible", variables["safe"].(map[string]any)["value"])
	assert.NotContains(t, variables["protected"].(map[string]any), "value")
}
