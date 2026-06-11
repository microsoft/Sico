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
	"google.golang.org/grpc"
	"gorm.io/gorm"

	convEntity "sico-backend/internal/entity/conversation/conversation"
	msgEntity "sico-backend/internal/entity/conversation/message"
	convMock "sico-backend/internal/store/conversation/conversation/repository/mock"
	messagerepo "sico-backend/internal/store/conversation/message/repository"
	msgMock "sico-backend/internal/store/conversation/message/repository/mock"
	conversationrpc "sico-backend/internal/transport/grpc/pb/conversation"
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

type recordingPlanChatClient struct {
	conversationrpc.ChatServiceClient
	getPlanRequests    []*convdto.GetPlanRequest
	cancelPlanRequests []*convdto.CancelPlanRequest
}

type racingDuplicateMessageRepo struct {
	messagerepo.MessageRepo
	stored      *msgEntity.Message
	createCalls int
	listCalls   int
}

func (r *racingDuplicateMessageRepo) Create(_ context.Context, msg *msgEntity.Message) (*msgEntity.Message, error) {
	r.createCalls++
	var stored msgEntity.Message
	stored.TurnId = msg.TurnId
	stored.ConversationId = msg.ConversationId
	stored.Username = msg.Username
	stored.AgentInstanceId = msg.AgentInstanceId
	stored.Role = msg.Role
	stored.ContentType = msg.ContentType
	stored.Content = msg.Content
	stored.FunctionContext = msg.FunctionContext
	stored.Ext = msg.Ext
	stored.Attachments = msg.Attachments
	stored.CreatedAt = msg.CreatedAt
	stored.UpdatedAt = msg.UpdatedAt
	stored.Id = 99
	r.stored = &stored
	return nil, gorm.ErrDuplicatedKey
}

func (r *racingDuplicateMessageRepo) ListByFilter(
	_ context.Context,
	_ *messagerepo.MessageFilter,
) ([]*msgEntity.Message, bool, error) {
	r.listCalls++
	if r.listCalls == 1 || r.stored == nil {
		return []*msgEntity.Message{}, false, nil
	}
	return []*msgEntity.Message{r.stored}, false, nil
}

func (c *recordingPlanChatClient) GetPlan(
	_ context.Context,
	req *convdto.GetPlanRequest,
	_ ...grpc.CallOption,
) (*convdto.GetPlanResponse, error) {
	c.getPlanRequests = append(c.getPlanRequests, req)
	return &convdto.GetPlanResponse{Data: &convdto.GetPlanData{Status: convdto.PlanStatus_PLAN_STATUS_RUNNING}}, nil
}

func (c *recordingPlanChatClient) CancelPlan(
	_ context.Context,
	req *convdto.CancelPlanRequest,
	_ ...grpc.CallOption,
) (*convdto.CancelPlanResponse, error) {
	c.cancelPlanRequests = append(c.cancelPlanRequests, req)
	return &convdto.CancelPlanResponse{}, nil
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

func TestGetPlanWithoutConversationIDResolvesUniqueTurn(t *testing.T) {
	service := newTestConversationService()
	chatClient := &recordingPlanChatClient{}
	service.chatClient = chatClient
	ctx := ctxWithUser("alice")
	conv, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)
	_, err = service.messageRepo.Create(ctx, &msgEntity.Message{
		ConversationId:  conv.ID,
		TurnId:          7,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            roleUser,
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "hello",
	})
	require.NoError(t, err)

	resp, err := service.GetPlan(ctx, &convdto.GetPlanRequest{
		AgentInstanceId: 42,
		Username:        "alice",
		TurnId:          7,
	})

	require.NoError(t, err)
	require.NotNil(t, resp.Data)
	require.Equal(t, convdto.PlanStatus_PLAN_STATUS_RUNNING, resp.Data.Status)
	require.Len(t, chatClient.getPlanRequests, 1)
	require.Equal(t, conv.ID, chatClient.getPlanRequests[0].ConversationId)
}

