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
