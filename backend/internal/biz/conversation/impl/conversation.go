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

package impl

import (
	"context"
	"strings"

	appresp "sico-backend/internal/biz/common/response"
	entity "sico-backend/internal/entity/conversation/conversation"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	messageRepo "sico-backend/internal/store/conversation/message/repository"
	model "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/conversation"
	"sico-backend/pkg/logger"
)

const DefaultConversationTitle = "New Session"

func (c *Service) UpdateConversation(ctx context.Context,
	req *model.UpdateConversationRequest) (*model.UpdateConversationResponse, error) {
	username := middleware.MustGetUsernameFromCtx(ctx)
	conversation, err := c.conversationRepo.GetByID(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	if conversation == nil || conversation.CreatorUsername != username {
		return nil, apperr.New(errcode.CommonNotFound, "conversation not found")
	}

	title := strings.TrimSpace(req.GetTitle())
	if title == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "title is required")
	}
	if title == conversation.Title {
		return appresp.Success(&model.UpdateConversationResponse{}), nil
	}

	updated, err := c.conversationRepo.UpdateTitleIfCurrent(ctx, req.GetId(), conversation.Title, title)
	if err != nil {
		return nil, err
	}
	if updated == 0 {
		return nil, apperr.New(errcode.CommonConflict, "conversation title changed, please retry")
	}

	return appresp.Success(&model.UpdateConversationResponse{}), nil
}

