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
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"

	"sico-backend/internal/consts"
	conventity "sico-backend/internal/entity/conversation/conversation"
	"sico-backend/internal/entity/conversation/message"
	"sico-backend/internal/infra/eventbus"
	"sico-backend/internal/infra/sse"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	singleagentpb "sico-backend/internal/transport/http/dto/agent/single_agent"
	commondto "sico-backend/internal/transport/http/dto/common"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	projectdto "sico-backend/internal/transport/http/dto/project"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/env"
	"sico-backend/pkg/jsoniter"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

const (
	roleUser             = "user"
	roleAssistant        = "assistant"
	coreChatStartTimeout = 30 * time.Second
)

var (
	readEnvVariableChatKeepaliveCheckIntervalOnce sync.Once
	chatKeepaliveCheckInterval                    time.Duration
)

func (s *Service) SubscribeTopic() error {
	topicName := env.MustGet(consts.EventBusTopic)
	subscriptionPrefix := "chat"
	eventBus := eventbus.Default()
	subscription, err := eventBus.Subscribe(context.Background(), topicName, subscriptionPrefix, s.handleEventBusMessage)
	if err != nil {
		return fmt.Errorf("failed to subscribe to topic %s: %w", topicName, err)
	}

	s.eventBusSubscription = subscription
	return nil
}

func (c *ChatConnection) addBufferedTopicMessage(topicMessage *conversationdto.TopicMessage) error {
	if topicMessage == nil {
		return nil
	}
	seq := topicMessage.GetSeq()
	if _, present := c.bufferedTopicMessages[seq]; present {
		return fmt.Errorf("topic message with seq %d already exists in buffer", seq)
	}
	c.bufferedTopicMessages[seq] = topicMessage
	return nil
}

func (s *Service) tryFlushConnection(
	ctx context.Context,
	connection *ChatConnection,
	forceFlush bool,
) (finished bool, err error) {
	// iterate through buffered topic message
	// if:
	//   (1) the seq is exactly 1 greater than sentSeq, or
	//   (2) the seq is more than GAP_MAX (e.g., 5) greater than sentSeq
	// then we can push this message to client and update sentSeq
	const GAP_MAX = 5

	orderedKeys := make([]int64, 0)
	for key := range connection.bufferedTopicMessages {
		orderedKeys = append(orderedKeys, key)
	}
	slices.Sort(orderedKeys)

	for _, seq := range orderedKeys {
		if seq <= connection.sentSeq {
			// already sent, just remove from buffer
			delete(connection.bufferedTopicMessages, seq)
			continue
		}

		canSend := forceFlush || (seq == connection.sentSeq+1) || (seq > connection.sentSeq+GAP_MAX)
		if !canSend {
			break
		}
		connection.sentSeq = seq

		topicMessage := connection.bufferedTopicMessages[seq]
		delete(connection.bufferedTopicMessages, seq)

		if s.flushTopicMessage(ctx, connection, seq, topicMessage) {
			return true, nil
		}
	}

	return false, nil
}

// flushTopicMessage processes one buffered topic message: filters out internal/empty
// content, sends a chunk event when applicable, and emits a done event when the
// response is final. Returns true if the turn finished.
func (s *Service) flushTopicMessage(
	ctx context.Context,
	connection *ChatConnection,
	seq int64,
	topicMessage *conversationdto.TopicMessage,
) bool {
	if topicMessage == nil {
		return false
	}
	resp := topicMessage.ChatResponse
	if resp == nil {
		logger.CtxWarn(ctx, "chat_topic_message_skipped_nil_response conversationId=%d turnId=%d seq=%d",
			connection.conversationId, connection.turnId, seq)
		return false
	}

	content := resp.Content
	if content == nil || (resp.IsInternal && content.Type != conversationdto.ChatContentType_CHAT_CONTENT_TYPE_ERROR) {
		return false
	}

	msg := s.chatResponseToMessage(
		ctx, connection.conversationId, connection.username,
		connection.agentInstance.GetId(), connection.turnId, resp,
	)
	if ctype, ccontent, emit := NormalizeMessageContent(msg); emit {
		s.sendChunkEvent(ctx, connection, seq, resp, ctype, ccontent)
	}

	if resp.GetIsFinal() {
		s.sendDoneEvent(ctx, connection, seq)
		return true
	}
	return false
}

