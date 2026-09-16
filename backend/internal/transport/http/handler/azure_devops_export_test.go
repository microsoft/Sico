package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	integrationsvc "sico-backend/internal/biz/integration"
	"sico-backend/internal/biz/integration/azuredevops"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
	"sico-backend/internal/transport/http/middleware"
)

type exportHandlerService struct {
	integrationsvc.Service
	export  *azuredevops.QueryExport
	request *integrationdto.ExportAzureDevOpsQueryRequest
	actor   string
}

func (service *exportHandlerService) ExportAzureDevOpsQuery(
	_ context.Context,
	req *integrationdto.ExportAzureDevOpsQueryRequest,
	actor string,
) (*azuredevops.QueryExport, error) {
	service.request, service.actor = req, actor
	return service.export, nil
}

func TestAzureDevOpsExportRequestRequiresSelectedColumns(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, columns := range [][]string{nil, {"System.Id"}, {"System.Id", "System.WorkItemType", "System.Title"}} {
		body := exportHandlerRequestBody(t, columns)
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(http.MethodPost, "/export", bytes.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		var req integrationdto.ExportAzureDevOpsQueryRequest
		err := ctx.ShouldBindJSON(&req)
		if len(columns) < 3 {
			assert.Error(t, err)
		} else {
			require.NoError(t, err)
			assert.Equal(t, columns, req.ColumnOptions)
		}
	}
}

func TestAzureDevOpsExportDownloadUsesFileMetadataAndSource(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := &exportHandlerService{export: &azuredevops.QueryExport{
		Content:      []byte("XLSX fixture"),
		FileName:     "ado-query-fixture.xlsx",
		ContentType:  azuredevops.XLSXContentType,
		FileExt:      "xlsx",
		ExportSource: "work_items",
		Count:        1,
		QueryAsOf:    "2026-09-07T00:00:00Z",
	}}
	recorder := httptest.NewRecorder()
	ctx, engine := gin.CreateTestContext(recorder)
	engine.ContextWithFallback = true
	columns := []string{"System.Id", "System.WorkItemType", "System.Title", "Microsoft.VSTS.TCM.Steps"}
	body := exportHandlerRequestBody(t, columns)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/export", bytes.NewReader(body))
	ctx.Request = ctx.Request.WithContext(context.WithValue(
		ctx.Request.Context(), middleware.ContextUserKey, middleware.UserInfo{Name: "exporter"},
	))
	ctx.Request.Header.Set("Content-Type", "application/json")
	exportAzureDevOpsQuery(ctx, service)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, azuredevops.XLSXContentType, recorder.Header().Get("Content-Type"))
	assert.Equal(t, "work_items", recorder.Header().Get("X-ADO-Export-Source"))
	assert.Equal(t, "1", recorder.Header().Get("X-ADO-Work-Item-Count"))
	assert.Equal(t, service.export.QueryAsOf, recorder.Header().Get("X-ADO-Query-As-Of"))
	assert.Contains(t, recorder.Header().Get("Content-Disposition"), service.export.FileName)
	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	assert.Equal(t, service.export.Content, recorder.Body.Bytes())
	require.NotNil(t, service.request)
	assert.Equal(t, columns, service.request.ColumnOptions)
	assert.Equal(t, int64(100), service.request.SicoProjectId)
	assert.Equal(t, "resource", service.request.ResourceKey)
	assert.Equal(t, "connection", service.request.ConnectionKey)
	assert.Equal(t, "exporter", service.actor)
}

func exportHandlerRequestBody(t *testing.T, columns []string) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"connectionKey": "connection",
		"sicoProjectId": 100,
		"resourceKey":   "resource",
		"queryId":       "11111111-1111-4111-8111-111111111111",
		"columnOptions": columns,
	})
	require.NoError(t, err)
	return body
}