func (c *Service) GetConversation(ctx context.Context,
	req *model.GetConversationRequest) (*model.GetConversationResponse, error) {
	resp := new(model.GetConversationResponse)
	conversationData, err := c.conversationRepo.GetByID(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	if conversationData == nil {
		return nil, apperr.New(errcode.CommonNotFound, "conversation not found")
	}

	agentInstanceInfo, err := c.getAgentInstanceInfo(ctx, conversationData.AgentInstanceID)
	if err != nil {
		logger.CtxError(ctx, "[GetConversation] getAgentInstanceInfo failed, err:%v", err)
		return nil, err
	}

	resp.Data = &model.GetConversationData{
		Conversation: &model.ConversationData{
			Id:                conversationData.ID,
			CreatedAt:         conversationData.CreatedAt / 1000,
			CreatorUsername:   conversationData.CreatorUsername,
			Title:             conversationData.Title,
			AgentInstanceInfo: agentInstanceInfo,
		},
	}
	return resp, nil
}

func (c *Service) CreateConversation(ctx context.Context,
	req *model.CreateConversationRequest) (*model.CreateConversationResponse, error) {
	resp := new(model.CreateConversationResponse)
	title := strings.TrimSpace(req.GetTitle())
	if title == "" {
		title = DefaultConversationTitle
	}
	conversationData, err := c.conversationRepo.Create(ctx, &entity.Conversation{
		CreatorUsername: middleware.MustGetUsernameFromCtx(ctx),
		AgentInstanceID: req.AgentInstanceId,
		Title:           title,
	})
	if err != nil {
		return nil, err
	}

	resp.Data = &model.ConversationData{
		Id:              conversationData.ID,
		CreatedAt:       conversationData.CreatedAt / 1000,
		CreatorUsername: conversationData.CreatorUsername,
		Title:           conversationData.Title,
	}
	return resp, nil
}

func (c *Service) ListConversation(
	ctx context.Context, req *model.ListConversationRequest) (*model.ListConversationResponse, error) {
	resp := new(model.ListConversationResponse)
	userID := middleware.MustGetUsernameFromCtx(ctx)
	conversationDOList, hasMore, err := c.conversationRepo.List(
		ctx, userID, "", req.GetAgentInstanceId(), int(req.GetPageSize()), int(req.GetPage()),
	)
	if err != nil {
		return resp, err
	}

	conversationData := make([]*model.ConversationListItem, 0, len(conversationDOList))

	for _, conv := range conversationDOList {
		conversationData = append(conversationData, &model.ConversationListItem{
			Id:              conv.ID,
			CreatedAt:       conv.CreatedAt / 1000,
			CreatorUsername: conv.CreatorUsername,
			Title:           conv.Title,
		})
	}

	resp.Data = &model.ListConversationData{
		Conversations: conversationData,
		HasMore:       hasMore,
	}

	return resp, nil
}

func (c *Service) DeleteConversation(ctx context.Context,
	req *model.DeleteConversationRequest) (*model.DeleteConversationResponse, error) {
	username := middleware.MustGetUsernameFromCtx(ctx)
	conversation, err := c.conversationRepo.GetByID(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	if conversation == nil || conversation.CreatorUsername != username {
		return nil, apperr.New(errcode.CommonNotFound, "conversation not found")
	}

	rowsAffected, err := c.conversationRepo.Delete(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	if rowsAffected == 0 {
		return nil, apperr.New(errcode.CommonNotFound, "conversation not found")
	}

	return appresp.Success(&model.DeleteConversationResponse{}), nil
}

func (c *Service) RpcUpdateConversationTitle(
	ctx context.Context,
	req *rgrpc.UpdateConversationTitleRequest,
) (*rgrpc.UpdateConversationTitleResponse, error) {
	if req == nil || req.GetConversationId() <= 0 {
		return appresp.Success(&rgrpc.UpdateConversationTitleResponse{}), nil
	}
	title := strings.TrimSpace(req.GetTitle())
	if title == "" {
		return appresp.Success(&rgrpc.UpdateConversationTitleResponse{}), nil
	}
	titleRunes := []rune(title)
	if len(titleRunes) > 80 {
		title = string(titleRunes[:80])
	}

	_, err := c.conversationRepo.UpdateTitleIfCurrent(
		ctx,
		req.GetConversationId(),
		DefaultConversationTitle,
		title,
	)
	if err != nil {
		return nil, err
	}
	return appresp.Success(&rgrpc.UpdateConversationTitleResponse{}), nil
}

// getAgentInstanceInfo is a helper method to fetch and convert agent instance data
func (c *Service) getAgentInstanceInfo(ctx context.Context, agentInstanceID int64) (*model.AgentInstanceInfo, error) {
	instance, err := c.agentSvc.GetSingleAgentInstance(ctx, agentInstanceID)
	if err != nil {
		return nil, err
	}
	if instance == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
	}

	return &model.AgentInstanceInfo{
		Name:       instance.Name,
		Desc:       instance.Desc,
		Role:       instance.Role,
		IconUri:    instance.IconUri,
		InstanceId: agentInstanceID,
	}, nil
}

func (s *Service) GetPlan(ctx context.Context, req *model.GetPlanRequest) (*model.GetPlanResponse, error) {
	conversationID, resolved, err := s.resolvePlanConversationID(
		ctx, req.Username, req.AgentInstanceId, req.TurnId, req.ConversationId,
	)
	if err != nil {
		return nil, err
	}
	if !resolved {
		logger.CtxWarn(
			ctx,
			"ambiguous plan lookup without conversation_id: username=%s agent_instance_id=%d turn_id=%d",
			req.Username,
			req.AgentInstanceId,
			req.TurnId,
		)
		return appresp.Success(&model.GetPlanResponse{
			Data: &model.GetPlanData{Status: model.PlanStatus_PLAN_STATUS_NO_PLAN},
		}), nil
	}

	var planReq model.GetPlanRequest
	planReq.AgentInstanceId = req.AgentInstanceId
	planReq.Username = req.Username
	planReq.TurnId = req.TurnId
	planReq.ConversationId = conversationID
	response, err := s.chatClient.GetPlan(ctx, &planReq)
	if err != nil {
		return nil, apperr.New(errcode.CommonUnavailable, "failed to query plan")
	}
	if response.Data == nil {
		return nil, apperr.New(errcode.CommonNotFound, "failed to obtain plan data")
	}

	// Normalize deprecated file_url/file_name into the file submessage for old data.
	normalizePlanDeliverables(response.Data.Plan)

	return appresp.Success(&model.GetPlanResponse{
		Data: &model.GetPlanData{
			Plan:   response.Data.Plan,
			Status: response.Data.Status,
		},
	}), nil
}

// normalizePlanDeliverables migrates deprecated file_url/file_name fields into
// the ToolDeliverableFile submessage for backward compatibility with old data.
func normalizePlanDeliverables(plan *model.Plan) {
	if plan == nil {
		return
	}
	for _, step := range plan.Steps {
		for _, tc := range step.ToolCalls {
			normalizeToolCallDeliverables(tc)
		}
	}
}

func normalizeToolCallDeliverables(tc *model.ToolCall) {
	if tc == nil {
		return
	}
	for _, d := range tc.Deliverables {
		if d.File == nil && (d.FileUrl != "" || d.FileName != "") {
			// Migrate old top-level fields into the file submessage.
			d.File = &model.ToolDeliverableFile{
				FileSasUrl: d.FileUrl,
				FileName:   d.FileName,
			}
		} else if d.File != nil {
			// Back-fill deprecated fields so old frontends can still read them.
			d.FileUrl = d.File.FileSasUrl
			d.FileName = d.File.FileName
		}
	}
	for _, sub := range tc.SubCalls {
		normalizeToolCallDeliverables(sub)
	}
}

func (s *Service) CancelPlan(ctx context.Context, req *model.CancelPlanRequest) (*model.CancelPlanResponse, error) {
	conversationID, resolved, err := s.resolvePlanConversationID(
		ctx, req.Username, req.AgentInstanceId, req.TurnId, req.ConversationId,
	)
	if err != nil {
		return nil, err
	}
	if !resolved {
		logger.CtxWarn(
			ctx,
			"ambiguous plan cancel without conversation_id: username=%s agent_instance_id=%d turn_id=%d",
			req.Username,
			req.AgentInstanceId,
			req.TurnId,
		)
		return appresp.Success(&model.CancelPlanResponse{}), nil
	}

	var cancelReq model.CancelPlanRequest
	cancelReq.AgentInstanceId = req.AgentInstanceId
	cancelReq.Username = req.Username
	cancelReq.TurnId = req.TurnId
	cancelReq.ConversationId = conversationID
	_, err = s.chatClient.CancelPlan(ctx, &cancelReq)
	if err != nil {
		return nil, apperr.New(errcode.CommonUnavailable, "failed to cancel plan")
	}

	return appresp.Success(&model.CancelPlanResponse{}), nil
}

func (s *Service) resolvePlanConversationID(
	ctx context.Context,
	username string,
	agentInstanceID int64,
	turnID int64,
	conversationID int64,
) (int64, bool, error) {
	if conversationID != 0 {
		return conversationID, true, nil
	}

	role := roleUser
	messages, hasMore, err := s.messageRepo.ListByFilter(ctx, &messageRepo.MessageFilter{
		Username:        &username,
		AgentInstanceId: &agentInstanceID,
		TurnId:          &turnID,
		Role:            &role,
		IdDescending:    true,
		UsePagination:   true,
		Page:            1,
		PageSize:        2,
	})
	if err != nil {
		return 0, false, err
	}
	if len(messages) > 1 || hasMore {
		return 0, false, nil
	}
	if len(messages) > 0 {
		return messages[0].ConversationId, true, nil
	}
	return 0, false, nil
}

func (s *Service) GenerateOnboardRecommendationTasks(
	ctx context.Context, req *model.GenerateOnboardRecommendationTasksRequest,
) (*model.GenerateOnboardRecommendationTasksResponse, error) {
	agentInstance, err := s.agentSvc.GetSingleAgentInstance(ctx, req.AgentInstanceId)
	if err != nil {
		logger.CtxError(ctx, "failed to get single agent instance: agentInstanceId=%d, err=%v", req.AgentInstanceId, err)
		return nil, apperr.New(errcode.CommonUnavailable, "failed to query agent instance info")
	}
	if agentInstance == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
	}

	req.ProjectId = agentInstance.ProjectId
	req.AgentId = agentInstance.AgentId

	response, err := s.chatClient.GenerateOnboardRecommendationTasks(ctx, req)
	if err != nil || response.Code != 0 {
		return nil, apperr.New(errcode.CommonUnavailable, "failed to generate onboard recommendation tasks")
	}
	return appresp.Success(response), nil
}
