package azuredevops

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

var exportTestProject = ResolvedProject{
	OrganizationID:   "org-id",
	OrganizationName: "office",
	Project:          Project{ID: "project-id", Name: "Project"},
}

func TestExportSavedQueryFileUsesOneReadPathForAllItemTypes(t *testing.T) {
	for _, itemTypes := range [][]string{
		{"Test Case", "Test Case"},
		{"Bug", "Bug"},
		{"Bug", "Test Case", "Task"},
	} {
		t.Run(strings.Join(itemTypes, ","), func(t *testing.T) {
			fixture := &exportFileFixture{Types: itemTypes}
			server := exportFileServer(t, fixture)
			defer server.Close()

			export, err := testConnector(t, server.URL).ExportSavedQueryFile(
				context.Background(),
				"delegated",
				exportTestProject,
				testSavedQueryID,
				ExportOptions{
					ColumnOptions: []string{
						"System.Id",
						"System.WorkItemType",
						"System.Title",
						exportStepsField,
					},
				},
			)

			assert.Equal(t, int32(1), fixture.QueryRuns.Load())
			assert.Equal(t, int32(1), fixture.ItemReads.Load())
			require.NoError(t, err)
			assert.Equal(t, ExportSourceWorkItems, export.ExportSource)
			assert.Equal(t, "xlsx", export.FileExt)
			assert.Equal(t, XLSXContentType, export.ContentType)
			assert.True(t, strings.HasPrefix(export.FileName, "ado-query-"+testSavedQueryID+"-"))
			assert.True(t, strings.HasSuffix(export.FileName, ".xlsx"))
			assert.Equal(t, len(itemTypes), export.Count)
			assert.Equal(t, exportTestAsOf, export.QueryAsOf)

			rows := exportTestWorkbookRows(t, export.Content)
			assert.Equal(t, []string{"ID", "Work Item Type", "Title", "Steps"}, rows[0])
			require.Len(t, rows, len(itemTypes)+1)
			for index, itemType := range itemTypes {
				assert.Equal(t, strconv.Itoa(101+index), rows[index+1][0])
				assert.Equal(t, itemType, rows[index+1][1])
				if itemType == "Test Case" {
					require.Len(t, rows[index+1], 4)
					assert.Equal(
						t,
						"Step 1\nAction: Open composer\nExpected result: Composer is visible",
						rows[index+1][3],
					)
				}
			}
		})
	}
}

func TestExportSavedQueryFileKeepsSelectedDetailFields(t *testing.T) {
	fixture := &exportFileFixture{Types: []string{"Bug", "Task"}}
	server := exportFileServer(t, fixture)
	defer server.Close()
	connector := testConnector(t, server.URL)

	export, err := connector.ExportSavedQueryFile(
		context.Background(),
		"delegated",
		exportTestProject,
		testSavedQueryID,
		ExportOptions{ColumnOptions: []string{"System.Id", "System.WorkItemType", "System.Title", "System.AssignedTo"}},
	)

	require.NoError(t, err)
	rows := exportTestWorkbookRows(t, export.Content)
	assert.Equal(t, []string{"ID", "Work Item Type", "Title", "Assigned To"}, rows[0])
	assert.Equal(t, "Fixture User <fixture@example.invalid>", rows[1][3])
}

func TestExportSavedQueryFileIncludesSelectedDynamicFieldsAndAdapters(test *testing.T) {
	fixture := &exportFileFixture{Types: []string{"Test Case", "Bug", "Task"}}
	server := exportFileServer(test, fixture)
	defer server.Close()

	export, err := testConnector(test, server.URL).ExportSavedQueryFile(
		context.Background(),
		"delegated",
		exportTestProject,
		testSavedQueryID,
		ExportOptions{ColumnOptions: []string{
			"System.Id", "System.WorkItemType", "System.Title", exportStepsField,
			"Custom.Component", "Custom.Enabled", exportParametersField, exportDataSourceField,
		}},
	)

	require.NoError(test, err)
	rows := exportTestWorkbookRows(test, export.Content)
	require.Len(test, rows, 4)
	assert.Equal(test, []string{
		"ID", "Work Item Type", "Title", "Steps", "Component", "Enabled", "Parameters", "Local Data Source",
	}, rows[0])
	for _, row := range rows[1:] {
		require.Len(test, row, 8)
		assert.Equal(test, "Custom value", row[4])
		assert.Equal(test, "false", row[5])
		assert.Equal(test, `<parameters><param name="account"/></parameters>`, row[6])
		assert.Equal(test, `<NewDataSet><Table1><account>Fixture</account></Table1></NewDataSet>`, row[7])
	}
	assert.Equal(test, "Step 1\nAction: Open composer\nExpected result: Composer is visible", rows[1][3])
	assert.Empty(test, rows[2][3])
	assert.Equal(test, int32(1), fixture.QueryRuns.Load())
	assert.Equal(test, int32(1), fixture.ItemReads.Load())
}

