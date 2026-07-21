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
	"sico-backend/internal/transport/http/dto/rbac/casbin_rule"
	"sico-backend/internal/transport/http/middleware"
)

// CreatePolicy creates a policy
// @Summary Create Policy
// @Router /api/sico/rbac/policy [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body casbin_rule.CreatePolicyRequest true "Create Policy"
// @Success 200 {object} casbin_rule.CreatePolicyResponse
// @Security BearerAuth
func CreatePolicy(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req casbin_rule.CreatePolicyRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().CreatePolicy(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdatePolicy updates a policy
// @Summary Update Policy
// @Router /api/sico/rbac/policy [PUT]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body casbin_rule.UpdatePolicyRequest true "Update Policy"
// @Success 200 {object} casbin_rule.UpdatePolicyResponse
// @Security BearerAuth
func UpdatePolicy(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req casbin_rule.UpdatePolicyRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().UpdatePolicy(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeletePolicy deletes a policy
// @Summary Delete Policy
// @Router /api/sico/rbac/policy [DELETE]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query casbin_rule.DeletePolicyRequest true "Delete Policy"
// @Success 200 {object} casbin_rule.DeletePolicyResponse
// @Security BearerAuth
func DeletePolicy(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req casbin_rule.DeletePolicyRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().DeletePolicy(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetPolicy returns a policy by ID
// @Summary Get Policy
// @Router /api/sico/rbac/policy [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query casbin_rule.GetPolicyRequest true "Get Policy"
// @Success 200 {object} casbin_rule.GetPolicyResponse
// @Security BearerAuth
func GetPolicy(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req casbin_rule.GetPolicyRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().GetPolicy(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// QueryPolicies queries policies list with pagination
// @Summary Query Policies
// @Router /api/sico/rbac/policies [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query casbin_rule.QueryPoliciesRequest true "Query Policies"
// @Success 200 {object} casbin_rule.QueryPoliciesResponse
// @Security BearerAuth
func QueryPolicies(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req casbin_rule.QueryPoliciesRequest
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

	resp, err := rbacbiz.Default().QueryPolicies(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ReloadEnforcer reloads all Casbin policies from the database into the in-memory enforcer.
// @Summary Reload Casbin Enforcer
// @Router /api/sico/rbac/enforcer/reload [POST]
// @Tags RBAC
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Security BearerAuth
func ReloadEnforcer(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	if err := rbacbiz.Default().ReloadEnforcer(reqctx(ctx)); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"code": 0, "msg": "enforcer reloaded"})
}