func TestGetPlanWithoutConversationIDDoesNotGuessWhenTurnMessageMissing(t *testing.T) {
	service := newTestConversationService()
	chatClient := &recordingPlanChatClient{}
	service.chatClient = chatClient
	ctx := ctxWithUser("alice")
	_, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)

	resp, err := service.GetPlan(ctx, &convdto.GetPlanRequest{
		AgentInstanceId: 42,
		Username:        "alice",
		TurnId:          7,
	})

	require.NoError(t, err)
	require.NotNil(t, resp.Data)
	require.Equal(t, convdto.PlanStatus_PLAN_STATUS_NO_PLAN, resp.Data.Status)
	require.Empty(t, chatClient.getPlanRequests)
}

func TestGetPlanWithoutConversationIDDoesNotGuessAmbiguousTurn(t *testing.T) {
	service := newTestConversationService()
	chatClient := &recordingPlanChatClient{}
	service.chatClient = chatClient
	ctx := ctxWithUser("alice")
	firstConv, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)
	secondConv, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
		CreatorUsername: "alice",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)
	for _, conversationID := range []int64{firstConv.ID, secondConv.ID} {
		_, err = service.messageRepo.Create(ctx, &msgEntity.Message{
			ConversationId:  conversationID,
			TurnId:          7,
			Username:        "alice",
			AgentInstanceId: 42,
			Role:            roleUser,
			ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
			Content:         "hello",
		})
		require.NoError(t, err)
	}

	resp, err := service.GetPlan(ctx, &convdto.GetPlanRequest{
		AgentInstanceId: 42,
		Username:        "alice",
		TurnId:          7,
	})

	require.NoError(t, err)
	require.NotNil(t, resp.Data)
	require.Nil(t, resp.Data.Plan)
	require.Equal(t, convdto.PlanStatus_PLAN_STATUS_NO_PLAN, resp.Data.Status)
	require.Empty(t, chatClient.getPlanRequests)
}

