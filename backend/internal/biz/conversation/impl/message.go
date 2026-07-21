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
	"errors"
	"strings"

	"github.com/go-sql-driver/mysql"
	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	messageentity "sico-backend/internal/entity/conversation/message"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	messagerepo "sico-backend/internal/store/conversation/message/repository"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/conversation"
	"sico-backend/pkg/jsoniter"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/ptr"
)

const (
	// Enable this when frontend has used the "reconnect" api.
	OmitMessageForOngoingTurn = false

	taskRuntimeRecoveryResultPrefix       = "task_runtime_recovery_batch:"
	legacyTaskRuntimeRecoveryMarkerPrefix = "<!-- sico:task-runtime-recovery batch_id="
	mysqlDuplicateErrNum                  = 1062
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

	conversationID, found, err := c.resolveConversationIDForMessageListing(ctx, username, req)
	if err != nil {
		return nil, err
	}
	if !found {
		// No conversation found, return empty list
		return appresp.Success(&conversationdto.ListMessagesByUserAndAgentResponse{
			Data: emptyResp,
		}), nil
	}

	messages, hasMore, err := c.fetchMessagesForListing(ctx, conversationID, req, page, pageSize)
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
		messages = c.filterOutOngoingTurn(ctx, conversationID, messages)
	}

	resp := buildMessageResponse(messages, hasMore)

	c.enrichPlanMessageContent(ctx, resp.Messages)

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

func (c *Service) resolveConversationIDForMessageListing(
	ctx context.Context,
	username string,
	req *conversationdto.ListMessagesByUserAndAgentRequest,
) (int64, bool, error) {
	if req.GetConversationId() != 0 {
		conversation, err := c.conversationRepo.GetByID(ctx, req.GetConversationId())
		if err != nil {
			return 0, false, err
		}
		if conversation == nil || conversation.CreatorUsername != username {
			return 0, false, apperr.New(errcode.CommonNotFound, "conversation not found")
		}
		if conversation.AgentInstanceID != req.GetAgentInstanceId() {
			return 0, false, apperr.New(
				errcode.CommonInvalidParam,
				"conversation does not belong to this user and agent instance",
			)
		}
		if req.GetAgentId() != "" && conversation.AgentID != "" && conversation.AgentID != req.GetAgentId() {
			return 0, false, apperr.New(errcode.CommonInvalidParam, "conversation does not belong to this agent")
		}
		return conversation.ID, true, nil
	}

	conversations, hasMore, err := c.conversationRepo.List(ctx, username, "", req.GetAgentInstanceId(), 2, 1)
	if err != nil {
		return 0, false, err
	}
	if len(conversations) == 1 && !hasMore {
		return conversations[0].ID, true, nil
	}
	if len(conversations) > 1 || hasMore {
		return 0, false, apperr.New(
			errcode.CommonInvalidParam,
			"conversationId is required when multiple conversations exist",
		)
	}

	return 0, false, nil
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

	c.enrichPlanMessageContent(ctx, []*conversationdto.MessageItem{item})

	return appresp.Success(&conversationdto.GetUserMessageByUserAgentTurnIDResponse{
		Data: item,
	}), nil
}

// enrichPlanMessageContent populates the Content field of plan-type messages
// with the serialized plan JSON so the frontend can render plans inline without
// an extra GetPlan API call.
func (c *Service) enrichPlanMessageContent(ctx context.Context, items []*conversationdto.MessageItem) {
	if c.chatClient == nil {
		return
	}
	for _, item := range items {
		if item == nil || item.Type != conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_PLAN {
			continue
		}
		resp, err := c.chatClient.GetPlan(ctx, &conversationdto.GetPlanRequest{
			AgentInstanceId: item.AgentInstanceId,
			Username:        item.Username,
			TurnId:          item.TurnId,
			ConversationId:  item.ConversationId,
		})
		if err != nil {
			logger.CtxWarn(ctx, "enrich_plan_content failed for turn_id=%d conversation_id=%d: %v",
				item.TurnId, item.ConversationId, err)
			continue
		}
		if resp == nil || resp.Data == nil {
			continue
		}
		normalizePlanDeliverables(resp.Data.Plan)
		content, err := jsoniter.MarshalString(resp.Data)
		if err != nil {
			logger.CtxWarn(ctx, "enrich_plan_content marshal failed for turn_id=%d: %v",
				item.TurnId, err)
			continue
		}
		item.Content = content
	}
}