func (s *Service) sendChunkEvent(
	ctx context.Context,
	connection *ChatConnection,
	seq int64,
	resp *conversationdto.ChatResponse,
	ctype conversationdto.MessageContentType,
	ccontent string,
) {
	payload, marshalErr := jsoniter.Marshal(conversationdto.ChatStreamResponse{
		Type:            ctype,
		Content:         ccontent,
		FunctionContext: resp.Content.GetFunctionContext(),
		Timestamp:       resp.GetTimestamp(),
		IsFinal:         resp.GetIsFinal(),
		Role:            roleAssistant,
		ConversationID:  connection.conversationId,
		TurnID:          connection.turnId,
	})
	if marshalErr != nil {
		logger.CtxError(ctx, "chat_stream_response_marshal_failed conversationId=%d turnId=%d seq=%d err=%v",
			connection.conversationId, connection.turnId, seq, marshalErr)
		return
	}

	sendErr := connection.sender.Send(ctx, buildMessageEvent(payload))
	if sendErr == nil {
		return
	}
	// the sse stream can be closed by client at any time, so we just log the error and
	// continue waiting for new messages, as we need to persist the full response anyway.
	if errors.Is(sendErr, context.Canceled) {
		connection.sender.NotifyClosed()
		connection.notifyDone <- struct{}{}
	}
	logger.CtxWarn(ctx, "chat_chunk_send_failed conversationId=%d turnId=%d seq=%d err=%v",
		connection.conversationId, connection.turnId, seq, sendErr)
}

func (s *Service) sendDoneEvent(ctx context.Context, connection *ChatConnection, seq int64) {
	if err := connection.sender.Send(ctx, buildDoneEvent()); err != nil {
		logger.CtxWarn(ctx, "chat_done_send_failed conversationId=%d turnId=%d seq=%d err=%v",
			connection.conversationId, connection.turnId, seq, err)
	}
	connection.sender.NotifyClosed()
	connection.notifyDone <- struct{}{}
}

func (s *Service) tryPushChatResponseToConnection(
	ctx context.Context,
	topicMessage *conversationdto.TopicMessage,
	connection *ChatConnection,
	useLock bool,
) (finished bool, err error) {
	finished = false

	// try to get busy mutex
	if useLock {
		connection.busyMutex.Lock()
		defer connection.busyMutex.Unlock()
	}

	connection.lastActive = time.Now()
	if topicMessage.Seq > connection.sentSeq {
		err = connection.addBufferedTopicMessage(topicMessage)
		if err != nil {
			return false, err
		}
		finished, err = s.tryFlushConnection(ctx, connection, false)
		return finished, err
	} else {
		return false, nil
	}
}

func (s *Service) tryPushChatResponseToConnections(ctx context.Context, topicMessage *conversationdto.TopicMessage) error {
	conversationId := topicMessage.ConversationId
	turnId := topicMessage.TurnId
	chatConnectionIdentifier := ChatConnectionIdentifier{
		ConversationId: conversationId,
		TurnId:         turnId,
	}
	connections := s.chatConnections[chatConnectionIdentifier]
	if len(connections) == 0 {
		return nil
	}

	for _, connection := range connections {
		_, err := s.tryPushChatResponseToConnection(ctx, topicMessage, connection, true)
		if err != nil {
			return err
		}
	}

	// remove all closed connections for this conversationId
	s.removeInactiveConnection(chatConnectionIdentifier)

	return nil
}

func (s *Service) handleEventBusMessage(ctx context.Context, message *eventbus.EventBusMessage) error {
	topicMessage := &conversationdto.TopicMessage{}
	logger.Info("received %s", string(message.Payload))
	if err := jsoniter.Unmarshal(message.Payload, topicMessage); err != nil {
		logger.CtxError(ctx, "chat_eventbus_message_unmarshal_failed err=%v", err)
		return err
	}
	if err := s.tryPushChatResponseToConnections(ctx, topicMessage); err != nil {
		logger.CtxError(ctx, "chat_connection_push_failed conversationId=%d turnId=%d seq=%d err=%v",
			topicMessage.ConversationId, topicMessage.TurnId, topicMessage.Seq, err)
		return err
	}
	return nil
}

