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

	appresp "sico-backend/internal/biz/common/response"
	messageentity "sico-backend/internal/entity/conversation/message"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	messagerepo "sico-backend/internal/store/conversation/message/repository"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/conversation"
	"sico-backend/pkg/ptr"
)

const (
	// Enable this when frontend has used the "reconnect" api.
	OmitMessageForOngoingTurn = false
)

func (c *Service) ListMessagesByUserAndAgent(
	ctx context.Context, req *conversationdto.ListMessagesByUserAndAgentRequest,
) (*conversationdto.ListMessagesByUserAndAgentResponse, error) {
	page, pageSize := normalizeMessagePagination(req.GetPage(), req.GetPageSize())

	emptyResp := &conversationdto.ListMessagesByUserAndAgentData{
		Messages: []*conversationdto.MessageItem{},
	}

	agentInstanceID := req.GetAgentInstanceId()
	if agentInstanceID == 0 {
		return appresp.Success(&conversationdto.ListMessagesByUserAndAgentResponse{
			Data: emptyResp,
		}), nil
	}

	if agentInstanceID == -1 && req.GetAgentId() == "" {
		return nil, apperr.New(errcode.ConversationAgentRequired,
			"agent id must be provided when querying with agent instance id -1")
	}

	username := middleware.MustGetUsernameFromCtx(ctx)

	conversation, err := c.conversationRepo.Get(ctx, username, req.GetAgentId(), agentInstanceID)
	if err != nil {
		return nil, err
	}

	if conversation == nil {
		// No conversation found, return empty list
		return appresp.Success(&conversationdto.ListMessagesByUserAndAgentResponse{
			Data: emptyResp,
		}), nil
	}

	messages, hasMore, err := c.fetchMessagesForListing(ctx, conversation.ID, req, page, pageSize)
	if err != nil {
		return nil, err
	}

	if len(messages) == 0 {
		emptyResp.HasMore = hasMore
		return appresp.Success(&conversationdto.ListMessagesByUserAndAgentResponse{
			Data: emptyResp,
		}), nil
	}

	// when querying history without specifying turnId,
	// omit the current turn if there is a turn ongoing
	if OmitMessageForOngoingTurn && req.TurnId == nil {
		messages = c.filterOutOngoingTurn(ctx, conversation.ID, messages)
	}

	resp := buildMessageResponse(messages, hasMore)

	return appresp.Success(&conversationdto.ListMessagesByUserAndAgentResponse{
		Data: resp,
	}), nil
}

func normalizeMessagePagination(page, pageSize int32) (int32, int32) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > 50 {
		pageSize = 50
	}
	return page, pageSize
}

func (c *Service) fetchMessagesForListing(
	ctx context.Context,
	conversationID int64,
	req *conversationdto.ListMessagesByUserAndAgentRequest,
	page, pageSize int32,
) ([]*messageentity.Message, bool, error) {
	if req.TurnId != nil {
		turnID := req.GetTurnId()
		return c.messageRepo.ListByFilter(ctx, &messagerepo.MessageFilter{
			ConversationId: &conversationID,
			TurnId:         &turnID,
			UsePagination:  true,
			Page:           page,
			PageSize:       pageSize,
		})
	}
	return c.messageRepo.ListByConversationPage(ctx, conversationID, page, pageSize)
}

func (c *Service) filterOutOngoingTurn(
	ctx context.Context,
	conversationID int64,
	messages []*messageentity.Message,
) []*messageentity.Message {
	cacheKey := getCacheKeyForOngoingChatTurn(conversationID, 0)
	result := c.cache.Get(ctx, cacheKey.turnIdCacheKey)
	if result.Err() != nil {
		return messages
	}
	ongoingTurnId, err := result.Int64()
	if err != nil {
		return messages
	}
	filtered := make([]*messageentity.Message, 0, len(messages))
	for _, msg := range messages {
		if msg.TurnId != ongoingTurnId || msg.Role == roleUser {
			filtered = append(filtered, msg)
		}
	}
	return filtered
}

func (c *Service) GetUserMessageByUserAgentTurnID(
	ctx context.Context,
	req *conversationdto.GetUserMessageByUserAgentTurnIDRequest,
) (*conversationdto.GetUserMessageByUserAgentTurnIDResponse, error) {
	agentInstanceID := req.GetAgentInstanceId()
	turnID := req.GetTurnId()
	if agentInstanceID == 0 || turnID < 0 {
		return appresp.Success(&conversationdto.GetUserMessageByUserAgentTurnIDResponse{
			Data: nil,
		}), nil
	}

	if agentInstanceID == -1 && req.GetAgentId() == "" {
		return nil, apperr.New(errcode.ConversationAgentRequired,
			"agent id must be provided when querying with agent instance id -1")
	}

	username := middleware.MustGetUsernameFromCtx(ctx)

	conversation, err := c.conversationRepo.Get(ctx, username, req.GetAgentId(), agentInstanceID)
	if err != nil {
		return nil, err
	}

	if conversation == nil {
		// No conversation found, return nil
		return appresp.Success(&conversationdto.GetUserMessageByUserAgentTurnIDResponse{
			Data: nil,
		}), nil
	}

	msg, err := c.messageRepo.GetUserMessageByConversationTurnID(ctx, conversation.ID, turnID)
	if err != nil {
		return nil, err
	}
	if msg == nil {
		return appresp.Success(&conversationdto.GetUserMessageByUserAgentTurnIDResponse{
			Data: nil,
		}), nil
	}

	item := buildMessageItem(msg)

	return appresp.Success(&conversationdto.GetUserMessageByUserAgentTurnIDResponse{
		Data: item,
	}), nil
}

