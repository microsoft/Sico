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

	conversationbiz "sico-backend/internal/biz/conversation"
	"sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/internal/transport/http/middleware"
)

// CreateConversation .
// @Router /api/sico/conversation [POST]
// @Tags Conversation
// @Accept json
// @Produce json
// @Param request body conversation.CreateConversationRequest true "Create Conversation Request"
// @Success 200 {object} conversation.CreateConversationResponse
// @Security BearerAuth
func CreateConversation(ctx *gin.Context) {
	var (
		err error
		req conversation.CreateConversationRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := conversationbiz.Default().CreateConversation(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetConversation .
// @Router /api/sico/conversation [GET]
// @Tags Conversation
// @Accept json
// @Produce json
// @Param request query conversation.GetConversationRequest true "Get Conversation Request"
// @Success 200 {object} conversation.GetConversationResponse
// @Security BearerAuth
func GetConversation(ctx *gin.Context) {
	var (
		err error
		req conversation.GetConversationRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := conversationbiz.Default().GetConversation(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateConversation .
// @Router /api/sico/conversation [PUT]
// @Tags Conversation
// @Accept json
// @Produce json
// @Param request body conversation.UpdateConversationRequest true "Update Conversation Request"
// @Success 200 {object} conversation.UpdateConversationResponse
// @Security BearerAuth
func UpdateConversation(ctx *gin.Context) {
	var (
		err error
		req conversation.UpdateConversationRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := conversationbiz.Default().UpdateConversation(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListConversations .
// @Router /api/sico/conversation/list [GET]
// @Tags Conversation
// @Produce json
// @Param request query conversation.ListConversationRequest true "List Conversation request"
// @Success 200 {object} conversation.ListConversationResponse
// @Security BearerAuth
func ListConversations(ctx *gin.Context) {
	var (
		err error
		req conversation.ListConversationRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := conversationbiz.Default().ListConversation(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListMessagesByUserAndAgent .
// @Router /api/sico/conversation/messages [GET]
// @Tags Conversation
// @Produce json
// @Param request query conversation.ListMessagesByUserAndAgentRequest true "List Messages By User And Agent Request"
// @Success 200 {object} conversation.ListMessagesByUserAndAgentResponse
// @Security BearerAuth
func ListMessagesByUserAndAgent(ctx *gin.Context) {
	var (
		err error
		req conversation.ListMessagesByUserAndAgentRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := conversationbiz.Default().ListMessagesByUserAndAgent(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetUserMessageByUserAgentTurnID .
// @Router /api/sico/conversation/messages/user/turn [GET]
// @Tags Conversation
// @Produce json
// @Param request query conversation.GetUserMessageByUserAgentTurnIDRequest true "Get User Message By User Agent Turn ID Request"
// @Success 200 {object} conversation.GetUserMessageByUserAgentTurnIDResponse
// @Security BearerAuth
func GetUserMessageByUserAgentTurnID(ctx *gin.Context) {
	var (
		err error
		req conversation.GetUserMessageByUserAgentTurnIDRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := conversationbiz.Default().GetUserMessageByUserAgentTurnID(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListBatchSummaries returns task_runtime batch metadata (including the persisted
// HTML summary URI) for a conversation owned by the authenticated user.
// @Router /api/sico/conversation/batch_summaries [GET]
// @Tags Conversation
// @Produce json
// @Param request query conversation.ListBatchSummariesRequest true "List Batch Summaries Request"
// @Success 200 {object} conversation.ListBatchSummariesResponse
// @Security BearerAuth
func ListBatchSummaries(ctx *gin.Context) {
	var (
		err error
		req conversation.ListBatchSummariesRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := conversationbiz.Default().ListBatchSummaries(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetPlan get the plan of a specific chat turn
// @Router /api/sico/conversation/plan [GET]
// @Tags Conversation
// @Produce json
// @Param request query conversation.GetPlanRequest true "Get Plan Request"
// @Success 200 {object} conversation.GetPlanResponse
// @Security BearerAuth
func GetPlan(ctx *gin.Context) {
	var (
		err error
		req conversation.GetPlanRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}
	req.Username = userInfo.Name

	resp, err := conversationbiz.Default().GetPlan(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// CancelPlan cancel the plan of a specific chat turn
// @Router /api/sico/conversation/plan/cancel [POST]
// @Tags Conversation
// @Accept json
// @Produce json
// @Param request body conversation.CancelPlanRequest true "Cancel Plan Request"
// @Success 200 {object} conversation.CancelPlanResponse
// @Security BearerAuth
func CancelPlan(ctx *gin.Context) {
	var (
		err error
		req conversation.CancelPlanRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	req.Username = userInfo.Name
	resp, err := conversationbiz.Default().CancelPlan(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GenerateOnboardRecommendationTasks generate the onboard recommendation tasks
// @Router /api/dwp/conversation/onboard/recommendation_tasks [POST]
// @Tags Conversation
// @Accept json
// @Produce json
// @Param request body conversation.GenerateOnboardRecommendationTasksRequest true "Request"
// @Success 200 {object} conversation.GenerateOnboardRecommendationTasksResponse
// @Security BearerAuth
func GenerateOnboardRecommendationTasks(ctx *gin.Context) {
	var (
		err error
		req conversation.GenerateOnboardRecommendationTasksRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}
	req.Username = userInfo.Name

	resp, err := conversationbiz.Default().
		GenerateOnboardRecommendationTasks(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