func TestCancelPlanWithoutConversationIDDoesNotGuessAmbiguousTurn(t *testing.T) {
	service := newTestConversationService()
	chatClient := &recordingPlanChatClient{}
	service.chatClient = chatClient
	ctx := ctxWithUser("alice")
	for range 2 {
		conv, err := service.conversationRepo.Create(ctx, &convEntity.Conversation{
			CreatorUsername: "alice",
			AgentInstanceID: 42,
		})
		require.NoError(t, err)
		_, err = service.messageRepo.Create(ctx, &msgEntity.Message{
			ConversationId:  conv.ID,
			TurnId:          7,
			Username:        "alice",
			AgentInstanceId: 42,
			Role:            roleUser,
			ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
			Content:         "hello",
		})
		require.NoError(t, err)
	}

	_, err := service.CancelPlan(ctx, &convdto.CancelPlanRequest{
		AgentInstanceId: 42,
		Username:        "alice",
		TurnId:          7,
	})

	require.NoError(t, err)
	require.Empty(t, chatClient.cancelPlanRequests)
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

	t.Run("duplicate recovered task runtime message skips creation", func(t *testing.T) {
		ctx := context.Background()
		recoveryKey := taskRuntimeRecoveryResultPrefix + "batch-1"

		resp1, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  3,
				TurnId:          30,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "assistant",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content:         "Task execution finished after recovery.",
				FunctionContext: &convdto.FunctionContext{Result: recoveryKey},
			},
		})
		require.NoError(t, err)
		firstId := resp1.Data.Id

		resp2, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  3,
				TurnId:          30,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "assistant",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content:         "Updated recovered content",
				FunctionContext: &convdto.FunctionContext{Result: recoveryKey},
			},
		})
		require.NoError(t, err)
		require.Equal(t, firstId, resp2.Data.Id)
	})

	t.Run("duplicate recovered task runtime insert race returns existing", func(t *testing.T) {
		ctx := context.Background()
		repo := &racingDuplicateMessageRepo{MessageRepo: msgMock.NewMockMessageRepo()}
		service := newTestConversationService()
		service.messageRepo = repo

		resp, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  4,
				TurnId:          40,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "assistant",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content:         "Task execution finished after recovery.",
				FunctionContext: &convdto.FunctionContext{
					Result: taskRuntimeRecoveryResultPrefix + "batch-race",
				},
			},
		})

		require.NoError(t, err)
		require.Equal(t, int64(99), resp.Data.Id)
		require.Equal(t, 1, repo.createCalls)
		require.Equal(t, 2, repo.listCalls)
	})

	t.Run("recovered task runtime message skips when assistant final already has artifact", func(t *testing.T) {
		ctx := context.Background()
		normal, err := service.messageRepo.Create(ctx, &msgEntity.Message{
			ConversationId:  5,
			TurnId:          50,
			Username:        "alice",
			AgentInstanceId: 42,
			Role:            "assistant",
			ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
			Content:         "The task did not run.\n\nExecution summary: "+
			"http://localhost:8080/storage/task-runtime/batch/summary.html",
		})
		require.NoError(t, err)

		resp, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  5,
				TurnId:          50,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "assistant",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content:         "Task execution finished after recovery.",
				FunctionContext: &convdto.FunctionContext{
					Result: taskRuntimeRecoveryResultPrefix + "batch-existing-final",
				},
			},
		})

		require.NoError(t, err)
		require.Equal(t, normal.Id, resp.Data.Id)
		messages, _, err := service.messageRepo.ListByFilter(ctx, &messagerepo.MessageFilter{
			ConversationId:  ptr.Of(int64(5)),
			TurnId:          ptr.Of(int64(50)),
			AgentInstanceId: ptr.Of(int64(42)),
			Username:        ptr.Of("alice"),
			Role:            ptr.Of("assistant"),
		})
		require.NoError(t, err)
		require.Len(t, messages, 1)
	})

	t.Run("recovered task runtime message is kept when assistant text has no artifact", func(t *testing.T) {
		ctx := context.Background()
		normal, err := service.messageRepo.Create(ctx, &msgEntity.Message{
			ConversationId:  6,
			TurnId:          60,
			Username:        "alice",
			AgentInstanceId: 42,
			Role:            "assistant",
			ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
			Content:         "The task finished, but I could not render the artifact link.",
		})
		require.NoError(t, err)

		resp, err := service.RpcCreateMessage(ctx, &rgrpc.CreateMessageRequest{
			Message: &msgEntity.Message{
				ConversationId:  6,
				TurnId:          60,
				Username:        "alice",
				AgentInstanceId: 42,
				Role:            "assistant",
				ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content:         "Task execution finished after recovery.",
				FunctionContext: &convdto.FunctionContext{
					Result: taskRuntimeRecoveryResultPrefix + "batch-missing-artifact",
				},
			},
		})

		require.NoError(t, err)
		require.NotEqual(t, normal.Id, resp.Data.Id)
		messages, _, err := service.messageRepo.ListByFilter(ctx, &messagerepo.MessageFilter{
			ConversationId:  ptr.Of(int64(6)),
			TurnId:          ptr.Of(int64(60)),
			AgentInstanceId: ptr.Of(int64(42)),
			Username:        ptr.Of("alice"),
			Role:            ptr.Of("assistant"),
		})
		require.NoError(t, err)
		require.Len(t, messages, 2)
	})

	t.Run("normalized recovered text strips legacy internal marker", func(t *testing.T) {
		marker := legacyTaskRuntimeRecoveryMarkerPrefix + "batch-2 -->"
		contentType, content, include := NormalizeMessageContent(&msgEntity.Message{
			ContentType: convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
			Role:        "assistant",
			Content:     "Task execution finished after recovery.\n\n" + marker,
		})

		require.True(t, include)
		require.Equal(t, convdto.MessageContentType_MESSAGE_CONTENT_TYPE_MARKDOWN, contentType)
		require.Equal(t, "Task execution finished after recovery.", content)
	})

	t.Run("recovered task runtime function context is hidden from listing", func(t *testing.T) {
		item := buildMessageItem(&msgEntity.Message{
			ConversationId:  3,
			TurnId:          30,
			Username:        "alice",
			AgentInstanceId: 42,
			Role:            "assistant",
			ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
			Content:         "Task execution finished after recovery.",
			FunctionContext: &convdto.FunctionContext{Result: taskRuntimeRecoveryResultPrefix + "batch-3"},
		})

		require.NotNil(t, item)
		require.Equal(t, "Task execution finished after recovery.", item.Content)
		require.Empty(t, item.GetFunctionContext().GetResult())
	})
}