func buildMessageResponse(
	messages []*messageentity.Message, hasMore bool,
) *conversationdto.ListMessagesByUserAndAgentData {
	messages = filterRedundantTaskRuntimeRecoveryMessages(messages)
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

type turnMessageKey struct {
	conversationID  int64
	turnID          int64
	agentInstanceID int64
	username        string
}

func messageTurnKey(msg *messageentity.Message) turnMessageKey {
	if msg == nil {
		return turnMessageKey{}
	}
	return turnMessageKey{
		conversationID:  msg.ConversationId,
		turnID:          msg.TurnId,
		agentInstanceID: msg.AgentInstanceId,
		username:        msg.Username,
	}
}

func isAssistantTextMessage(msg *messageentity.Message) bool {
	return msg != nil && msg.Role == roleAssistant &&
		msg.ContentType == conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT
}

func isNormalAssistantTextMessage(msg *messageentity.Message) bool {
	return isAssistantTextMessage(msg) && taskRuntimeRecoveryMessageKey(msg) == "" && strings.TrimSpace(msg.Content) != ""
}

func isTaskRuntimeArtifactAssistantTextMessage(msg *messageentity.Message) bool {
	return isNormalAssistantTextMessage(msg) && hasTaskRuntimeArtifactReference(msg.Content)
}

func hasTaskRuntimeArtifactReference(content string) bool {
	lowered := strings.ToLower(content)
	if strings.Contains(lowered, "/storage/task-runtime/") {
		return true
	}
	if hasTaskRuntimeArtifactFieldReference(lowered) {
		return true
	}
	if strings.Contains(lowered, "execution summary:") && strings.Contains(lowered, "://") {
		return true
	}
	return strings.Contains(lowered, "run report:") && strings.Contains(lowered, "://")
}

func hasTaskRuntimeArtifactFieldReference(loweredContent string) bool {
	if !strings.Contains(loweredContent, "://") && !strings.Contains(loweredContent, "/storage/") {
		return false
	}
	return strings.Contains(loweredContent, "summary_uri") ||
		strings.Contains(loweredContent, "report_url")
}

func filterRedundantTaskRuntimeRecoveryMessages(messages []*messageentity.Message) []*messageentity.Message {
	if len(messages) == 0 {
		return messages
	}

	hasTaskRuntimeArtifactText := make(map[turnMessageKey]bool)
	for _, msg := range messages {
		if isTaskRuntimeArtifactAssistantTextMessage(msg) {
			hasTaskRuntimeArtifactText[messageTurnKey(msg)] = true
		}
	}
	if len(hasTaskRuntimeArtifactText) == 0 {
		return messages
	}

	filtered := make([]*messageentity.Message, 0, len(messages))
	for _, msg := range messages {
		if isAssistantTextMessage(msg) &&
			taskRuntimeRecoveryMessageKey(msg) != "" &&
			hasTaskRuntimeArtifactText[messageTurnKey(msg)] {
			continue
		}
		filtered = append(filtered, msg)
	}
	return filtered
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
		ConversationId:  msg.ConversationId,
		Role:            msg.Role,
		Username:        msg.Username,
		AgentInstanceId: msg.AgentInstanceId,
		Type:            typeValue,
		Content:         contentValue,
		FunctionContext: visibleMessageFunctionContext(msg),
		Attachments:     msg.Attachments,
		CreatedAt:       msg.CreatedAt,
		UpdatedAt:       msg.UpdatedAt,
	}
}

func visibleMessageFunctionContext(msg *messageentity.Message) *conversationdto.FunctionContext {
	if msg.ContentType == conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT && msg.Role == roleAssistant {
		if taskRuntimeRecoveryMessageKey(msg) != "" {
			return &conversationdto.FunctionContext{}
		}
	}

	return msg.FunctionContext
}