func TestExportSavedQueryFileKeepsEditorStructuresInSingleCells(test *testing.T) {
	editorContent := `<table><tr><th>Environment</th><th>Outcome</th></tr>` +
		`<tr><td>Windows</td><td>Ready</td></tr></table><ol start="3"><li>Confirm</li></ol>`
	editorText := "Environment: Windows\nOutcome: Ready\n3. Confirm"
	parameters := `<?xml version="1.0" encoding="utf-16"?><parameters><param name="account"/></parameters>`
	fixture := &exportFileFixture{
		Types: []string{"Test Case"},
		Fields: []ExportField{
			{Name: "Editor content", ReferenceName: "Custom.Editor", Type: "html"},
		},
		FieldValues: map[string]any{
			"Custom.Editor":       editorContent,
			exportParametersField: parameters,
			exportStepsField: `<steps><step><parameterizedString>` + html.EscapeString(editorContent) +
				`</parameterizedString><parameterizedString>&lt;p&gt;Confirmed&lt;/p&gt;</parameterizedString>` +
				`</step></steps>`,
		},
	}
	server := exportFileServer(test, fixture)
	defer server.Close()

	export, err := testConnector(test, server.URL).ExportSavedQueryFile(
		context.Background(),
		"delegated",
		exportTestProject,
		testSavedQueryID,
		ExportOptions{ColumnOptions: []string{
			"System.Id",
			"System.WorkItemType",
			"System.Title",
			"Custom.Editor",
			exportStepsField,
			exportParametersField,
		}},
	)

	require.NoError(test, err)
	rows := exportTestWorkbookRows(test, export.Content)
	require.Len(test, rows, 2)
	assert.Equal(test, []string{"ID", "Work Item Type", "Title", "Editor content", "Steps", "Parameters"}, rows[0])
	require.Len(test, rows[1], 6)
	assert.Equal(test, editorText, rows[1][3])
	assert.Equal(test, "Step 1\nAction: "+editorText+"\nExpected result: Confirmed", rows[1][4])
	assert.Equal(test, parameters, rows[1][5])
	assert.Equal(test, 1, export.Count)
	assert.Equal(test, int32(1), fixture.QueryRuns.Load())
	assert.Equal(test, int32(1), fixture.ItemReads.Load())
}

func TestExportSavedQueryFileRejectsUnsupportedShapeAndInvalidOptions(t *testing.T) {
	for _, queryType := range []string{"tree", "oneHop"} {
		fixture := &exportFileFixture{Types: []string{"Bug"}, QueryType: queryType}
		server := exportFileServer(t, fixture)

		_, err := testConnector(t, server.URL).ExportSavedQueryFile(
			context.Background(),
			"delegated",
			exportTestProject,
			testSavedQueryID,
			ExportOptions{},
		)
		server.Close()

		assert.ErrorContains(t, err, "only flat saved queries")
		assert.Zero(t, fixture.ItemReads.Load())
	}

	_, err := testConnector(t, "https://provider.invalid").ExportSavedQueryFile(
		context.Background(),
		"delegated",
		exportTestProject,
		testSavedQueryID,
		ExportOptions{ColumnOptions: make([]string, 101)},
	)
	assert.ErrorContains(t, err, "at most 100")
}

func TestResolvedProjectIsReusedWithoutAnotherProjectRequest(test *testing.T) {
	for _, operation := range []string{"export", ContentKindQueryResults, ContentKindWorkItem} {
		test.Run(operation, func(test *testing.T) {
			ctx := context.Background()
			fixture := &exportFileFixture{Types: []string{"Bug"}, ContentQuery: operation != "export"}
			server := exportFileServer(test, fixture)
			defer server.Close()

			connector := testConnector(test, server.URL)
			project, err := connector.ResolveProject(ctx, "delegated", "profile-id", "org-id/project-id")
			require.NoError(test, err)
			require.Equal(test, int32(1), fixture.ProjectReads.Load())

			if operation == "export" {
				_, err = connector.ExportSavedQueryFile(
					ctx,
					"delegated",
					*project,
					testSavedQueryID,
					ExportOptions{
						ColumnOptions: []string{
							"System.Id",
							"System.WorkItemType",
							"System.Title",
						},
					},
				)
			} else {
				_, err = connector.QueryProjectContentPage(
					ctx,
					"delegated",
					*project,
					ContentQuery{
						Kind:       operation,
						QueryID:    testSavedQueryID,
						WorkItemID: 101,
						AsOf:       exportTestAsOf,
					},
				)
			}

			require.NoError(test, err)
			assert.Equal(test, int32(1), fixture.ProjectReads.Load())
		})
	}
}