func checkKeepalive(ctx context.Context, connection *ChatConnection) {
	readEnvVariableChatKeepaliveCheckIntervalOnce.Do(loadChatKeepaliveCheckInterval)

	if chatKeepaliveCheckInterval <= 0 {
		return
	}

	ticker := time.NewTicker(chatKeepaliveCheckInterval)
	firstRound := true
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			checkTimeInterval := chatKeepaliveCheckInterval
			if firstRound {
				checkTimeInterval = consts.ChatKeepaliveCheckIntervalFirstRoundMultiplier *
					chatKeepaliveCheckInterval
				firstRound = false
			}

			// lock the mutex to read lastActive
			connection.busyMutex.Lock()
			lastActive := connection.lastActive
			connection.busyMutex.Unlock()

			if time.Since(lastActive) > checkTimeInterval {
				notifyKeepaliveTimeout(ctx, connection, checkTimeInterval)
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func loadChatKeepaliveCheckInterval() {
	intervalStr := strings.ToLower(strings.TrimSpace(env.GetOrDefault(consts.ChatKeepaliveCheckInterval, "")))
	chatKeepaliveCheckInterval = 0
	if intervalStr == "off" || intervalStr == "" || intervalStr == "never" {
		return
	}
	intervalSeconds, err := strconv.Atoi(intervalStr)
	if err != nil {
		logger.Error("invalid chat keepalive check interval: %v, error: %v", intervalStr, err)
		return
	}
	if intervalSeconds < 0 {
		logger.Error("invalid chat keepalive check interval: %v, must be non-negative", intervalStr)
		return
	}
	chatKeepaliveCheckInterval = time.Duration(intervalSeconds) * time.Second
}

func notifyKeepaliveTimeout(ctx context.Context, connection *ChatConnection, checkTimeInterval time.Duration) {
	logger.CtxWarn(ctx, "chat_keepalive_timeout conversationId=%d turnId=%d idle_threshold=%v",
		connection.conversationId, connection.turnId, checkTimeInterval)
	// send an event notifying that connection is dead
	payload, marshalErr := jsoniter.Marshal(conversationdto.ChatStreamResponse{
		Type:            conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_ERROR,
		Content:         "EventBus connection unexpectedly closed",
		FunctionContext: nil,
		Timestamp:       time.Now().UnixMilli(),
		IsFinal:         false,
		Role:            roleAssistant,
		TurnID:          connection.turnId,
	})
	if marshalErr != nil {
		logger.CtxError(ctx, "chat_keepalive_event_marshal_failed conversationId=%d turnId=%d err=%v",
			connection.conversationId, connection.turnId, marshalErr)
	} else if sendErr := connection.sender.Send(ctx, buildMessageEvent(payload)); sendErr != nil {
		if errors.Is(sendErr, context.Canceled) {
			connection.sender.NotifyClosed()
		}
		logger.CtxWarn(ctx, "chat_keepalive_send_failed conversationId=%d turnId=%d err=%v",
			connection.conversationId, connection.turnId, sendErr)
	}
	connection.sender.NotifyClosed()
	connection.notifyDone <- struct{}{}
}

// Chat bridges the HTTP SSE endpoint to the gRPC ChatService StreamChat call.
func (s *Service) Chat(ctx context.Context, sender sse.SSESender, req *conversationdto.ChatRequestHttp) error {
	if s.chatClient == nil {
		return apperr.New(errcode.ConversationChatServiceUnavailable, "chat service client is not configured")
	}

	username := middleware.MustGetUsernameFromCtx(ctx)
	logger.CtxInfo(ctx, "chat_request_received agentInstanceId=%d requestAttachmentCount=%d username=%s",
		req.AgentInstanceID,
		len(req.Attachments),
		username,
	)
	if req.AgentInstanceID == 0 {
		return apperr.New(errcode.ConversationAgentInstanceRequired, "agentInstanceId is required")
	}

	singleAgent, agentInstance, err := s.resolveAgentContext(ctx, req.AgentInstanceID)
	if err != nil {
		return err
	}

	if singleAgent == nil {
		return apperr.New(errcode.ConversationAgentRequired, "agent not found for the given agentId or agentInstanceId")
	}
	// ensure agent ID is set for downstream usage, in case only agentInstanceId is provided.
	agentID := singleAgent.GetAgentId()

	requestAttachments := req.Attachments
	s.ensureChatAttachmentSAS(ctx, requestAttachments)

	agentAttachments := make([]*commondto.Attachment, 0)
	if agentInstance != nil {
		agentAttachments = agentInstance.GetAttachments()
		s.ensureChatAttachmentSAS(ctx, agentAttachments)
	}

	conversation, err := s.ensureConversation(ctx, agentID, req.AgentInstanceID, username)
	if err != nil {
		return err
	}

	turnID := s.nextTurnID(ctx, conversation)
	if err := s.persistChatUserMessage(ctx, conversation, req, username, turnID, requestAttachments); err != nil {
		return err
	}

	chatReq := s.buildChatRequest(
		ctx,
		req,
		username,
		singleAgent,
		agentInstance,
		conversation,
		turnID,
		requestAttachments,
		agentAttachments,
	)
	logger.CtxInfo(ctx,
		"chat_stream_start conversationId=%d turnId=%d agentId=%s "+
			"agentInstanceId=%d model=%s requestAttachmentCount=%d agentAttachmentCount=%d",
		conversation.ID,
		turnID,
		chatReq.AgentId,
		chatReq.AgentInstanceId,
		chatReq.Model,
		len(requestAttachments),
		len(agentAttachments),
	)

	channel := make(chan struct{})
	connection := &ChatConnection{
		ctx:                   ctx,
		sender:                sender,
		notifyDone:            channel,
		agent:                 singleAgent,
		agentInstance:         agentInstance,
		username:              username,
		turnId:                turnID,
		conversationId:        conversation.ID,
		busyMutex:             sync.Mutex{},
		bufferedTopicMessages: make(map[int64]*conversationdto.TopicMessage),
		lastActive:            time.Now(),
	}

	s.registerChatConnection(conversation.ID, turnID, connection)

	safego.Go(ctx, func() {
		// Use WithoutCancel so the gRPC stream survives SSE disconnection,
		// while still propagating the OTel trace context to core.
		streamErr := s.startCoreChat(ctx, chatReq)
		if streamErr != nil {
			logger.CtxError(ctx,
				"chat_grpc_stream_failed conversationId=%d turnId=%d agentInstanceId=%d model=%s err=%v",
				conversation.ID, turnID, req.AgentInstanceID, chatReq.Model, streamErr)
			// Send a message to channel to unblock the HTTP handler and return error to client
			connection.sender.NotifyClosed()
			connection.notifyDone <- struct{}{}
			return
		}
	})

	safego.Go(ctx, func() { checkKeepalive(ctx, connection) })

	// message sending will be handled elsewhere, we
	// just listen the channel to receive a signal and then return
	<-channel

	return nil
}

func (s *Service) startCoreChat(ctx context.Context, chatReq *conversationdto.ChatRequest) error {
	if err := s.waitCoreChatReady(ctx); err != nil {
		return err
	}
	_, err := s.chatClient.StreamChat(context.WithoutCancel(ctx), chatReq, grpc.WaitForReady(true))
	return err
}

func (s *Service) waitCoreChatReady(ctx context.Context) error {
	if s.coreGRPC == nil {
		return nil
	}
	waitCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), coreChatStartTimeout)
	defer cancel()

	s.coreGRPC.ResetConnectBackoff()
	s.coreGRPC.Connect()
	for {
		state := s.coreGRPC.GetState()
		if state == connectivity.Ready {
			return nil
		}
		if !s.coreGRPC.WaitForStateChange(waitCtx, state) {
			if err := waitCtx.Err(); err != nil {
				return err
			}
			return context.DeadlineExceeded
		}
	}
}