func buildMessageResponse(
	messages []*messageentity.Message, hasMore bool,
) *conversationdto.ListMessagesByUserAndAgentData {
	items := make([]*conversationdto.MessageItem, 0, len(messages))
	for _, msg := range messages {
		item := buildMessageItem(msg)
		if item == nil {
			continue
		}
		items = append(items, item)
	}

	return &conversationdto.ListMessagesByUserAndAgentData{
		Messages: items,
		HasMore:  hasMore,
	}
}

func buildMessageItem(msg *messageentity.Message) *conversationdto.MessageItem {
	if msg == nil {
		return nil
	}

	typeValue, contentValue, include := NormalizeMessageContent(msg)
	if !include {
		return nil
	}

	return &conversationdto.MessageItem{
		MessageId:       msg.Id,
		TurnId:          msg.TurnId,
		Role:            msg.Role,
		Username:        msg.Username,
		AgentInstanceId: msg.AgentInstanceId,
		Type:            typeValue,
		Content:         contentValue,
		FunctionContext: msg.FunctionContext,
		Attachments:     msg.Attachments,
		CreatedAt:       msg.CreatedAt,
		UpdatedAt:       msg.UpdatedAt,
	}
}

func NormalizeMessageContent(msg *messageentity.Message) (conversationdto.MessageContentType, string, bool) {
	// The structure frontend needs is different from the one stored in DB. So we need to:
	// 1. Assume all the text responses are of type MARKDOWN.
	// 2. For FUNCTION_CALL type, we extract the "arguments" field from FunctionContext as content.
	// 3. For FUNCTION_RESULT type, we extract the "exception" field from FunctionContext as content.
	// 4. For other types, we keep the content as is.
	switch msg.ContentType {
	case conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT:
		return conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_MARKDOWN, msg.Content, true
	case conversationdto.ChatContentType_CHAT_CONTENT_TYPE_END:
		return conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_END, "", true
	case conversationdto.ChatContentType_CHAT_CONTENT_TYPE_PLAN:
		return conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_PLAN, msg.Content, true
	case conversationdto.ChatContentType_CHAT_CONTENT_TYPE_PLAYBOOK_INGESTION:
		return conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_PLAYBOOK_INGESTION, msg.Content, true
	default:
		return conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_UNKNOWN, msg.Content, false
	}
}

func (c *Service) RpcCreateMessage(
	ctx context.Context, req *rgrpc.CreateMessageRequest,
) (*rgrpc.CreateMessageResponse, error) {
	message := req.Message

	// if message type is Plan and there is already
	// a plan in with same (agent_instance_id, username, turn_id),
	// we should omit this insertion
	if message.ContentType == conversationdto.ChatContentType_CHAT_CONTENT_TYPE_PLAN {
		existing, _, err := c.messageRepo.ListByFilter(ctx, &messagerepo.MessageFilter{
			Username:        &message.Username,
			AgentInstanceId: &message.AgentInstanceId,
			TurnId:          &message.TurnId,
			ContentTypeList: []conversationdto.ChatContentType{
				conversationdto.ChatContentType_CHAT_CONTENT_TYPE_PLAN,
			},
		})
		if err != nil {
			return nil, err
		}
		if len(existing) > 0 {
			return appresp.Success(&rgrpc.CreateMessageResponse{
				Data: &rgrpc.CreateMessageData{Id: existing[0].Id},
			}), nil
		}
	}

	created, err := c.messageRepo.Create(ctx, message)
	if err != nil {
		return nil, err
	}
	return &rgrpc.CreateMessageResponse{
		Data: &rgrpc.CreateMessageData{Id: created.Id},
	}, nil
}

func (c *Service) RpcListUserMessageByUserAgentTurnID(
	ctx context.Context,
	req *rgrpc.ListUserMessageByUserAgentTurnIDRequest,
) (*rgrpc.ListUserMessageByUserAgentTurnIDResponse, error) {
	agentInstanceID := req.GetAgentInstanceId()
	turnID := req.GetTurnId()
	if agentInstanceID <= 0 || turnID < 0 {
		return appresp.Success(&rgrpc.ListUserMessageByUserAgentTurnIDResponse{
			Data: nil,
		}), nil
	}
	username := req.Username

	msgs, _, err := c.messageRepo.ListByFilter(ctx, &messagerepo.MessageFilter{
		Username:        &username,
		AgentInstanceId: &agentInstanceID,
		TurnId:          &turnID,
		Role:            ptr.Of("user"),
		IdDescending:    true,
	})
	if err != nil {
		return nil, err
	}
	return appresp.Success(&rgrpc.ListUserMessageByUserAgentTurnIDResponse{
		Data: msgs,
	}), nil
}
