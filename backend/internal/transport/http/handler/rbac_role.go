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

	rbacbiz "sico-backend/internal/biz/rbac"
	"sico-backend/internal/transport/http/dto/rbac/role"
	"sico-backend/internal/transport/http/middleware"
)

// CreateRole creates a new role
// @Summary Create Role
// @Router /api/sico/rbac/role [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body role.CreateRoleRequest true "Create Role"
// @Success 200 {object} role.CreateRoleResponse
// @Security BearerAuth
func CreateRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req role.CreateRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().CreateRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateRole updates an existing role
// @Summary Update Role
// @Router /api/sico/rbac/role [PUT]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body role.UpdateRoleRequest true "Update Role"
// @Success 200 {object} role.UpdateRoleResponse
// @Security BearerAuth
func UpdateRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req role.UpdateRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().UpdateRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteRole deletes a role
// @Summary Delete Role
// @Router /api/sico/rbac/role [DELETE]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query role.DeleteRoleRequest true "Delete Role"
// @Success 200 {object} role.DeleteRoleResponse
// @Security BearerAuth
func DeleteRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req role.DeleteRoleRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().DeleteRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetRole returns a role by ID
// @Summary Get Role
// @Router /api/sico/rbac/role [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query role.GetRoleRequest true "Get Role"
// @Success 200 {object} role.GetRoleResponse
// @Security BearerAuth
func GetRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req role.GetRoleRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().GetRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// QueryRoles queries roles list with pagination
// @Summary Query Roles
// @Router /api/sico/rbac/roles [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query role.QueryRolesRequest true "Query Roles"
// @Success 200 {object} role.QueryRolesResponse
// @Security BearerAuth
func QueryRoles(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req role.QueryRolesRequest
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
	resp, err := rbacbiz.Default().QueryRoles(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