// Chat bridges the HTTP SSE endpoint to the gRPC ChatService StreamChat call.
func (s *Service) Reconnect(ctx context.Context, sender sse.SSESender, req *conversationdto.ReconnectRequest) error {
	if s.chatClient == nil {
		return apperr.New(errcode.ConversationChatServiceUnavailable, "chat service client is not configured")
	}

	username := middleware.MustGetUsernameFromCtx(ctx)
	logger.CtxInfo(ctx, "chat_reconnect_request_received agentInstanceId=%d username=%s", req.AgentInstanceID, username)
	if req.AgentInstanceID == 0 {
		return apperr.New(errcode.ConversationAgentInstanceRequired, "agentInstanceId is required")
	}

	singleAgent, agentInstance, err := s.resolveAgentContext(ctx, req.AgentInstanceID)
	if err != nil {
		return err
	}

	if singleAgent == nil {
		return apperr.New(errcode.ConversationAgentRequired, "agent not found for the given agentId or agentInstanceId")
	}
	// ensure agent ID is set for downstream usage, in case only agentInstanceId is provided.
	agentID := singleAgent.GetAgentId()

	// Reconnect resumes an in-progress turn, so the conversation must already
	// exist. Look it up read-only rather than get-or-create: a missing
	// conversation cannot have an ongoing turn to resume, and creating one here
	// would leave a stray empty conversation as a side effect of a reconnect.
	conversation, err := s.conversationRepo.Get(ctx, username, agentID, req.AgentInstanceID)
	if err != nil {
		logger.CtxError(ctx, "chat_reconnect_conversation_lookup_failed username=%s agentId=%s agentInstanceId=%d err=%v",
			username, agentID, req.AgentInstanceID, err)
		return err
	}

	// No conversation means there is nothing to resume; end the stream without
	// creating a conversation or touching the ongoing-turn cache.
	if conversation == nil {
		logger.CtxInfo(ctx, "chat_reconnect_no_conversation agentInstanceId=%d username=%s", req.AgentInstanceID, username)
		if sendErr := sender.Send(ctx, buildDoneEvent()); sendErr != nil {
			logger.CtxWarn(ctx, "chat_reconnect_done_send_failed err=%v", sendErr)
		}
		sender.NotifyClosed()
		return nil
	}

	sendDoneResponse := func() {
		if err := sender.Send(ctx, buildDoneEvent()); err != nil {
			logger.CtxWarn(ctx, "chat_reconnect_done_send_failed conversationId=%d err=%v", conversation.ID, err)
		}
		sender.NotifyClosed()
	}

	turnID, ok := s.lookupOngoingTurnID(ctx, conversation.ID)
	if !ok {
		sendDoneResponse()
		return nil
	}

	cacheKey := getCacheKeyForOngoingChatTurn(conversation.ID, turnID)
	cachedResponses, err := s.cache.LRange(ctx, cacheKey.chatResponsesCacheKey, 0, -1).Result()
	if err != nil {
		logger.CtxError(ctx, "chat_reconnect_cached_response_list_failed conversationId=%d turnId=%d err=%v",
			conversation.ID, turnID, err)
		sendDoneResponse()
		return nil
	}
	logger.CtxInfo(
		ctx,
		"chat_reconnect_resume_start conversationId=%d turnId=%d "+
			"agentId=%s agentInstanceId=%d cachedResponseCount=%d",
		conversation.ID,
		turnID,
		agentID,
		req.AgentInstanceID,
		len(cachedResponses),
	)

	channel := make(chan struct{})
	connection := &ChatConnection{
		ctx:                   ctx,
		sender:                sender,
		notifyDone:            channel,
		agent:                 singleAgent,
		agentInstance:         agentInstance,
		username:              username,
		turnId:                turnID,
		conversationId:        conversation.ID,
		busyMutex:             sync.Mutex{},
		bufferedTopicMessages: make(map[int64]*conversationdto.TopicMessage),
		lastActive:            time.Now(),
	}

	// lock the mutex to block message pushing until we finish pushing cached messages for this turn
	connection.busyMutex.Lock()
	s.registerChatConnection(conversation.ID, turnID, connection)
	finished := s.replayCachedResponses(ctx, connection, cachedResponses)
	// unlock the mutex to allow message pushing for new incoming messages for this turn
	connection.busyMutex.Unlock()

	if finished {
		s.removeInactiveConnection(ChatConnectionIdentifier{
			ConversationId: conversation.ID,
			TurnId:         turnID,
		})
	}

	safego.Go(ctx, func() { checkKeepalive(ctx, connection) })

	// message sending will be handled elsewhere, we
	// just listen the channel to receive a signal and then return
	<-channel
	return nil
}

