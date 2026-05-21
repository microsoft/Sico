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
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	rbacbiz "sico-backend/internal/biz/rbac"
	rbacCommon "sico-backend/internal/transport/http/dto/rbac/common"
	"sico-backend/internal/transport/http/dto/rbac/token"
	"sico-backend/internal/transport/http/dto/rbac/user"
	"sico-backend/internal/transport/http/middleware"
)

// CreateUser creates a new user
// @Router /api/sico/rbac/user [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body user.CreateUserRequest true "Create user request"
// @Success 200 {object} user.CreateUserResponse
func CreateUser(ctx *gin.Context) {
	var req user.CreateUserRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	splitEmail := strings.Split(req.Email, "@")
	if len(splitEmail) != 2 {
		invalidParamRequestResponse(ctx, "invalid email format")
		return
	}
	req.Alias = splitEmail[0]
	req.Username = req.Email

	resp, err := rbacbiz.Default().CreateUser(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateUser updates an existing user
// @Router /api/sico/rbac/user [PUT]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body user.UpdateUserRequest true "Update user request"
// @Success 200 {object} user.UpdateUserResponse
// @Security BearerAuth
func UpdateUser(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user.UpdateUserRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().UpdateUser(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteUser deletes a user
// @Router /api/sico/rbac/user [DELETE]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query user.DeleteUserRequest true "Delete user request"
// @Success 200 {object} user.DeleteUserResponse
// @Security BearerAuth
func DeleteUser(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user.DeleteUserRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().DeleteUser(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetUser gets a single user
// @Router /api/sico/rbac/user [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query user.GetUserRequest true "Get user request"
// @Success 200 {object} user.GetUserResponse
// @Security BearerAuth
func GetUser(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user.GetUserRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().GetUser(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// QueryUsers queries users with pagination
// @Router /api/sico/rbac/users [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query user.QueryUsersRequest true "Query users request"
// @Success 200 {object} user.QueryUsersResponse
// @Security BearerAuth
func QueryUsers(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user.QueryUsersRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	statusParts := strings.Split(req.GetStatusList(), ",")
	for _, part := range statusParts {
		if status, err := strconv.Atoi(strings.TrimSpace(part)); err == nil {
			req.StatusArr = append(req.StatusArr, rbacCommon.UserStatus(status))
		}
	}

	// Set default values
	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 10
	}

	resp, err := rbacbiz.Default().QueryUsers(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ResetPassword resets user password
// @Router /api/sico/rbac/user/password [PUT]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body user.ResetPasswordRequest true "Reset password request"
// @Success 200 {object} user.ResetPasswordResponse
// @Security BearerAuth
func ResetPassword(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user.ResetPasswordRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().ResetPassword(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// Login authenticates user and returns JWT token
// @Router /api/sico/rbac/login [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body token.LoginRequest true "Login request"
// @Success 200 {object} token.LoginResponse
func Login(ctx *gin.Context) {
	var req token.LoginRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := rbacbiz.Default().Login(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	// Set token in response header
	if resp != nil && resp.Data != nil && resp.Data.TokenInfo != nil && len(resp.Data.TokenInfo.AccessToken) > 0 {
		ctx.Header("Authorization", "Bearer "+(resp.Data.TokenInfo.AccessToken))
	}

	ctx.JSON(http.StatusOK, resp)
}

// Logout invalidates the current JWT token
// @Router /api/sico/rbac/logout [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Success 200 {object} token.LogoutResponse
// @Security BearerAuth
func Logout(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	authHeader := ctx.GetHeader("Authorization")
	if authHeader == "" {
		unauthorizedResponse(ctx, "No authorization header")
		return
	}
	userToken := strings.TrimPrefix(authHeader, "Bearer ")

	resp, err := rbacbiz.Default().Logout(reqctx(ctx), userToken)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// RefreshToken refreshes the JWT token
// @Router /api/sico/rbac/refresh [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body token.RefreshTokenRequest true "Refresh token request"
// @Success 200 {object} token.RefreshTokenResponse
// @Security BearerAuth
func RefreshToken(ctx *gin.Context) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	authHeader := ctx.GetHeader("Authorization")
	if authHeader == "" {
		unauthorizedResponse(ctx, "No authorization header")
		return
	}
	userToken := strings.TrimPrefix(authHeader, "Bearer ")

	resp, err := rbacbiz.Default().RefreshToken(reqctx(ctx), userToken, &userInfo)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	// Set token in response header
	if resp != nil && resp.Data != nil && resp.Data.TokenInfo != nil && len(resp.Data.TokenInfo.AccessToken) > 0 {
		ctx.Header("Authorization", "Bearer "+(resp.Data.TokenInfo.AccessToken))
	}

	ctx.JSON(http.StatusOK, resp)
}