func NormalizeMessageContent(msg *messageentity.Message) (conversationdto.MessageContentType, string, bool) {
	// The structure frontend needs is different from the one stored in DB. So we need to:
	// 1. Assume all the text responses are of type MARKDOWN.
	// 2. For FUNCTION_CALL type, we extract the "arguments" field from FunctionContext as content.
	// 3. For FUNCTION_RESULT type, we extract the "exception" field from FunctionContext as content.
	// 4. For other types, we keep the content as is.
	switch msg.ContentType {
	case conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT:
		content := msg.Content
		if msg.Role == roleAssistant {
			content = stripLegacyTaskRuntimeRecoveryMessageMarker(content)
		}
		return conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_MARKDOWN, content, true
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

func taskRuntimeRecoveryMessageKey(msg *messageentity.Message) string {
	if msg == nil {
		return ""
	}

	if msg.FunctionContext != nil {
		result := strings.TrimSpace(msg.FunctionContext.GetResult())
		if strings.HasPrefix(result, taskRuntimeRecoveryResultPrefix) {
			return result
		}
	}

	if batchID, _ := legacyTaskRuntimeRecoveryMarker(msg.Content); batchID != "" {
		return taskRuntimeRecoveryResultPrefix + batchID
	}

	return ""
}

func legacyTaskRuntimeRecoveryMarker(content string) (string, string) {
	markerStart := strings.Index(content, legacyTaskRuntimeRecoveryMarkerPrefix)
	if markerStart < 0 {
		return "", ""
	}

	end := strings.Index(content[markerStart:], "-->")
	if end < 0 {
		return "", ""
	}

	batchIDStart := markerStart + len(legacyTaskRuntimeRecoveryMarkerPrefix)
	markerEnd := markerStart + end + len("-->")
	return strings.TrimSpace(content[batchIDStart : markerStart+end]), content[markerStart:markerEnd]
}

func stripLegacyTaskRuntimeRecoveryMessageMarker(content string) string {
	_, marker := legacyTaskRuntimeRecoveryMarker(content)
	if marker == "" {
		return content
	}

	return strings.TrimRight(strings.Replace(content, marker, "", 1), " \r\n")
}

func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == mysqlDuplicateErrNum {
		return true
	}

	return strings.Contains(err.Error(), "Duplicate entry")
}

func (c *Service) findExistingAssistantTextForRecoveredTaskRuntimeMessage(
	ctx context.Context,
	msg *messageentity.Message,
	recoveryKey string,
) (*messageentity.Message, error) {
	existing, _, err := c.messageRepo.ListByFilter(ctx, &messagerepo.MessageFilter{
		Username:        &msg.Username,
		ConversationId:  &msg.ConversationId,
		AgentInstanceId: &msg.AgentInstanceId,
		TurnId:          &msg.TurnId,
		Role:            ptr.Of(roleAssistant),
		ContentTypeList: []conversationdto.ChatContentType{conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT},
	})
	if err != nil {
		return nil, err
	}

	var matchingRecovery *messageentity.Message
	var artifactText *messageentity.Message
	for _, item := range existing {
		if isTaskRuntimeArtifactAssistantTextMessage(item) && artifactText == nil {
			artifactText = item
		}
		if taskRuntimeRecoveryMessageKey(item) == recoveryKey {
			matchingRecovery = item
		}
	}
	if artifactText != nil {
		return artifactText, nil
	}

	return matchingRecovery, nil
}

func (c *Service) RpcCreateMessage(ctx context.Context, req *rgrpc.CreateMessageRequest) (*rgrpc.CreateMessageResponse, error) {
	message := req.Message

	// if message type is Plan and there is already
	// a plan in with same (agent_instance_id, username, turn_id),
	// we should omit this insertion
	if message.ContentType == conversationdto.ChatContentType_CHAT_CONTENT_TYPE_PLAN {
		resp, err := c.deduplicatePlanMessage(ctx, message)
		if err != nil {
			return nil, err
		}
		if resp != nil {
			return resp, nil
		}
	}

	// Task-runtime recovery deduplication: if this is a recovered assistant text message,
	// check if a final artifact-containing message already exists for this turn.
	recoveryKey := c.getRecoveryKey(ctx, message)
	if recoveryKey != "" {
		resp, err := c.deduplicateRecoveryMessage(ctx, message, recoveryKey)
		if err != nil {
			return nil, err
		}
		if resp != nil {
			return resp, nil
		}
	}

	created, err := c.messageRepo.Create(ctx, message)
	if err != nil {
		return c.handleCreateMessageError(ctx, message, recoveryKey, err)
	}
	return &rgrpc.CreateMessageResponse{
		Data: &rgrpc.CreateMessageData{Id: created.Id},
	}, nil
}

func (c *Service) deduplicatePlanMessage(
	ctx context.Context, message *messageentity.Message,
) (*rgrpc.CreateMessageResponse, error) {
	existing, _, err := c.messageRepo.ListByFilter(ctx, &messagerepo.MessageFilter{
		Username:        &message.Username,
		ConversationId:  &message.ConversationId,
		AgentInstanceId: &message.AgentInstanceId,
		TurnId:          &message.TurnId,
		ContentTypeList: []conversationdto.ChatContentType{
			conversationdto.ChatContentType_CHAT_CONTENT_TYPE_PLAN,
		},
	})
	if err != nil {
		logger.CtxError(ctx,
			"chat_plan_dedupe_lookup_failed turnId=%d agentInstanceId=%d contentType=%s err=%v",
			message.TurnId, message.AgentInstanceId, message.ContentType.String(), err)
		return nil, err
	}
	if len(existing) > 0 {
		return appresp.Success(&rgrpc.CreateMessageResponse{
			Data: &rgrpc.CreateMessageData{Id: existing[0].Id},
		}), nil
	}
	return nil, nil
}

func (c *Service) getRecoveryKey(_ context.Context, message *messageentity.Message) string {
	if message.ContentType == conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT && message.Role == roleAssistant {
		return taskRuntimeRecoveryMessageKey(message)
	}
	return ""
}

func (c *Service) deduplicateRecoveryMessage(
	ctx context.Context, message *messageentity.Message, recoveryKey string,
) (*rgrpc.CreateMessageResponse, error) {
	existing, err := c.findExistingAssistantTextForRecoveredTaskRuntimeMessage(ctx, message, recoveryKey)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return appresp.Success(&rgrpc.CreateMessageResponse{
			Data: &rgrpc.CreateMessageData{Id: existing.Id},
		}), nil
	}
	return nil, nil
}

