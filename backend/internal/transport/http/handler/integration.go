package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	integrationsvc "sico-backend/internal/biz/integration"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
	"sico-backend/internal/transport/http/middleware"
)

// CreateIntegrationConnection creates a provider connection.
// @Router /api/sico/integrations/connections [post]
// @Tags Integration
// @Accept json
// @Produce json
// @Param request body integrationdto.CreateConnectionRequest true "Create connection request"
// @Success 200 {object} integrationdto.CreateConnectionResponse
// @Security BearerAuth
func CreateIntegrationConnection(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.CreateConnectionRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := integrationsvc.Default().CreateConnection(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetIntegrationConnection gets a provider connection.
// @Router /api/sico/integrations/connections/{connectionKey} [get]
// @Tags Integration
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Success 200 {object} integrationdto.GetConnectionResponse
// @Security BearerAuth
func GetIntegrationConnection(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	resp, err := integrationsvc.Default().GetConnection(
		reqctx(ctx), ctx.Param("connectionKey"), actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListIntegrationConnections lists connections visible to the current user.
// @Router /api/sico/integrations/connections [get]
// @Tags Integration
// @Produce json
// @Param request query integrationdto.ListConnectionsRequest true "Connection filters"
// @Success 200 {object} integrationdto.ListConnectionsResponse
// @Security BearerAuth
func ListIntegrationConnections(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ListConnectionsRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := integrationsvc.Default().ListConnections(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateIntegrationConnection updates mutable provider connection fields.
// @Router /api/sico/integrations/connections/{connectionKey} [put]
// @Tags Integration
// @Accept json
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Param request body integrationdto.UpdateConnectionRequest true "Update connection request"
// @Success 200 {object} integrationdto.UpdateConnectionResponse
// @Security BearerAuth
func UpdateIntegrationConnection(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.UpdateConnectionRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := integrationsvc.Default().UpdateConnection(
		reqctx(ctx), ctx.Param("connectionKey"), &req, actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteIntegrationConnection revokes and soft-deletes a provider connection.
// @Router /api/sico/integrations/connections/{connectionKey} [delete]
// @Tags Integration
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Success 200 {object} integrationdto.DeleteConnectionResponse
// @Security BearerAuth
func DeleteIntegrationConnection(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	resp, err := integrationsvc.Default().DeleteConnection(
		reqctx(ctx), ctx.Param("connectionKey"), actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// CreateIntegrationBinding creates or reactivates a scope-to-resource binding.
// @Router /api/sico/integrations/connections/{connectionKey}/bindings [post]
// @Tags Integration
// @Accept json
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Param request body integrationdto.CreateBindingRequest true "Create binding request"
// @Success 200 {object} integrationdto.CreateBindingResponse
// @Security BearerAuth
func CreateIntegrationBinding(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.CreateBindingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := integrationsvc.Default().CreateBinding(
		reqctx(ctx), ctx.Param("connectionKey"), &req, actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetIntegrationBinding gets a connection binding.
// @Router /api/sico/integrations/connections/{connectionKey}/bindings/{bindingId} [get]
// @Tags Integration
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Param bindingId path int true "Binding ID"
// @Success 200 {object} integrationdto.GetBindingResponse
// @Security BearerAuth
func GetIntegrationBinding(ctx *gin.Context) {
	actor, bindingID, ok := integrationBindingParams(ctx)
	if !ok {
		return
	}

	resp, err := integrationsvc.Default().GetBinding(
		reqctx(ctx), ctx.Param("connectionKey"), bindingID, actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListIntegrationBindings lists a connection's bindings.
// @Router /api/sico/integrations/connections/{connectionKey}/bindings [get]
// @Tags Integration
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Param request query integrationdto.ListBindingsRequest true "Binding filters"
// @Success 200 {object} integrationdto.ListBindingsResponse
// @Security BearerAuth
func ListIntegrationBindings(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ListBindingsRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := integrationsvc.Default().ListBindings(
		reqctx(ctx), ctx.Param("connectionKey"), &req, actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateIntegrationBinding updates binding status.
// @Router /api/sico/integrations/connections/{connectionKey}/bindings/{bindingId} [put]
// @Tags Integration
// @Accept json
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Param bindingId path int true "Binding ID"
// @Param request body integrationdto.UpdateBindingRequest true "Update binding request"
// @Success 200 {object} integrationdto.UpdateBindingResponse
// @Security BearerAuth
func UpdateIntegrationBinding(ctx *gin.Context) {
	actor, bindingID, ok := integrationBindingParams(ctx)
	if !ok {
		return
	}

	var req integrationdto.UpdateBindingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := integrationsvc.Default().UpdateBinding(
		reqctx(ctx), ctx.Param("connectionKey"), bindingID, &req, actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteIntegrationBinding soft-deletes a connection binding.
// @Router /api/sico/integrations/connections/{connectionKey}/bindings/{bindingId} [delete]
// @Tags Integration
// @Produce json
// @Param connectionKey path string true "Connection key"
// @Param bindingId path int true "Binding ID"
// @Success 200 {object} integrationdto.DeleteBindingResponse
// @Security BearerAuth
func DeleteIntegrationBinding(ctx *gin.Context) {
	actor, bindingID, ok := integrationBindingParams(ctx)
	if !ok {
		return
	}

	resp, err := integrationsvc.Default().DeleteBinding(
		reqctx(ctx), ctx.Param("connectionKey"), bindingID, actor,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

func integrationActor(ctx *gin.Context) (string, bool) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return "", false
	}

	return userInfo.Name, true
}

func integrationBindingParams(ctx *gin.Context) (string, int64, bool) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return "", 0, false
	}

	bindingID, err := strconv.ParseInt(strings.TrimSpace(ctx.Param("bindingId")), 10, 64)
	if err != nil || bindingID <= 0 {
		invalidParamRequestResponse(ctx, "bindingId must be a positive integer")
		return "", 0, false
	}

	return actor, bindingID, true
}
