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
	"testing"

	"github.com/stretchr/testify/require"

	convEntity "sico-backend/internal/entity/conversation/conversation"
	msgEntity "sico-backend/internal/entity/conversation/message"
	convMock "sico-backend/internal/store/conversation/conversation/repository/mock"
	msgMock "sico-backend/internal/store/conversation/message/repository/mock"
	convdto "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/conversation"
	"sico-backend/pkg/jwtx"
	"sico-backend/pkg/ptr"
)

func ctxWithUser(username string, roles ...string) context.Context {
	return context.WithValue(context.Background(), middleware.ContextUserKey, jwtx.UserInfo{Name: username, Roles: roles})
}

func newTestConversationService() *Service {
	return &Service{
		conversationRepo: convMock.NewMockConversationRepo(),
		messageRepo:      msgMock.NewMockMessageRepo(),
		chatConnections:  make(map[ChatConnectionIdentifier][]*ChatConnection),
	}
}

// region Conversation CRUD

func TestCreateConversation(t *testing.T) {
	service := newTestConversationService()

	t.Run("success", func(t *testing.T) {
		ctx := ctxWithUser("alice")
		resp, err := service.CreateConversation(ctx, &convdto.CreateConversationRequest{
			Title:           "test conv",
			AgentInstanceId: 42,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Greater(t, resp.Data.Id, int64(0))
	})
}

func TestUpdateConversation(t *testing.T) {
	service := newTestConversationService()

	t.Run("success", func(t *testing.T) {
		ctx := ctxWithUser("alice")
		createResp, err := service.CreateConversation(ctx, &convdto.CreateConversationRequest{
			Title:           "original",
			AgentInstanceId: 42,
		})
		require.NoError(t, err)
		id := createResp.Data.Id

		_, err = service.UpdateConversation(ctx, &convdto.UpdateConversationRequest{
			Id:    id,
			Title: "updated",
		})
		require.NoError(t, err)
	})

	t.Run("not found", func(t *testing.T) {
		ctx := ctxWithUser("alice")
		_, err := service.UpdateConversation(ctx, &convdto.UpdateConversationRequest{
			Id:    999,
			Title: "updated",
		})
		require.Error(t, err)
	})
}

func TestListConversationsStatusCount(t *testing.T) {
	service := newTestConversationService()

	ctx := ctxWithUser("alice")
	// Create conversations with different statuses
	_, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentID:         "agent1",
		AgentInstanceID: 42,
		Status:          1,
	})
	require.NoError(t, err)
	_, err = service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentID:         "agent1",
		AgentInstanceID: 42,
		Status:          2,
	})
	require.NoError(t, err)
}

// region RPC Message Operations

func TestRpcCreateMessage(t *testing.T) {
	service := newTestConversationService()

	t.Run("success", func(t *testing.T) {
		ctx := context.Background()
		resp, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  1,
				TurnId:          1,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "user",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content:         "hello",
			},
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Greater(t, resp.Data.Id, int64(0))
	})

	t.Run("duplicate plan message skips creation", func(t *testing.T) {
		ctx := context.Background()
		// Create first plan message
		resp1, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  1,
				TurnId:          10,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "assistant",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_PLAN,
				Content:         "plan content",
			},
		})
		require.NoError(t, err)
		firstId := resp1.Data.Id

		// Create duplicate plan message - should return existing
		resp2, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  1,
				TurnId:          10,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "assistant",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_PLAN,
				Content:         "plan content v2",
			},
		})
		require.NoError(t, err)
		require.Equal(t, firstId, resp2.Data.Id)
	})
}

