package azuredevops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const exportTestAsOf = "2026-09-07T00:00:00Z"

func TestReadExportWorkItemsBatchesAndOrdersAll5000IDs(t *testing.T) {
	var requests, active, peak atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		current := active.Add(1)
		defer active.Add(-1)
		for previous := peak.Load(); current > previous; previous = peak.Load() {
			if peak.CompareAndSwap(previous, current) {
				break
			}
		}
		assert.Equal(t, http.MethodGet, request.Method)
		assert.Equal(t, exportTestAsOf, request.URL.Query().Get("asOf"))
		assert.Equal(t, "System.TeamProject,System.WorkItemType,Custom.Component", request.URL.Query().Get("fields"))
		ids := strings.Split(request.URL.Query().Get("ids"), ",")
		assert.LessOrEqual(t, len(ids), 200)
		items := make([]savedWorkItem, 0, len(ids))
		for index := len(ids) - 1; index >= 0; index-- {
			id, err := strconv.ParseInt(ids[index], 10, 64)
			assert.NoError(t, err)
			items = append(items, exportTestWorkItem(id, "Bug"))
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"value": items})
	}))
	defer server.Close()
	ids := make([]int64, MaxExportWorkItems)
	for index := range ids {
		ids[index] = int64(index + 1)
	}
	items, err := testConnector(t, server.URL).readExportWorkItems(
		context.Background(), "delegated", "office", "project-id", "Project", exportTestAsOf, ids,
		[]string{"System.TeamProject", "System.WorkItemType", "Custom.Component"},
	)
	require.NoError(t, err)
	require.Len(t, items, MaxExportWorkItems)
	for index, item := range items {
		assert.Equal(t, ids[index], item.ID)
	}
	assert.Equal(t, int32(25), requests.Load())
	assert.LessOrEqual(t, peak.Load(), int32(4))
}

func TestReadExportWorkItemsRejectsInvalidLastBatch(t *testing.T) {
	for _, defect := range []string{"missing", "duplicate", "foreign", "unexpected", "missing project", "missing type"} {
		t.Run(defect, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				var items []savedWorkItem
				for _, value := range strings.Split(request.URL.Query().Get("ids"), ",") {
					id, err := strconv.ParseInt(value, 10, 64)
					assert.NoError(t, err)
					item := exportTestWorkItem(id, "Bug")
					if id == 201 {
						switch defect {
						case "missing":
							continue
						case "duplicate":
							items = append(items, item)
						case "foreign":
							item.Fields["System.TeamProject"] = "Foreign"
						case "unexpected":
							item.ID = 999
						case "missing project":
							delete(item.Fields, "System.TeamProject")
						case "missing type":
							delete(item.Fields, "System.WorkItemType")
						}
					}
					items = append(items, item)
				}
				_ = json.NewEncoder(response).Encode(map[string]any{"value": items})
			}))
			defer server.Close()
			ids := make([]int64, 201)
			for index := range ids {
				ids[index] = int64(index + 1)
			}
			items, err := testConnector(t, server.URL).readExportWorkItems(
				context.Background(), "delegated", "office", "project-id", "Project", exportTestAsOf, ids,
				[]string{"System.TeamProject", "System.WorkItemType"},
			)
			assert.ErrorIs(t, err, ErrInvalidContentQuery)
			assert.Nil(t, items)
		})
	}
}

func TestReadExportSharedStepsValidatesSnapshotAndDependencies(t *testing.T) {
	for _, defect := range []string{"", "foreign", "cycle", "inaccessible", "wrong type"} {
		t.Run(defect, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				assert.Equal(t, http.MethodGet, request.Method)
				assert.Equal(t, "201", request.URL.Query().Get("ids"))
				assert.Equal(t, exportTestAsOf, request.URL.Query().Get("asOf"))
				for _, field := range []string{
					exportStepsField, "System.WorkItemType", "System.TeamProject",
				} {
					assert.Contains(t, request.URL.Query().Get("fields"), field)
				}
				item := exportTestWorkItem(201, "Shared Steps")
				item.Fields[exportStepsField] = `<steps><step>` +
					`<parameterizedString>Shared @value</parameterizedString>` +
					`<parameterizedString/></step></steps>`
				switch defect {
				case "foreign":
					item.Fields["System.TeamProject"] = "Foreign"
				case "cycle":
					item.Fields[exportStepsField] = `<steps><compref ref="201"/></steps>`
				case "inaccessible":
					http.Error(response, "not allowed", http.StatusForbidden)
					return
				case "wrong type":
					item.Fields["System.WorkItemType"] = "Test Case"
				}
				_ = json.NewEncoder(response).Encode(map[string]any{"value": []savedWorkItem{item}})
			}))
			defer server.Close()
			nodes, err := parseExportSteps(`<steps><compref ref="201"/><compref ref="201"/></steps>`)
			require.NoError(t, err)
			shared, err := testConnector(t, server.URL).readExportSharedSteps(
				context.Background(), "delegated", "office", "project-id", "Project", exportTestAsOf,
				map[int64][]exportStepNode{101: nodes},
			)
			if defect != "" {
				require.Error(t, err)
				assert.Nil(t, shared)
				return
			}
			require.NoError(t, err)
			steps, err := exportSteps(nodes, shared, "", map[string]bool{})
			require.NoError(t, err)
			require.Len(t, steps, 2)
			assert.Equal(t, "201", steps[1].SharedID)
			assert.Equal(t, "Shared @value", steps[1].Action)
		})
	}
}

func exportTestWorkItem(id int64, workItemType string) savedWorkItem {
	return savedWorkItem{ID: id, Fields: map[string]any{
		"System.TeamProject": "Project", "System.WorkItemType": workItemType,
		"System.Title": "Item " + strconv.FormatInt(id, 10),
	}}
}