func TestFlatExportIDsRejectsInvalidDuplicateAndOverLimitIDs(t *testing.T) {
	for _, ids := range [][]int64{{0}, {101, 101}, make([]int64, MaxExportWorkItems+1)} {
		result := &savedQueryResult{QueryType: "flat"}
		for _, id := range ids {
			result.WorkItems = append(result.WorkItems, savedWorkItemReference{ID: id})
		}

		_, err := flatExportIDs(result)
		assert.ErrorIs(t, err, ErrInvalidContentQuery)
	}
}

type exportFileFixture struct {
	Types        []string
	Fields       []ExportField
	FieldValues  map[string]any
	QueryType    string
	ContentQuery bool
	QueryRuns    atomic.Int32
	ItemReads    atomic.Int32
	ProjectReads atomic.Int32
}

func exportFileServer(t *testing.T, fixture *exportFileFixture) *httptest.Server {
	t.Helper()

	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer delegated", request.Header.Get("Authorization"))
		assert.Equal(t, http.MethodGet, request.Method)
		switch request.URL.Path {
		case "/_apis/accounts":
			_, _ = io.WriteString(response, `{"value":[{"accountId":"org-id","accountName":"office"}]}`)
		case "/office/project-id/_apis/wit/queries/" + testSavedQueryID:
			_ = json.NewEncoder(response).Encode(savedQueryDefinition{
				ID:   testSavedQueryID,
				Name: "Fixture query",
				Path: "Shared/Fixture",
			})
		case "/office/project-id/_apis/wit/wiql/" + testSavedQueryID:
			fixture.QueryRuns.Add(1)
			result := savedQueryResult{QueryType: fixture.QueryType, AsOf: exportTestAsOf}
			if result.QueryType == "" {
				result.QueryType = "flat"
			}

			for index := range fixture.Types {
				result.WorkItems = append(result.WorkItems, savedWorkItemReference{ID: int64(101 + index)})
			}
			_ = json.NewEncoder(response).Encode(result)
		case "/office/_apis/projects/project-id":
			fixture.ProjectReads.Add(1)
			_, _ = io.WriteString(response, `{"id":"project-id","name":"Project"}`)
		case "/office/project-id/_apis/wit/fields":
			catalog := append(exportTestCatalog(), fixture.Fields...)
			_ = json.NewEncoder(response).Encode(map[string]any{"value": catalog})
		case "/office/project-id/_apis/wit/workitems":
			fixture.ItemReads.Add(1)
			assert.Equal(t, exportTestAsOf, request.URL.Query().Get("asOf"))

			requiredFields := []string{"System.TeamProject"}
			if !fixture.ContentQuery {
				requiredFields = append(requiredFields, "System.Id", "System.WorkItemType", "System.Title")
			}
			for _, field := range requiredFields {
				assert.Contains(t, request.URL.Query().Get("fields"), field)
			}

			var items []savedWorkItem
			for index, itemType := range fixture.Types {
				item := exportTestWorkItem(int64(101+index), itemType)
				item.Fields["System.State"] = "Ready"
				item.Fields["Custom.Component"] = "Custom value"
				item.Fields["Custom.Enabled"] = false
				item.Fields[exportParametersField] = `<parameters><param name="account"/></parameters>`
				item.Fields[exportDataSourceField] = `<NewDataSet><Table1>` +
					`<account>Fixture</account></Table1></NewDataSet>`
				item.Fields["System.AssignedTo"] = map[string]any{
					"displayName": "Fixture User",
					"uniqueName":  "fixture@example.invalid",
				}
				if itemType == "Test Case" {
					item.Fields[exportStepsField] = `<steps><step>` +
						`<parameterizedString>Open composer</parameterizedString>` +
						`<parameterizedString>Composer is visible</parameterizedString></step></steps>`
				}
				for reference, value := range fixture.FieldValues {
					item.Fields[reference] = value
				}
				items = append(items, item)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"value": items})
		default:
			t.Errorf("unexpected export endpoint %s", request.URL.Path)
			http.NotFound(response, request)
		}
	}))
}

func exportTestWorkbookRows(test *testing.T, content []byte) [][]string {
	test.Helper()
	workbook, err := excelize.OpenReader(bytes.NewReader(content))
	require.NoError(test, err)
	test.Cleanup(func() { _ = workbook.Close() })
	rows, err := workbook.GetRows(workbook.GetSheetName(0))
	require.NoError(test, err)
	return rows
}
