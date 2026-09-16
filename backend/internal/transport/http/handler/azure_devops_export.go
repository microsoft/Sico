package handler

import (
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	integrationsvc "sico-backend/internal/biz/integration"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

// ListAzureDevOpsExportFields reads dynamic work item fields grouped by detail-view membership.
// @Router /api/sico/integrations/azure-devops/content/export-fields [post]
// @Tags Azure DevOps Integration
// @Accept json
// @Produce json
// @Param request body integrationdto.ListAzureDevOpsExportFieldsRequest true "Selected project field catalog"
// @Success 200 {object} integrationdto.ListAzureDevOpsExportFieldsResponse
// @Security BearerAuth
func ListAzureDevOpsExportFields(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ListAzureDevOpsExportFieldsRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	response, err := integrationsvc.Default().ListAzureDevOpsExportFields(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, response)
}

// ExportAzureDevOpsQuery downloads one work item per XLSX row with the selected columns.
// @Router /api/sico/integrations/azure-devops/content/export [post]
// @Tags Azure DevOps Integration
// @Accept json
// @Produce application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
// @Param request body integrationdto.ExportAzureDevOpsQueryRequest true "Saved query and selected columns"
// @Success 200 {file} binary "XLSX workbook"
// @Security BearerAuth
func ExportAzureDevOpsQuery(ctx *gin.Context) {
	exportAzureDevOpsQuery(ctx, integrationsvc.Default())
}

func exportAzureDevOpsQuery(ctx *gin.Context, service integrationsvc.Service) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ExportAzureDevOpsQueryRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	export, err := service.ExportAzureDevOpsQuery(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": export.FileName}))
	ctx.Header("Cache-Control", "no-store")
	ctx.Header("X-Content-Type-Options", "nosniff")
	ctx.Header("X-ADO-Work-Item-Count", strconv.Itoa(export.Count))
	ctx.Header("X-ADO-Query-As-Of", export.QueryAsOf)
	ctx.Header("X-ADO-Export-Source", export.ExportSource)

	ctx.Data(http.StatusOK, export.ContentType, export.Content)
}

// ImportAzureDevOpsKnowledge creates a project Knowledge FILE snapshot from an ADO query export.
// @Router /api/sico/integrations/azure-devops/content/import-knowledge [post]
// @Tags Azure DevOps Integration
// @Accept json
// @Produce json
// @Param request body integrationdto.ImportAzureDevOpsKnowledgeRequest true "Confirmed XLSX snapshot import"
// @Success 200 {object} integrationdto.ImportAzureDevOpsKnowledgeResponse
// @Security BearerAuth
func ImportAzureDevOpsKnowledge(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ImportAzureDevOpsKnowledgeRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	response, err := integrationsvc.Default().ImportAzureDevOpsKnowledge(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, response)
}