// lookupOngoingTurnID returns the turn ID of an ongoing turn for the conversation,
// or false if there is no ongoing turn / the cached value cannot be parsed.
func (s *Service) lookupOngoingTurnID(ctx context.Context, conversationID int64) (int64, bool) {
	cacheKey := getCacheKeyForOngoingChatTurn(conversationID, 0)
	turnIdStr, err := s.cache.Get(ctx, cacheKey.turnIdCacheKey).Result()
	if err != nil {
		logger.CtxInfo(ctx, "chat_reconnect_no_ongoing_turn conversationId=%d err=%v", conversationID, err)
		return 0, false
	}

	turnID, err := strconv.ParseInt(turnIdStr, 10, 64)
	if err != nil {
		logger.CtxError(ctx, "chat_reconnect_turn_id_parse_failed conversationId=%d turnIdStr=%s err=%v",
			conversationID, turnIdStr, err)
		return 0, false
	}
	return turnID, true
}

// replayCachedResponses pushes any cached topic messages to the connection and
// returns whether the turn was already finished according to the cached stream.
func (s *Service) replayCachedResponses(ctx context.Context, connection *ChatConnection, cachedResponses []string) bool {
	finished := false
	for _, cachedResp := range cachedResponses {
		topicMessage := &conversationdto.TopicMessage{}
		if err := jsoniter.Unmarshal([]byte(cachedResp), topicMessage); err != nil {
			logger.CtxWarn(
				ctx,
				"chat_reconnect_cached_response_unmarshal_failed conversationId=%d turnId=%d err=%v",
				connection.conversationId, connection.turnId, err,
			)
			continue
		}

		turnFinished, err := s.tryPushChatResponseToConnection(ctx, topicMessage, connection, false)
		if err != nil {
			logger.CtxWarn(ctx,
				"chat_reconnect_cached_response_push_failed conversationId=%d turnId=%d seq=%d err=%v",
				connection.conversationId, connection.turnId, topicMessage.Seq, err,
			)
			continue
		}
		if turnFinished {
			finished = true
			break
		}
	}
	return finished
}

