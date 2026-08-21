package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	authStateBiz "sico-backend/internal/biz/authstate"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/transport/http/dto/authstate"
)

func authStateService(ctx *gin.Context) (authStateBiz.Service, bool) {
	service := authStateBiz.Default()
	if service == nil {
		internalServerErrorResponse(ctx, apperr.New(errcode.CommonUnavailable, "auth state service not initialized"))
		return nil, false
	}

	return service, true
}

// ImportAuthState .
// @Router /api/sico/auth-state/import [POST]
// @Tags auth-state
// @Accept json
// @Produce json
// @Param request body authstate.ImportAuthStateRequest true "Import Auth State"
// @Success 200 {object} authstate.ImportAuthStateResponse
func ImportAuthState(ctx *gin.Context) {
	var req authstate.ImportAuthStateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	service, ok := authStateService(ctx)
	if !ok {
		return
	}

	resp, err := service.ImportAuthState(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetAuthState .
// @Router /api/sico/auth-state [GET]
// @Tags auth-state
// @Produce json
// @Param request query authstate.GetAuthStateRequest true "Get Auth State"
// @Success 200 {object} authstate.GetAuthStateResponse
// @Security BearerAuth
func GetAuthState(ctx *gin.Context) {
	var req authstate.GetAuthStateRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	service, ok := authStateService(ctx)
	if !ok {
		return
	}

	resp, err := service.GetAuthState(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateAuthStateStatus .
// @Router /api/sico/auth-state/status [POST]
// @Tags auth-state
// @Accept json
// @Produce json
// @Param request body authstate.UpdateAuthStateStatusRequest true "Update Auth State Status"
// @Success 200 {object} authstate.UpdateAuthStateStatusResponse
// @Security BearerAuth
func UpdateAuthStateStatus(ctx *gin.Context) {
	var req authstate.UpdateAuthStateStatusRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	service, ok := authStateService(ctx)
	if !ok {
		return
	}

	resp, err := service.UpdateAuthStateStatus(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
