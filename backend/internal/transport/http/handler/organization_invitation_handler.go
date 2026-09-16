package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	orgbiz "sico-backend/internal/biz/organization"
	"sico-backend/internal/transport/http/dto/organization"
	"sico-backend/internal/transport/http/middleware"
)

// CreateOrganizationInvitation creates a reusable organization invitation link.
// @Summary Create Organization Invitation
// @Router /api/sico/organization/invitations/create [POST]
// @Tags Organization
// @Accept json
// @Produce json
// @Param request body organization.CreateOrganizationInvitationRequest true "Create Organization Invitation"
// @Success 200 {object} organization.CreateOrganizationInvitationResponse
// @Security BearerAuth
func CreateOrganizationInvitation(ctx *gin.Context) {
	user, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.CreateOrganizationInvitationRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	resp, err := orgbiz.Default().CreateOrganizationInvitation(reqctx(ctx), &req, user.Name)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, resp)
}

// GetOrganizationInvitation returns active invitation and organization details.
// @Summary Get Organization Invitation
// @Router /api/sico/organization/invitations/detail [GET]
// @Tags Organization
// @Produce json
// @Param request query organization.GetOrganizationInvitationRequest true "Get Organization Invitation"
// @Success 200 {object} organization.GetOrganizationInvitationResponse
// @Security BearerAuth
func GetOrganizationInvitation(ctx *gin.Context) {
	if _, ok := middleware.GetUserFromContext(ctx); !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.GetOrganizationInvitationRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	resp, err := orgbiz.Default().GetOrganizationInvitation(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, resp)
}

// AcceptOrganizationInvitation adds the logged-in user to the invited organization.
// @Summary Accept Organization Invitation
// @Router /api/sico/organization/invitations/accept [POST]
// @Tags Organization
// @Accept json
// @Produce json
// @Param request body organization.AcceptOrganizationInvitationRequest true "Accept Organization Invitation"
// @Success 200 {object} organization.AcceptOrganizationInvitationResponse
// @Security BearerAuth
func AcceptOrganizationInvitation(ctx *gin.Context) {
	user, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.AcceptOrganizationInvitationRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	resp, err := orgbiz.Default().AcceptOrganizationInvitation(reqctx(ctx), &req, user.Name)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, resp)
}

// ListOrganizationInvitations lists invitations for the selected organization.
// @Summary List Organization Invitations
// @Router /api/sico/organization/invitations/list [GET]
// @Tags Organization
// @Produce json
// @Param request query organization.ListOrganizationInvitationsRequest true "List Organization Invitations"
// @Success 200 {object} organization.ListOrganizationInvitationsResponse
// @Security BearerAuth
func ListOrganizationInvitations(ctx *gin.Context) {
	if _, ok := middleware.GetUserFromContext(ctx); !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.ListOrganizationInvitationsRequest
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
	resp, err := orgbiz.Default().ListOrganizationInvitations(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, resp)
}

// RevokeOrganizationInvitation revokes an invitation for the selected organization.
// @Summary Revoke Organization Invitation
// @Router /api/sico/organization/invitations [DELETE]
// @Tags Organization
// @Accept json
// @Produce json
// @Param request body organization.RevokeOrganizationInvitationRequest true "Revoke Organization Invitation"
// @Success 200 {object} organization.RevokeOrganizationInvitationResponse
// @Security BearerAuth
func RevokeOrganizationInvitation(ctx *gin.Context) {
	if _, ok := middleware.GetUserFromContext(ctx); !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.RevokeOrganizationInvitationRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	resp, err := orgbiz.Default().RevokeOrganizationInvitation(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, resp)
}
