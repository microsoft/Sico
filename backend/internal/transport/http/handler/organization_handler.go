// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req organization.CreateOrganizationRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := orgbiz.Default().CreateOrganization(reqctx(ctx), &req)
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
