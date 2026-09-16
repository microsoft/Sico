package azuredevops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorkItemDetailsRetainsRichFieldsAndValidatesProject(t *testing.T) {
	for _, foreignProject := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			assert.Equal(t, http.MethodGet, request.Method)
			response.Header().Set("Content-Type", "application/json")
			if request.URL.Path == "/office/_apis/projects/project-id" {
				require.NoError(t, json.NewEncoder(response).Encode(map[string]any{
					"id": "project-id", "name": "OC",
				}))
				return
			}
			assert.Equal(t, "/office/project-id/_apis/wit/workitems", request.URL.Path)
			assert.Equal(t, "102", request.URL.Query().Get("ids"))
			assert.Equal(t, "2026-09-06T15:00:00Z", request.URL.Query().Get("asOf"))
			assert.Contains(t, request.URL.Query().Get("fields"), "Microsoft.VSTS.TCM.Steps")
			projectName := "OC"
			if foreignProject {
				projectName = "Other project"
			}
			require.NoError(t, json.NewEncoder(response).Encode(map[string]any{"value": []any{map[string]any{
				"id": 102, "fields": map[string]any{
					"System.TeamProject": projectName, "System.Title": "Test case", "accessToken": "hidden",
					"System.Description": "<p>Verify the workflow.</p>",
					"Microsoft.VSTS.TCM.Steps": `<steps><step id="1" type="ActionStep">` +
						`<parameterizedString>Open the app</parameterizedString>` +
						`<parameterizedString>Ready</parameterizedString></step></steps>`,
				},
			}}}))
		}))
		page, err := testConnector(t, server.URL).QueryProjectContentPage(
			context.Background(), "delegated", queryTestProject,
			ContentQuery{Kind: ContentKindWorkItem, WorkItemID: 102, AsOf: "2026-09-06T15:00:00Z"},
		)
		server.Close()
		if foreignProject {
			assert.ErrorIs(t, err, ErrInvalidContentQuery)
			assert.Nil(t, page)
			continue
		}
		require.NoError(t, err)
		require.Len(t, page.Items, 1)
		fields := page.Items[0]["fields"].(map[string]any)
		assert.Contains(t, fields["Microsoft.VSTS.TCM.Steps"], "Open the app")
		assert.Equal(t, "<p>Verify the workflow.</p>", fields["System.Description"])
		assert.NotContains(t, fields, "accessToken")
	}
}

func TestWorkItemDetailsRejectsInvalidRequests(t *testing.T) {
	connector := testConnector(t, "https://provider.invalid")
	for _, query := range []ContentQuery{
		{Kind: ContentKindWorkItem},
		{Kind: ContentKindWorkItem, WorkItemID: 1, AsOf: "invalid"},
	} {
		_, err := connector.QueryProjectContentPage(context.Background(), "delegated", queryTestProject, query)
		assert.ErrorIs(t, err, ErrInvalidContentQuery)
	}
}