func (s *Service) ensureConversation(
	ctx context.Context,
	agentID string,
	agentInstanceId int64,
	username string,
) (*conventity.Conversation, error) {
	conv, err := s.conversationRepo.Get(ctx, username, agentID, agentInstanceId)
	if err != nil {
		logger.CtxError(ctx, "chat_conversation_lookup_failed username=%s agentId=%s agentInstanceId=%d err=%v",
			username, agentID, agentInstanceId, err)
		return nil, err
	}
	if conv != nil {
		return conv, nil
	}

	conv, err = s.conversationRepo.Create(ctx, &conventity.Conversation{
		CreatorUsername: username,
		AgentInstanceID: agentInstanceId,
		AgentID:         agentID,
		Title:           "UNUSED TITLE",
	})
	if err != nil {
		logger.CtxError(ctx, "chat_conversation_create_failed username=%s agentId=%s agentInstanceId=%d err=%v",
			username, agentID, agentInstanceId, err)
		return nil, err
	}

	return conv, nil
}

func (s *Service) nextTurnID(ctx context.Context, conversation *conventity.Conversation) int64 {
	lastTurnID, err := s.messageRepo.GetLatestTurnID(ctx, conversation.ID)
	if err != nil {
		logger.CtxWarn(ctx, "chat_turn_lookup_failed conversationId=%d err=%v", conversation.ID, err)
		return 0
	}

	return lastTurnID + 1
}

