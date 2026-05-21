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
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	"sico-backend/internal/biz/agent"
	singleagententity "sico-backend/internal/entity/agent/singleagent"
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
