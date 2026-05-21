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
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/internal/transport/http/middleware"
)

// AssignUserRole assigns a role to a user
// @Summary Assign User Role
// @Router /api/sico/rbac/user_role [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body user_role.AssignUserRoleRequest true "Assign User Role"
// @Success 200 {object} user_role.AssignUserRoleResponse
// @Security BearerAuth
func AssignUserRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.AssignUserRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().AssignUserRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// RemoveUserRole removes a role from a user
// @Summary Remove User Role
// @Router /api/sico/rbac/user_role [DELETE]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body user_role.RemoveUserRoleRequest true "Remove User Role"
// @Success 200 {object} user_role.RemoveUserRoleResponse
// @Security BearerAuth
func RemoveUserRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.RemoveUserRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().RemoveUserRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListUserRoles lists roles owned by a user
// @Summary List User Roles
// @Router /api/sico/rbac/user_roles [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query user_role.ListUserRolesRequest true "List User Roles"
// @Success 200 {object} user_role.ListUserRolesResponse
// @Security BearerAuth
func ListUserRoles(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.ListUserRolesRequest
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

	resp, err := rbacbiz.Default().ListUserRoles(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListUsersByRole lists users bound to a role
// @Summary List Users By Role
// @Router /api/sico/rbac/role_users [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query user_role.ListUsersByRoleRequest true "List Users By Role"
// @Success 200 {object} user_role.ListUsersByRoleResponse
// @Security BearerAuth
func ListUsersByRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.ListUsersByRoleRequest
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

	resp, err := rbacbiz.Default().ListUsersByRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