func (c *Service) handleCreateMessageError(
	ctx context.Context, message *messageentity.Message, recoveryKey string, err error,
) (*rgrpc.CreateMessageResponse, error) {
	if recoveryKey != "" && isDuplicateKeyError(err) {
		existing, findErr := c.findExistingAssistantTextForRecoveredTaskRuntimeMessage(
			ctx, message, recoveryKey,
		)
		if findErr != nil {
			return nil, findErr
		}
		if existing != nil {
			return appresp.Success(&rgrpc.CreateMessageResponse{
				Data: &rgrpc.CreateMessageData{Id: existing.Id},
			}), nil
		}
	}
	if isDuplicateKeyError(err) {
		logger.CtxWarn(ctx,
			"chat_message_create_duplicate conversationId=%d turnId=%d agentInstanceId=%d contentType=%s",
			message.ConversationId, message.TurnId, message.AgentInstanceId, message.ContentType.String())
	} else {
		logger.CtxError(ctx,
			"chat_message_create_failed conversationId=%d turnId=%d agentInstanceId=%d "+
				"contentType=%s err=%v",
			message.ConversationId, message.TurnId,
			message.AgentInstanceId, message.ContentType.String(), err)
	}
	return nil, err
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

// ListBatchSummaries returns delegated-task batches for a single conversation.
// The caller MUST own the conversation (creator_username == JWT subject), so a
// missing/foreign conversation is reported as a generic NotFound to avoid
// leaking existence.
func (c *Service) ListBatchSummaries(
	ctx context.Context,
	req *conversationdto.ListBatchSummariesRequest,
) (*conversationdto.ListBatchSummariesResponse, error) {
	if c.db == nil {
		return appresp.Success(&conversationdto.ListBatchSummariesResponse{
			Data: &conversationdto.ListBatchSummariesData{Items: []*conversationdto.BatchSummaryItem{}},
		}), nil
	}
	username := middleware.MustGetUsernameFromCtx(ctx)
	conv, err := c.conversationRepo.GetByID(ctx, req.GetConversationId())
	if err != nil {
		return nil, err
	}
	if conv == nil || conv.CreatorUsername != username {
		return nil, apperr.New(errcode.CommonNotFound, "conversation not found")
	}
	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 20
	}
	page := int(req.GetPage())
	if page <= 0 {
		page = 1
	}
	filter := listBatchSummariesFilter{
		ConversationID: req.GetConversationId(),
		Limit:          pageSize,
		Offset:         (page - 1) * pageSize,
	}
	if req.TurnId != nil {
		v := req.GetTurnId()
		filter.TurnID = &v
	}
	rows, err := listBatchSummaries(ctx, c.db, filter)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > pageSize
	if hasMore {
		rows = rows[:pageSize]
	}
	items := make([]*conversationdto.BatchSummaryItem, 0, len(rows))
	for i := range rows {
		r := rows[i]
		item := &conversationdto.BatchSummaryItem{
			BatchId:              r.BatchID,
			ParentConversationId: r.ParentConversationID,
			ParentTurnId:         r.ParentTurnID,
			Status:               r.Status,
			Reason:               r.Reason,
			TotalCount:           r.TotalCount,
			SummaryUri:           extractSummaryURI(r.BatchJSON),
			CreatedAt:            int64(r.CreatedAt),
			UpdatedAt:            int64(r.UpdatedAt),
		}
		if r.EndedAt != nil {
			item.EndedAt = int64(*r.EndedAt)
		}
		items = append(items, item)
	}
	return appresp.Success(&conversationdto.ListBatchSummariesResponse{
		Data: &conversationdto.ListBatchSummariesData{
			Items:   items,
			HasMore: hasMore,
		},
	}), nil
}