func TestBuildMessageResponseSuppressesRedundantRecoveryMessage(t *testing.T) {
	recovery := &msgEntity.Message{
		ConversationId:  3,
		TurnId:          30,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "assistant",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "Task execution finished after recovery.",
		FunctionContext: &convdto.FunctionContext{Result: taskRuntimeRecoveryResultPrefix + "batch-3"},
	}
	normal := &msgEntity.Message{
		ConversationId:  3,
		TurnId:          30,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "assistant",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content: "The task did not run.\n\nExecution summary: " +
			"http://localhost:8080/storage/task-runtime/batch-3/summary.html",
	}

	resp := buildMessageResponse([]*msgEntity.Message{recovery, normal}, false)
	require.Len(t, resp.Messages, 1)
	require.Equal(t, normal.Content, resp.Messages[0].Content)

	plainFinal := &msgEntity.Message{
		ConversationId:  3,
		TurnId:          30,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "assistant",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "The task finished, but no artifact URL was available in this message.",
	}
	plainResp := buildMessageResponse([]*msgEntity.Message{recovery, plainFinal}, false)
	require.Len(t, plainResp.Messages, 2)
	require.Equal(t, "Task execution finished after recovery.", plainResp.Messages[0].Content)
	require.Equal(t, plainFinal.Content, plainResp.Messages[1].Content)

	noLinkFieldText := &msgEntity.Message{
		ConversationId:  3,
		TurnId:          30,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "assistant",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content:         "The report_url field was not available in the final digest.",
	}
	noLinkFieldResp := buildMessageResponse([]*msgEntity.Message{recovery, noLinkFieldText}, false)
	require.Len(t, noLinkFieldResp.Messages, 2)
	require.Equal(t, "Task execution finished after recovery.", noLinkFieldResp.Messages[0].Content)
	require.Equal(t, noLinkFieldText.Content, noLinkFieldResp.Messages[1].Content)

	legacyRecovery := &msgEntity.Message{
		ConversationId:  3,
		TurnId:          30,
		Username:        "alice",
		AgentInstanceId: 42,
		Role:            "assistant",
		ContentType:     convdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
		Content: "Task execution finished after recovery.\n\n" +
			legacyTaskRuntimeRecoveryMarkerPrefix + "batch-legacy -->",
	}
	legacyResp := buildMessageResponse([]*msgEntity.Message{legacyRecovery, normal}, false)
	require.Len(t, legacyResp.Messages, 1)
	require.Equal(t, normal.Content, legacyResp.Messages[0].Content)

	recoveryOnlyResp := buildMessageResponse([]*msgEntity.Message{recovery}, false)
	require.Len(t, recoveryOnlyResp.Messages, 1)
	require.Equal(t, "Task execution finished after recovery.", recoveryOnlyResp.Messages[0].Content)
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
		for _, item := range resp.Data.Messages {
			require.Equal(t, conv.ID, item.ConversationId)
		}
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