// resolveAgentModel returns the agent's configured default model key.
// If the agent has no LLMHub config or no default set, returns empty string
// so that the core service falls back to the platform default model.
func resolveAgentModel(agent *singleagentpb.SingleAgent) string {
	if agent == nil {
		return ""
	}

	cfg := agent.GetLlmhubConfig()
	if cfg == nil {
		return ""
	}

	return cfg.GetDefaultGlobalModelKey()
}

func buildUserChatContent(message string, attachments []*commondto.Attachment) *conversationdto.ChatContent {
	return &conversationdto.ChatContent{
		Type:        conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:     message,
		Attachments: attachments,
	}
}

func (s *Service) buildChatRequest(
	ctx context.Context,
	req *conversationdto.ChatRequestHttp,
	username string,
	singleAgent *singleagentpb.SingleAgent,
	agentInstance *singleagentpb.SingleAgentInstance,
	conversation *conventity.Conversation,
	turnID int64,
	requestAttachments []*commondto.Attachment,
	agentAttachments []*commondto.Attachment,
) *conversationdto.ChatRequest {
	var (
		agentInstanceName string
		projectName       string
		agentRole         string
		projectId         int64
	)

	if agentInstance != nil {
		agentInstanceName = agentInstance.GetName()
		projectId = agentInstance.GetProjectId()
		agentRole = agentInstance.GetRole()

		if projectId != 0 && s.projectSvc != nil {
			project, err := s.projectSvc.GetProject(ctx, &projectdto.GetProjectDetailRequest{Id: projectId})
			if err != nil {
				logger.CtxWarn(ctx, "chat_project_lookup_failed projectId=%d err=%v", projectId, err)
			} else if project != nil && project.GetData() != nil {
				projectName = project.GetData().GetName()
			}
		}
	}

	return &conversationdto.ChatRequest{
		Username:          username,
		Message:           buildUserChatContent(req.Message, requestAttachments),
		AgentId:           singleAgent.GetAgentId(),
		AgentName:         singleAgent.GetName(),
		AgentInstanceId:   req.AgentInstanceID,
		AgentInstanceName: agentInstanceName,
		ConversationId:    conversation.ID,
		ProjectName:       projectName,
		TurnId:            turnID,
		AgentAttachments:  agentAttachments,
		ProjectId:         projectId,
		Model:             resolveAgentModel(singleAgent),
		AgentRole:         agentRole,
	}
}

func (s *Service) registerChatConnection(conversationID, turnID int64, connection *ChatConnection) {
	identifier := ChatConnectionIdentifier{
		ConversationId: conversationID,
		TurnId:         turnID,
	}
	if s.chatConnections[identifier] == nil {
		s.chatConnections[identifier] = make([]*ChatConnection, 0)
	}
	s.chatConnections[identifier] = append(s.chatConnections[identifier], connection)
}

func (s *Service) ensureChatAttachmentSAS(ctx context.Context, attachments []*commondto.Attachment) {
	for _, att := range attachments {
		if att == nil {
			continue
		}
		existingSAS := strings.TrimSpace(att.GetSasUrl())
		if existingSAS != "" {
			lowSAS := strings.ToLower(existingSAS)
			if strings.HasPrefix(lowSAS, "http://") || strings.HasPrefix(lowSAS, "https://") {
				continue
			}
		}
		uri := strings.TrimSpace(att.GetUri())
		if uri == "" {
			continue
		}

		// Skip if already a URL
		lowURI := strings.ToLower(uri)
		if strings.HasPrefix(lowURI, "http://") || strings.HasPrefix(lowURI, "https://") {
			continue
		}

		resp, err := s.projectSvc.GetProjectSASAsset(ctx, &projectdto.GetProjectSASAssetRequest{Uri: uri})
		if err != nil {
			logger.CtxWarn(ctx, "chat_attachment_sas_resolve_failed uri=%s err=%v", uri, err)
			continue
		}

		data := resp.GetData()
		if data == nil {
			continue
		}

		att.SasUrl = strings.TrimSpace(data.GetSasUrl())
	}
}

