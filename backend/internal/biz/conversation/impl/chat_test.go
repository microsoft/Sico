package impl

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"sico-backend/internal/biz/agent"
	conversationmodel "sico-backend/internal/biz/conversation/model"
	singleagententity "sico-backend/internal/entity/agent/singleagent"
	conventity "sico-backend/internal/entity/conversation/conversation"
	messageentity "sico-backend/internal/entity/conversation/message"
	"sico-backend/internal/infra/eventbus"
	"sico-backend/internal/infra/sse"
	conversationrpc "sico-backend/internal/transport/grpc/pb/conversation"
	singleagentpb "sico-backend/internal/transport/http/dto/agent/single_agent"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/pkg/jsoniter"
)

const (
	mockTopic = "mockTopic"
)

type mockChatClient struct {
	conversationrpc.ChatServiceClient
	mockEventBus *eventbus.MockEventBus
}

func (m *mockChatClient) StreamChat(
	ctx context.Context,
	in *conversationdto.ChatRequest,
	opts ...grpc.CallOption,
) (*conversationdto.ChatDirectResponse, error) {
	chatResponses := []*conversationdto.ChatResponse{
		{
			Content: &conversationdto.ChatContent{
				Type:    conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content: "Hello",
			},
		},
		{
			Content: &conversationdto.ChatContent{
				Type:    conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
				Content: "World",
			},
		},
		{
			Content: &conversationdto.ChatContent{
				Type: conversationdto.ChatContentType_CHAT_CONTENT_TYPE_END,
			},
			IsFinal: true,
		},
	}

	topicMessages := make([]*conversationdto.TopicMessage, 0, len(chatResponses))
	for i, resp := range chatResponses {
		topicMessages = append(topicMessages, &conversationdto.TopicMessage{
			ConversationId: in.ConversationId,
			TurnId:         in.TurnId,
			Seq:            int64(i + 1),
			ChatResponse:   resp,
		})
	}

	// Simulate sending messages to the event bus
	for i, msg := range topicMessages {
		payload, _ := jsoniter.Marshal(msg)
		_ = m.mockEventBus.Send(mockTopic, payload, strconv.Itoa(i))
	}

	return &conversationdto.ChatDirectResponse{}, nil
}

type mockAgentService struct {
	agent.Service
}

type headlessChatClient struct {
	conversationrpc.ChatServiceClient
	status    conversationdto.PlanStatus
	plan      *conversationdto.Plan
	streamErr error
}

func (m *headlessChatClient) StreamChat(
	context.Context,
	*conversationdto.ChatRequest,
	...grpc.CallOption,
) (*conversationdto.ChatDirectResponse, error) {
	return &conversationdto.ChatDirectResponse{}, m.streamErr
}

func (m *headlessChatClient) GetPlan(
	context.Context,
	*conversationdto.GetPlanRequest,
	...grpc.CallOption,
) (*conversationdto.GetPlanResponse, error) {
	return &conversationdto.GetPlanResponse{
		Data: &conversationdto.GetPlanData{Status: m.status, Plan: m.plan},
	}, nil
}

func (m *mockAgentService) GetSingleAgentInstance(ctx context.Context, id int64) (*singleagententity.SingleAgentInstance, error) {
	return &singleagententity.SingleAgentInstance{
		SingleAgentInstance: &singleagentpb.SingleAgentInstance{
			Id:      id,
			AgentId: "agent-123",
		},
	}, nil
}

func (m *mockAgentService) GetSingleAgent(
	ctx context.Context,
	req *singleagentpb.GetSingleAgentRequest,
) (*singleagentpb.GetSingleAgentResponse, error) {
	return &singleagentpb.GetSingleAgentResponse{
		Data: &singleagentpb.GetSingleAgentData{
			Agent: &singleagentpb.SingleAgent{
				AgentId: req.AgentId,
				Name:    "Test Agent",
			},
		},
	}, nil
}

