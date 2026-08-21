package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	orgbiz "sico-backend/internal/biz/organization"
	"sico-backend/internal/transport/http/dto/organization"
	"sico-backend/internal/transport/http/middleware"
)

// CreateOrganization creates a new organization
// @Summary Create Organization
// @Router /api/sico/organization [POST]
// @Tags Organization
// @Accept json
// @Produce json
// @Param request body organization.CreateOrganizationRequest true "Create Organization"
// @Success 200 {object} organization.CreateOrganizationResponse
// @Security BearerAuth
func CreateOrganization(ctx *gin.Context) {
	user, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.CreateOrganizationRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := orgbiz.Default().CreateOrganization(reqctx(ctx), &req, user.Name)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetUserOrganizationList gets organizations for the logged-in user.
// @Summary Get User Organization List
// @Router /api/sico/organization/user_organizations [GET]
// @Tags Organization
// @Produce json
// @Param request query organization.GetUserOrganizationListRequest true "Get User Organization List"
// @Success 200 {object} organization.GetUserOrganizationListResponse
// @Security BearerAuth
func GetUserOrganizationList(ctx *gin.Context) {
	user, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.GetUserOrganizationListRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 10
	}
	req.Username = user.Name

	resp, err := orgbiz.Default().GetUserOrganizationList(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateOrganization updates an existing organization
// @Summary Update Organization
// @Router /api/sico/organization [PUT]
// @Tags Organization
// @Accept json
// @Produce json
// @Param request body organization.UpdateOrganizationRequest true "Update Organization"
// @Success 200 {object} organization.UpdateOrganizationResponse
// @Security BearerAuth
func UpdateOrganization(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.UpdateOrganizationRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := orgbiz.Default().UpdateOrganization(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteOrganization deletes an organization
// @Summary Delete Organization
// @Router /api/sico/organization [DELETE]
// @Tags Organization
// @Produce json
// @Param id query int64 true "Organization ID"
// @Success 200 {object} organization.DeleteOrganizationResponse
// @Security BearerAuth
func DeleteOrganization(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.DeleteOrganizationRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := orgbiz.Default().DeleteOrganization(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetOrganization fetches organization details
// @Summary Get Organization
// @Router /api/sico/organization [GET]
// @Tags Organization
// @Produce json
// @Param id query int64 true "Organization ID"
// @Success 200 {object} organization.GetOrganizationResponse
// @Security BearerAuth
func GetOrganization(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.GetOrganizationRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := orgbiz.Default().GetOrganization(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListOrganizations lists organizations with pagination
// @Summary List Organizations
// @Router /api/sico/organizations [GET]
// @Tags Organization
// @Produce json
// @Param request query organization.ListOrganizationsRequest true "List Organizations"
// @Success 200 {object} organization.ListOrganizationsResponse
// @Security BearerAuth
func ListOrganizations(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.ListOrganizationsRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 10
	}

	resp, err := orgbiz.Default().ListOrganizations(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
