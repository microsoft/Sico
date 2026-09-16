package azuredevops

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadExportSharedStepsBoundsDependenciesAndBatchSize(t *testing.T) {
	for _, count := range []int{1000, 1001} {
		var requests atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			requests.Add(1)
			assert.Equal(t, http.MethodGet, request.Method)
			assert.Equal(t, exportTestAsOf, request.URL.Query().Get("asOf"))
			ids := strings.Split(request.URL.Query().Get("ids"), ",")
			assert.LessOrEqual(t, len(ids), 200)
			items := make([]savedWorkItem, 0, len(ids))
			for _, value := range ids {
				id, err := strconv.ParseInt(value, 10, 64)
				assert.NoError(t, err)
				item := exportTestWorkItem(id, "Shared Steps")
				item.Fields[exportStepsField] = "<steps/>"
				items = append(items, item)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"value": items})
		}))
		nodes := make([]exportStepNode, count)
		for index := range nodes {
			nodes[index] = exportStepNode{XMLName: xml.Name{Local: "compref"}, Reference: strconv.Itoa(201 + index)}
		}
		shared, err := testConnector(t, server.URL).readExportSharedSteps(
			context.Background(), "delegated", "office", "project-id", "Project", exportTestAsOf,
			map[int64][]exportStepNode{101: nodes},
		)
		server.Close()
		if count == 1000 {
			require.NoError(t, err)
			assert.Len(t, shared, 1000)
			assert.Equal(t, int32(5), requests.Load())
		} else {
			assert.ErrorContains(t, err, "1000-dependency")
			assert.Nil(t, shared)
			assert.Zero(t, requests.Load())
		}
	}
}

func TestExportSharedGraphBoundsDepthEvenWhenAllReferencesAreLoaded(t *testing.T) {
	for _, depth := range []int{8, 9} {
		shared := make(map[string][]exportStepNode)
		for index := 0; index < depth; index++ {
			var nodes []exportStepNode
			if index+1 < depth {
				nodes = []exportStepNode{{
					XMLName: xml.Name{Local: "compref"}, Reference: strconv.Itoa(202 + index),
				}}
			}
			shared[strconv.Itoa(201+index)] = nodes
		}
		err := validateExportSharedGraph(shared)
		if depth == 8 {
			require.NoError(t, err)
		} else {
			assert.ErrorContains(t, err, "8-level")
		}
	}
}