func TestRpcListUserMessageByUserAgentTurnID(t *testing.T) {
	service := newTestConversationService()

	ctx := context.Background()
	// Create messages for the query
	_, err := service.messageRepo.Create(ctx, &msgEntity.Message{
		ConversationId:  1,
		TurnId:          1,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "user",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "user message",
	})
	require.NoError(t, err)
	_, err = service.messageRepo.Create(ctx, &msgEntity.Message{
		ConversationId:  1,
		TurnId:          1,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "assistant",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "assistant response",
	})
	require.NoError(t, err)

	t.Run("returns only user messages", func(t *testing.T) {
		resp, err := service.RpcListUserMessageByUserAgentTurnID(ctx, &rgrpc.ListUserMessageByUserAgentTurnIDRequest{
			AgentInstanceId: 42,
			TurnId:          1,
			Username:        "alice",
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Len(t, resp.Data, 1)
		require.Equal(t, "user", resp.Data[0].Role)
	})

	t.Run("invalid agent instance id", func(t *testing.T) {
		resp, err := service.RpcListUserMessageByUserAgentTurnID(ctx, &rgrpc.ListUserMessageByUserAgentTurnIDRequest{
			AgentInstanceId: 0,
			TurnId:          1,
			Username:        "alice",
		})
		require.NoError(t, err)
		require.Nil(t, resp.Data)
	})
}

// region REST Message Operations

func TestListMessagesByUserAndAgent(t *testing.T) {
	service := newTestConversationService()

	ctx := ctxWithUser("alice")
	// Create a conversation
	conv, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentID:         "agent1",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)

	// Create messages in that conversation
	_, err = service.messageRepo.Create(ctx, &msgEntity.Message{
		ConversationId:  conv.ID,
		TurnId:          1,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "user",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "hello",
	})
	require.NoError(t, err)
	_, err = service.messageRepo.Create(ctx, &msgEntity.Message{
		ConversationId:  conv.ID,
		TurnId:          1,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "assistant",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "hi there",
	})
	require.NoError(t, err)

	t.Run("list by agent instance id", func(t *testing.T) {
		resp, err := service.ListMessagesByUserAndAgent(ctx, &convdto.ListMessagesByUserAndAgentRequest{
			AgentInstanceId: 42,
			AgentId:         "agent1",
			Page:            1,
			PageSize:        10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Len(t, resp.Data.Messages, 2)
	})

	t.Run("list by turn id", func(t *testing.T) {
		resp, err := service.ListMessagesByUserAndAgent(ctx, &convdto.ListMessagesByUserAndAgentRequest{
			AgentInstanceId: 42,
			AgentId:         "agent1",
			TurnId:          ptr.Of(int64(1)),
			Page:            1,
			PageSize:        10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Len(t, resp.Data.Messages, 2)
	})

	t.Run("zero agent instance id returns empty", func(t *testing.T) {
		resp, err := service.ListMessagesByUserAndAgent(ctx, &convdto.ListMessagesByUserAndAgentRequest{
			AgentInstanceId: 0,
			Page:            1,
			PageSize:        10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Empty(t, resp.Data.Messages)
	})

	t.Run("agent instance -1 without agent id returns error", func(t *testing.T) {
		_, err := service.ListMessagesByUserAndAgent(ctx, &convdto.ListMessagesByUserAndAgentRequest{
			AgentInstanceId: -1,
			Page:            1,
			PageSize:        10,
		})
		require.Error(t, err)
	})

	t.Run("no conversation returns empty", func(t *testing.T) {
		resp, err := service.ListMessagesByUserAndAgent(ctx, &convdto.ListMessagesByUserAndAgentRequest{
			AgentInstanceId: 999,
			AgentId:         "nonexistent",
			Page:            1,
			PageSize:        10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Empty(t, resp.Data.Messages)
	})
}

func TestGetUserMessageByUserAgentTurnID(t *testing.T) {
	service := newTestConversationService()

	ctx := ctxWithUser("alice")
	// Create conversation and messages
	conv, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentID:         "agent1",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)

	_, err = service.messageRepo.Create(ctx, &msgEntity.Message{
		ConversationId:  conv.ID,
		TurnId:          1,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "user",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "hello",
	})
	require.NoError(t, err)

	t.Run("success", func(t *testing.T) {
		resp, err := service.GetUserMessageByUserAgentTurnID(ctx, &convdto.GetUserMessageByUserAgentTurnIDRequest{
			AgentInstanceId: 42,
			AgentId:         "agent1",
			TurnId:          1,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Equal(t, "user", resp.Data.Role)
	})

	t.Run("zero agent instance id returns nil data", func(t *testing.T) {
		resp, err := service.GetUserMessageByUserAgentTurnID(ctx, &convdto.GetUserMessageByUserAgentTurnIDRequest{
			AgentInstanceId: 0,
			TurnId:          1,
		})
		require.NoError(t, err)
		require.Nil(t, resp.Data)
	})

	t.Run("agent instance -1 without agent id returns error", func(t *testing.T) {
		_, err := service.GetUserMessageByUserAgentTurnID(ctx, &convdto.GetUserMessageByUserAgentTurnIDRequest{
			AgentInstanceId: -1,
			TurnId:          1,
		})
		require.Error(t, err)
	})

	t.Run("no conversation returns nil data", func(t *testing.T) {
		resp, err := service.GetUserMessageByUserAgentTurnID(ctx, &convdto.GetUserMessageByUserAgentTurnIDRequest{
			AgentInstanceId: 999,
			AgentId:         "nonexistent",
			TurnId:          1,
		})
		require.NoError(t, err)
		require.Nil(t, resp.Data)
	})
}
