package azuredevops

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSavedQueryID = "11111111-1111-4111-8111-111111111111"

func TestListSavedQueriesReadsProjectFolders(t *testing.T) {
	tests := []struct {
		name     string
		folderID string
		path     string
		response string
	}{
		{
			name: "root", path: "/office/project-id/_apis/wit/queries",
			response: `{"value":[{"id":"shared-id","name":"Shared Queries","path":"Shared Queries",` +
				`"isFolder":true,"hasChildren":true,"children":[{"id":"hidden-child"}],"accessToken":"hidden"}]}`,
		},
		{
			name: "folder", folderID: testSavedQueryID,
			path: "/office/project-id/_apis/wit/queries/" + testSavedQueryID,
			response: `{"isFolder":true,"children":[{"id":"query-id","name":"QAPilot-All-Test-Case",` +
				`"path":"Shared Queries/OC/Copilot/Testing/QAPilot/QAPilot-All-Test-Case","queryType":"flat",` +
				`"isFolder":false,"wiql":"SELECT ...","accessToken":"hidden"}]}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				assert.Equal(t, http.MethodGet, request.Method)
				assert.Equal(t, test.path, request.URL.Path)
				assert.Equal(t, "Bearer delegated", request.Header.Get("Authorization"))
				assert.Equal(t, "1", request.URL.Query().Get("$depth"))
				assert.Equal(t, "minimal", request.URL.Query().Get("$expand"))
				response.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(response, test.response)
			}))
			defer server.Close()
			items, err := testConnector(t, server.URL).ListSavedQueries(
				context.Background(), "delegated", "office", "project-id", test.folderID,
			)
			require.NoError(t, err)
			require.Len(t, items, 1)
			assert.NotEmpty(t, items[0]["id"])
			assert.NotEmpty(t, items[0]["path"])
			assert.NotContains(t, items[0], "children")
			assert.NotContains(t, items[0], "wiql")
			assert.NotContains(t, items[0], "accessToken")
		})
	}
}

func TestListSavedQueriesRejectsLeafAsFolder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(response, `{"id":"query-id","isFolder":false}`)
	}))
	defer server.Close()
	_, err := testConnector(t, server.URL).ListSavedQueries(
		context.Background(), "delegated", "office", "project-id", testSavedQueryID,
	)
	assert.ErrorIs(t, err, ErrInvalidContentQuery)
}

var queryTestProject = ResolvedProject{
	OrganizationID: "org-id", OrganizationName: "office", Project: Project{ID: "project-id", Name: "OC"},
}

func TestRunSavedQueryPreservesProviderOrderAndPages(t *testing.T) {
	server := savedQueryServer(t, false)
	defer server.Close()
	page, err := testConnector(t, server.URL).QueryProjectContentPage(
		context.Background(), "delegated", queryTestProject,
		ContentQuery{Kind: ContentKindQueryResults, QueryID: testSavedQueryID, Offset: 1, Top: 2},
	)
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	assert.Equal(t, int64(101), page.Items[0]["id"])
	assert.Equal(t, int64(102), page.Items[1]["id"])
	assert.Equal(t, 3, page.Metadata["total"])
	assert.Equal(t, 1, page.Metadata["offset"])
	assert.Equal(t, 3, page.Metadata["nextOffset"])
	assert.Equal(t, false, page.Metadata["hasNext"])
	assert.Equal(t, "QAPilot-All-Ready-Test-Case", page.Metadata["queryName"])
	assert.Equal(t, "flat", page.Metadata["queryType"])
	assert.NotContains(t, page.Items[0]["fields"], "accessToken")
}

func TestRunSavedQueryRejectsForeignProjectEvenOutsideRequestedPage(t *testing.T) {
	server := savedQueryServer(t, true)
	defer server.Close()
	page, err := testConnector(t, server.URL).QueryProjectContentPage(
		context.Background(), "delegated", queryTestProject,
		ContentQuery{Kind: ContentKindQueryResults, QueryID: testSavedQueryID, Top: 1},
	)
	assert.ErrorIs(t, err, ErrInvalidContentQuery)
	assert.Nil(t, page)
}

func TestRunSavedQueryRejectsInvalidInputs(t *testing.T) {
	connector := testConnector(t, "https://provider.invalid")
	for _, query := range []ContentQuery{
		{Kind: ContentKindQueryResults},
		{Kind: ContentKindQueryResults, QueryID: testSavedQueryID, Top: 101},
		{Kind: ContentKindQueryResults, QueryID: testSavedQueryID, Offset: -1},
		{Kind: ContentKindQueryResults, QueryID: "../queries"},
	} {
		_, err := connector.QueryProjectContentPage(context.Background(), "delegated", queryTestProject, query)
		assert.ErrorIs(t, err, ErrInvalidContentQuery)
	}
}

func savedQueryServer(t *testing.T, foreignProject bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(t, http.MethodGet, request.Method)
		assert.Equal(t, "Bearer delegated", request.Header.Get("Authorization"))
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/office/project-id/_apis/wit/queries/" + testSavedQueryID:
			_, _ = io.WriteString(response, `{"id":"`+testSavedQueryID+`",`+
				`"name":"QAPilot-All-Ready-Test-Case","path":"Shared Queries/QAPilot"}`)
		case "/office/project-id/_apis/wit/wiql/" + testSavedQueryID:
			assert.Empty(t, request.URL.Query().Get("$top"))
			_, _ = io.WriteString(response, `{"queryType":"flat","asOf":"2026-09-06T15:00:00Z",`+
				`"columns":[{"name":"Title","referenceName":"System.Title"}],`+
				`"workItems":[{"id":103},{"id":101},{"id":102}]}`)
		case "/office/_apis/projects/project-id":
			_, _ = io.WriteString(response, `{"id":"project-id","name":"OC"}`)
		case "/office/project-id/_apis/wit/workitems":
			assert.Equal(t, "2026-09-06T15:00:00Z", request.URL.Query().Get("asOf"))
			ids := strings.Split(request.URL.Query().Get("ids"), ",")
			items := make([]map[string]any, 0, len(ids))
			for index := len(ids) - 1; index >= 0; index-- {
				id, err := strconv.ParseInt(ids[index], 10, 64)
				require.NoError(t, err)
				project := "OC"
				if foreignProject && id == 102 {
					project = "Other project"
				}
				items = append(items, map[string]any{"id": id, "fields": map[string]any{
					"System.TeamProject": project, "System.Title": "Test case", "accessToken": "hidden",
				}})
			}
			require.NoError(t, json.NewEncoder(response).Encode(map[string]any{"value": items}))
		default:
			t.Errorf("unexpected provider path: %s", request.URL.Path)
			http.NotFound(response, request)
		}
	}))
}

func TestSavedQueryFolderRejectsPathsAndZeroUUID(t *testing.T) {
	for _, folderID := range []string{"..", "../queries", "folder/id", "%2f", "00000000-0000-0000-0000-000000000000"} {
		_, err := testConnector(t, "https://provider.invalid").ListSavedQueries(
			context.Background(), "delegated", "office", "project-id", folderID,
		)
		assert.ErrorIs(t, err, ErrInvalidContentQuery)
	}
}

func TestSavedQueryMembershipUsesBoundedConcurrentBatches(t *testing.T) {
	var active atomic.Int32
	var maximum atomic.Int32
	var requests atomic.Int32
	gate := make(chan struct{})
	var release sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		current := active.Add(1)
		defer active.Add(-1)
		for old := maximum.Load(); current > old; old = maximum.Load() {
			if maximum.CompareAndSwap(old, current) {
				break
			}
		}
		if current == 4 {
			release.Do(func() { close(gate) })
		}
		select {
		case <-gate:
		case <-request.Context().Done():
			return
		}
		ids := strings.Split(request.URL.Query().Get("ids"), ",")
		assert.LessOrEqual(t, len(ids), 200)
		items := make([]map[string]any, 0, len(ids))
		for _, value := range ids {
			id, err := strconv.ParseInt(value, 10, 64)
			require.NoError(t, err)
			items = append(items, map[string]any{"id": id, "fields": map[string]any{"System.TeamProject": "OC"}})
		}
		require.NoError(t, json.NewEncoder(response).Encode(map[string]any{"value": items}))
	}))
	defer server.Close()
	ids := make([]int64, 1000)
	for index := range ids {
		ids[index] = int64(index + 1)
	}
	visible, err := testConnector(t, server.URL).savedQueryProjectMembership(
		context.Background(), "delegated", "office", "project-id", "OC", ids, "",
	)
	require.NoError(t, err)
	assert.Len(t, visible, 1000)
	assert.Equal(t, int32(5), requests.Load())
	assert.Equal(t, int32(4), maximum.Load())
}

func TestRunSavedQueryPreservesTreeAndLinkRelations(t *testing.T) {
	for _, queryType := range []string{"tree", "oneHop"} {
		t.Run(queryType, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.Header().Set("Content-Type", "application/json")
				switch request.URL.Path {
				case "/office/project-id/_apis/wit/queries/" + testSavedQueryID:
					_, _ = io.WriteString(response, `{"id":"`+testSavedQueryID+`","name":"Linked cases"}`)
				case "/office/project-id/_apis/wit/wiql/" + testSavedQueryID:
					_, _ = io.WriteString(response, `{"queryType":"`+queryType+`","workItemRelations":[`+
						`{"target":{"id":103}},{"source":{"id":103},"target":{"id":101},"rel":"child"},`+
						`{"source":{"id":103},"target":{"id":102},"rel":"child"},`+
						`{"source":{"id":101},"target":{"id":102},"rel":"related"}]}`)
				case "/office/_apis/projects/project-id":
					_, _ = io.WriteString(response, `{"id":"project-id","name":"OC"}`)
				case "/office/project-id/_apis/wit/workitems":
					items := make([]map[string]any, 0)
					for _, value := range strings.Split(request.URL.Query().Get("ids"), ",") {
						id, err := strconv.ParseInt(value, 10, 64)
						require.NoError(t, err)
						items = append(items, map[string]any{
							"id": id, "fields": map[string]any{"System.TeamProject": "OC"},
						})
					}
					require.NoError(t, json.NewEncoder(response).Encode(map[string]any{"value": items}))
				default:
					t.Errorf("unexpected endpoint %s", request.URL.Path)
					http.NotFound(response, request)
				}
			}))
			defer server.Close()
			page, err := testConnector(t, server.URL).QueryProjectContentPage(
				context.Background(), "delegated", queryTestProject,
				ContentQuery{Kind: ContentKindQueryResults, QueryID: testSavedQueryID, Top: 2},
			)
			require.NoError(t, err)
			require.Len(t, page.Items, 2)
			assert.Equal(t, int64(103), page.Items[0]["id"])
			assert.Equal(t, int64(101), page.Items[1]["id"])
			assert.Equal(t, 3, page.Metadata["total"])
			assert.Equal(t, true, page.Metadata["hasNext"])
			assert.Equal(t, queryType, page.Metadata["queryType"])
			relations := page.Metadata["relations"].([]any)
			require.Len(t, relations, 4)
			assert.Equal(t, map[string]any{"sourceId": int64(0), "targetId": int64(103), "rel": ""}, relations[0])
			assert.Equal(t,
				map[string]any{"sourceId": int64(101), "targetId": int64(102), "rel": "related"}, relations[3],
			)
		})
	}
}
