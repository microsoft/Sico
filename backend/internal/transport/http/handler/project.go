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

	projectSVC "sico-backend/internal/biz/project"
	"sico-backend/internal/transport/http/dto/project"
	"sico-backend/internal/transport/http/middleware"
)

// CreateProject creates a new project
// @Router /api/sico/project [POST]
// @Tags Project
// @Accept json
// @Produce json
// @Param request body project.CreateProjectRequest true "Create project request"
// @Success 200 {object} project.CreateProjectResponse
// @Security BearerAuth
func CreateProject(ctx *gin.Context) {
	var (
		err error
		req project.CreateProjectRequest
	)

	// Check if user is authenticated and get user info
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().CreateProject(reqctx(ctx), &req, userInfo.Name)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateProject updates an existing project
// @Router /api/sico/project [PUT]
// @Tags Project
// @Accept json
// @Produce json
// @Param request body project.UpdateProjectRequest true "Update project request"
// @Success 200 {object} project.UpdateProjectResponse
// @Security BearerAuth
func UpdateProject(ctx *gin.Context) {
	var (
		err error
		req project.UpdateProjectRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().UpdateProject(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteProject deletes a project
// @Router /api/sico/project [DELETE]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.DeleteProjectRequest true "Delete project request"
// @Success 200 {object} project.DeleteProjectResponse
// @Security BearerAuth
func DeleteProject(ctx *gin.Context) {
	var (
		err error
		req project.DeleteProjectRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().DeleteProject(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListProjects lists projects with optional filters
// @Router /api/sico/project/list [GET]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.ListProjectFilter true "List projects filter"
// @Success 200 {object} project.ListProjectResponse
// @Security BearerAuth
func ListProjects(ctx *gin.Context) {
	var (
		err error
		req project.ListProjectFilter
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().ListProjects(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetUserProjectList gets the user's project list
// @Router /api/sico/project/user_projects [GET]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.GetUserProjectListRequest true "Get User projectList request"
// @Success 200 {object} project.GetUserProjectListResponse
// @Security BearerAuth
func GetUserProjectList(ctx *gin.Context) {
	var (
		err error
		req project.GetUserProjectListRequest
	)

	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	req.Username = userInfo.Name

	// user_id will be set in the layer from context
	resp, err := projectSVC.Default().GetUserProjectList(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetProject gets project detail by id
// @Router /api/sico/project [GET]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.GetProjectDetailRequest true "Get project detail request"
// @Success 200 {object} project.GetProjectDetailResponse
// @Security BearerAuth
func GetProject(ctx *gin.Context) {
	var (
		err error
		req project.GetProjectDetailRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().GetProject(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// QueryProjectStatistics queries project tasks statistics
// @Router /api/sico/project/statistics [GET]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.QueryProjectStatisticsRequest true "Query project statistics request"
// @Success 200 {object} project.QueryProjectStatisticsResponse
// @Security BearerAuth
func QueryProjectStatistics(ctx *gin.Context) {
	var (
		err error
		req project.QueryProjectStatisticsRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().QueryProjectStatistics(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
