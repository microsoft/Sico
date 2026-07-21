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

// CreateProjectDeliverable publishes a file deliverable to a project
// @Router /api/sico/project/deliverable [POST]
// @Tags Project
// @Accept json
// @Produce json
// @Param request body project.CreateProjectDeliverableRequest true "Create project deliverable request"
// @Success 200 {object} project.CreateProjectDeliverableResponse
// @Security BearerAuth
func CreateProjectDeliverable(ctx *gin.Context) {
	var (
		err error
		req project.CreateProjectDeliverableRequest
	)

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

	resp, err := projectSVC.Default().CreateProjectDeliverable(reqctx(ctx), &req, userInfo.Name)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListProjectDeliverables lists deliverables for a project
// @Router /api/sico/project/deliverables [GET]
// @Tags Project
// @Produce json
// @Param request query project.ListProjectDeliverablesRequest true "List project deliverables request"
// @Success 200 {object} project.ListProjectDeliverablesResponse
// @Security BearerAuth
func ListProjectDeliverables(ctx *gin.Context) {
	var (
		err error
		req project.ListProjectDeliverablesRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().ListProjectDeliverables(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetProjectDeliverable retrieves a single project deliverable
// @Router /api/sico/project/deliverable [GET]
// @Tags Project
// @Produce json
// @Param request query project.GetProjectDeliverableRequest true "Get project deliverable request"
// @Success 200 {object} project.GetProjectDeliverableResponse
// @Security BearerAuth
func GetProjectDeliverable(ctx *gin.Context) {
	var (
		err error
		req project.GetProjectDeliverableRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().GetProjectDeliverable(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteProjectDeliverable deletes a project deliverable by ID
// @Router /api/sico/project/deliverable [DELETE]
// @Tags Project
// @Produce json
// @Param request query project.DeleteProjectDeliverableRequest true "Delete project deliverable request"
// @Success 200 {object} project.DeleteProjectDeliverableResponse
// @Security BearerAuth
func DeleteProjectDeliverable(ctx *gin.Context) {
	var (
		err error
		req project.DeleteProjectDeliverableRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().DeleteProjectDeliverable(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