func (s *Service) persistChatUserMessage(
	ctx context.Context,
	conversation *conventity.Conversation,
	req *conversationdto.ChatRequestHttp,
	username string,
	turnID int64,
	attachments []*commondto.Attachment,
) error {
	if s.messageRepo == nil || conversation == nil || turnID == 0 {
		return nil
	}

	msg := &message.Message{
		ConversationId:  conversation.ID,
		TurnId:          turnID,
		Username:        username,
		AgentInstanceId: req.AgentInstanceID,
		Role:            roleUser,
		ContentType:     conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         req.Message,
		Attachments:     attachments,
	}

	if _, err := s.messageRepo.Create(ctx, msg); err != nil {
		logger.CtxWarn(ctx, "chat_user_message_persist_failed conversationId=%d turnId=%d agentInstanceId=%d err=%v",
			conversation.ID, turnID, req.AgentInstanceID, err)
		return err
	}

	return nil
}

func (s *Service) chatResponseToMessage(
	ctx context.Context,
	conversationId int64,
	username string,
	agentInstanceID int64,
	turnID int64,
	resp *conversationdto.ChatResponse,
) *message.Message {
	content := resp.GetContent()
	if content == nil {
		return nil
	}

	if content.GetType() == conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT && content.GetContent() == "" {
		return nil
	}

	timestamp := resp.GetTimestamp()

	msg := &message.Message{
		ConversationId:  conversationId,
		TurnId:          turnID,
		Username:        username,
		AgentInstanceId: agentInstanceID,
		Role:            roleAssistant,
		ContentType:     content.GetType(),
		Content:         content.GetContent(),
		FunctionContext: resp.Content.FunctionContext,
		CreatedAt:       timestamp,
		UpdatedAt:       timestamp,
	}
	return msg
}

func (s *Service) resolveAgentContext(
	ctx context.Context,
	agentInstanceID int64,
) (*singleagentpb.SingleAgent, *singleagentpb.SingleAgentInstance, error) {
	if s.agentSvc == nil {
		return nil, nil, nil
	}

	var instance *singleagentpb.SingleAgentInstance

	if agentInstanceID == 0 {
		return nil, nil, apperr.New(errcode.ConversationAgentInstanceRequired, "agentInstanceId is required")
	}

	instanceResp, err := s.agentSvc.GetSingleAgentInstance(ctx, agentInstanceID)
	if err != nil {
		logger.CtxWarn(ctx, "chat_agent_instance_lookup_failed agentInstanceId=%d err=%v", agentInstanceID, err)
		return nil, nil, err
	}
	instance = instanceResp.SingleAgentInstance
	if instance == nil {
		return nil, nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
	}
	agentID := instance.GetAgentId()

	var agent *singleagentpb.SingleAgent
	agentResp, err := s.agentSvc.GetSingleAgent(ctx, &singleagentpb.GetSingleAgentRequest{AgentId: agentID})
	if err != nil {
		logger.CtxWarn(ctx, "chat_agent_lookup_failed agentId=%s agentInstanceId=%d err=%v",
			agentID, agentInstanceID, err)
		return nil, nil, err
	} else if data := agentResp.GetData(); data != nil {
		agent = data.GetAgent()
	}

	return agent, instance, nil
}

type cacheKeyForOngoingChatTurn struct {
	turnIdCacheKey        string
	chatResponsesCacheKey string
}

func getCacheKeyForOngoingChatTurn(conversationId int64, turnId int64) cacheKeyForOngoingChatTurn {
	return cacheKeyForOngoingChatTurn{
		turnIdCacheKey:        fmt.Sprintf("ongoing-chat:conversation:%d", conversationId),
		chatResponsesCacheKey: fmt.Sprintf("ongoing-chat:conversation:%d:turn:%d", conversationId, turnId),
	}
}

func (s *Service) removeInactiveConnection(chatConnectionIdentifier ChatConnectionIdentifier) {
	activeConnections := make([]*ChatConnection, 0)
	for _, conn := range s.chatConnections[chatConnectionIdentifier] {
		if !conn.sender.Done() {
			activeConnections = append(activeConnections, conn)
		}
	}
	if len(activeConnections) == 0 {
		delete(s.chatConnections, chatConnectionIdentifier)
	}
	s.chatConnections[chatConnectionIdentifier] = activeConnections
}