func TestResolveChatConversationUsesExplicitConversationID(t *testing.T) {
	service := newTestConversationService()
	ctx := ctxWithUser("alice")
	conv, err := service.conversationRepo.Create(ctx, &conventity.Conversation{
		CreatorUsername: "alice",
		AgentID:         "agent-123",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)

	resolved, err := service.resolveChatConversation(ctx, "agent-123", 42, "alice", conv.ID)

	require.NoError(t, err)
	require.Equal(t, conv.ID, resolved.ID)
}

func TestResolveChatConversationCreatesWhenMissingForLegacyClient(t *testing.T) {
	service := newTestConversationService()
	ctx := ctxWithUser("alice")

	resolved, err := service.resolveChatConversation(ctx, "agent-123", 42, "alice", 0)

	require.NoError(t, err)
	require.NotZero(t, resolved.ID)
	require.Equal(t, int64(42), resolved.AgentInstanceID)
}

func TestResolveChatConversationUsesOnlyExistingConversationForLegacyClient(t *testing.T) {
	service := newTestConversationService()
	ctx := ctxWithUser("alice")
	conv, err := service.conversationRepo.Create(ctx, &conventity.Conversation{
		CreatorUsername: "alice",
		AgentID:         "agent-123",
		AgentInstanceID: 42,
	})
	require.NoError(t, err)

	resolved, err := service.resolveChatConversation(ctx, "agent-123", 42, "alice", 0)

	require.NoError(t, err)
	require.Equal(t, conv.ID, resolved.ID)
}

func TestResolveChatConversationRejectsAmbiguousLegacyClient(t *testing.T) {
	service := newTestConversationService()
	ctx := ctxWithUser("alice")
	for range 2 {
		_, err := service.conversationRepo.Create(ctx, &conventity.Conversation{
			CreatorUsername: "alice",
			AgentID:         "agent-123",
			AgentInstanceID: 42,
		})
		require.NoError(t, err)
	}

	_, err := service.resolveChatConversation(ctx, "agent-123", 42, "alice", 0)

	require.Error(t, err)
	require.Contains(t, err.Error(), "conversationId is required")
}

func TestChat(t *testing.T) {
	mockEventBus := eventbus.NewMockEventBus()
	mockChatClient := &mockChatClient{
		mockEventBus: mockEventBus,
	}
	mockAgentService := &mockAgentService{}
	service := newTestConversationService()
	subscription, err := mockEventBus.Subscribe(
		context.Background(),
		mockTopic,
		"test-subscription",
		service.handleEventBusMessage,
	)
	require.NoError(t, err)
	service.eventBusSubscription = subscription
	service.chatClient = mockChatClient
	service.agentSvc = mockAgentService

	t.Run("success", func(t *testing.T) {
		ctx := ctxWithUser("alice")
		sseSender := sse.NewMockSSESender()
		chatRequest := &conversationdto.ChatRequestHttp{
			AgentInstanceID: 1,
		}
		err = service.Chat(ctx, sseSender, chatRequest)
		require.NoError(t, err)

		// Verify that the SSE sender received the expected events
		allEvents := sseSender.Sent
		sentEvents := make([]*sse.Event, 0)
		for _, event := range allEvents {
			if event.Event != "keepalive" {
				sentEvents = append(sentEvents, event)
			}
		}
		require.Len(t, sentEvents, 4)

		// Unmarshal and verify the content of the message events
		unmarshalled := make([]*conversationdto.ChatStreamResponse, 0, len(sentEvents))
		for _, event := range sentEvents {
			if event.Event == "message" {
				var msg conversationdto.ChatStreamResponse
				err := jsoniter.Unmarshal(event.Data, &msg)
				require.NoError(t, err)
				unmarshalled = append(unmarshalled, &msg)
			}
		}

		require.Equal(t, "Hello", string(unmarshalled[0].Content))
		require.Equal(t, "message", sentEvents[0].Event)
		require.Equal(t, conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_MARKDOWN, unmarshalled[0].Type)

		require.Equal(t, "World", string(unmarshalled[1].Content))
		require.Equal(t, "message", sentEvents[1].Event)
		require.Equal(t, conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_MARKDOWN, unmarshalled[1].Type)

		require.Equal(t, "", string(unmarshalled[2].Content))
		require.Equal(t, "message", sentEvents[2].Event)
		require.Equal(t, conversationdto.MessageContentType_MESSAGE_CONTENT_TYPE_END, unmarshalled[2].Type)

		require.Equal(t, "done", sentEvents[3].Event)
	})
}

func TestRunHeadlessChatReturnsFinalPlanStatus(t *testing.T) {
	service := newTestConversationService()
	service.agentSvc = &mockAgentService{}
	service.chatClient = &headlessChatClient{
		status: conversationdto.PlanStatus_PLAN_STATUS_CANCELLED,
		plan: &conversationdto.Plan{Steps: []*conversationdto.PlanStep{{
			Title: "Publish result",
		}}},
	}

	resp, err := service.RunHeadlessChat(ctxWithUser("alice"), &conversationmodel.HeadlessChatRequest{
		AgentInstanceID: 1,
		Message:         "run scheduled task",
		SubmissionID:    "scheduled-task:7:1000",
		ScheduledTaskID: 7,
	})

	require.NoError(t, err)
	require.NotZero(t, resp.ConversationID)
	require.Equal(t, int64(1), resp.TurnID)
	require.Equal(t, conversationdto.PlanStatus_PLAN_STATUS_CANCELLED, resp.PlanStatus)
	require.Equal(t, "Publish result", resp.Plan.Steps[0].Title)
}

func TestRunHeadlessChatPreservesPlanStatusOnStreamError(t *testing.T) {
	service := newTestConversationService()
	service.agentSvc = &mockAgentService{}
	service.chatClient = &headlessChatClient{
		status:    conversationdto.PlanStatus_PLAN_STATUS_FAILED,
		streamErr: errors.New("stream failed after plan finalization"),
	}

	resp, err := service.RunHeadlessChat(ctxWithUser("alice"), &conversationmodel.HeadlessChatRequest{
		AgentInstanceID: 1,
		Message:         "run scheduled task",
		SubmissionID:    "scheduled-task:7:1000",
		ScheduledTaskID: 7,
	})

	require.Error(t, err)
	require.Equal(t, conversationdto.PlanStatus_PLAN_STATUS_FAILED, resp.PlanStatus)
}

func TestGetFinalAssistantResponseReturnsLatestText(t *testing.T) {
	service := newTestConversationService()
	ctx := context.Background()
	for _, content := range []string{"partial response", "final response"} {
		_, err := service.messageRepo.Create(ctx, &messageentity.Message{
			ConversationId: 7,
			TurnId:         1,
			Role:           roleAssistant,
			ContentType:    conversationdto.ChatContentType_CHAT_CONTENT_TYPE_TEXT,
			Content:        content,
		})
		require.NoError(t, err)
	}

	response := service.getFinalAssistantResponse(ctx, 7, 1)

	require.Equal(t, "final response", response)
}

func TestReconnect(t *testing.T) {
	service := newTestConversationService()
	service.agentSvc = &mockAgentService{}
	// chatClient only needs to be non-nil to pass the guard; the no-conversation
	// path never issues a StreamChat call.
	service.chatClient = &mockChatClient{}

	t.Run("no conversation does not create one and sends done", func(t *testing.T) {
		ctx := ctxWithUser("alice")
		sseSender := sse.NewMockSSESender()
		req := &conversationdto.ReconnectRequest{AgentInstanceID: 1}

		err := service.Reconnect(ctx, sseSender, req)
		require.NoError(t, err)

		// Reconnecting to a non-existent conversation must not create one as a
		// side effect; it should stay absent.
		conv, err := service.conversationRepo.Get(ctx, "alice", "agent-123", 1)
		require.NoError(t, err)
		require.Nil(t, conv)

		// Only a terminal done event is emitted; there is nothing to resume.
		sentEvents := make([]*sse.Event, 0)
		for _, event := range sseSender.Sent {
			if event.Event != "keepalive" {
				sentEvents = append(sentEvents, event)
			}
		}
		require.Len(t, sentEvents, 1)
		require.Equal(t, "done", sentEvents[0].Event)
	})
}

func TestShouldRetryCoreStreamChatStopsAfterOutput(t *testing.T) {
	connection := &ChatConnection{}
	err := status.Error(codes.Unavailable, "core disconnected")

	require.True(t, shouldRetryCoreStreamChat(err, 1, connection))
	connection.sentSeq = 1
	require.False(t, shouldRetryCoreStreamChat(err, 1, connection))
}

// unavailableThenOKChatClient fails the first failAttempts StreamChat calls with
// codes.Unavailable and records the submission id carried by every attempt.
type unavailableThenOKChatClient struct {
	conversationrpc.ChatServiceClient
	failAttempts  int
	calls         int
	submissionIDs []string
}

func (m *unavailableThenOKChatClient) StreamChat(
	ctx context.Context,
	in *conversationdto.ChatRequest,
	opts ...grpc.CallOption,
) (*conversationdto.ChatDirectResponse, error) {
	m.calls++
	m.submissionIDs = append(m.submissionIDs, in.GetSubmissionId())
	if m.calls <= m.failAttempts {
		return nil, status.Error(codes.Unavailable, "core is draining")
	}
	return &conversationdto.ChatDirectResponse{}, nil
}

func newTestChatRequest(service *Service) *conversationdto.ChatRequest {
	return service.buildChatRequest(
		context.Background(),
		&conversationdto.ChatRequestHttp{AgentInstanceID: 1, Message: "hi"},
		"alice",
		&singleagentpb.SingleAgent{},
		nil,
		&conventity.Conversation{ID: 7},
		3,
		nil,
		nil,
	)
}

func TestBuildChatRequestAssignsUniqueSubmissionID(t *testing.T) {
	service := newTestConversationService()

	first := newTestChatRequest(service)
	second := newTestChatRequest(service)

	require.NotEmpty(t, first.GetSubmissionId())
	require.NotEqual(t, first.GetSubmissionId(), second.GetSubmissionId())
}

func TestStreamChatRetryReusesSubmissionID(t *testing.T) {
	chatClient := &unavailableThenOKChatClient{failAttempts: 1}
	service := newTestConversationService()
	service.chatClient = chatClient
	chatReq := newTestChatRequest(service)

	err := service.streamChatWithUnavailableRetry(context.Background(), &ChatConnection{}, chatReq)

	require.NoError(t, err)
	require.Equal(t, 2, chatClient.calls)
	require.NotEmpty(t, chatClient.submissionIDs[0])
	// A transport-level retry must keep the identity so core treats the second
	// attempt as a replay of the same submission rather than a new one.
	require.Equal(t, chatClient.submissionIDs[0], chatClient.submissionIDs[1])
}
