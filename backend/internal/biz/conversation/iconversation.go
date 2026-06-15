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

package conversation

import (
	"context"

	"sico-backend/internal/infra/sse"
	dto "sico-backend/internal/transport/http/dto/conversation"
	reverse_rpc "sico-backend/internal/transport/reverse_grpc/pb/conversation"
)

// Service defines the conversation business contract consumed by handlers.
type Service interface {
	UpdateConversation(
		ctx context.Context,
		req *dto.UpdateConversationRequest,
	) (*dto.UpdateConversationResponse, error)
	GetConversation(
		ctx context.Context,
		req *dto.GetConversationRequest,
	) (*dto.GetConversationResponse, error)
	CreateConversation(
		ctx context.Context,
		req *dto.CreateConversationRequest,
	) (*dto.CreateConversationResponse, error)
	ListConversation(
		ctx context.Context,
		req *dto.ListConversationRequest,
	) (*dto.ListConversationResponse, error)
	ListMessagesByUserAndAgent(
		ctx context.Context,
		req *dto.ListMessagesByUserAndAgentRequest,
	) (*dto.ListMessagesByUserAndAgentResponse, error)
	GetUserMessageByUserAgentTurnID(
		ctx context.Context,
		req *dto.GetUserMessageByUserAgentTurnIDRequest,
	) (*dto.GetUserMessageByUserAgentTurnIDResponse, error)
	ListBatchSummaries(
		ctx context.Context,
		req *dto.ListBatchSummariesRequest,
	) (*dto.ListBatchSummariesResponse, error)

	Chat(ctx context.Context, sender sse.SSESender, req *dto.ChatRequestHttp) error
	Reconnect(ctx context.Context, sender sse.SSESender, req *dto.ReconnectRequest) error
	GetPlan(ctx context.Context, req *dto.GetPlanRequest) (*dto.GetPlanResponse, error)
	CancelPlan(ctx context.Context, req *dto.CancelPlanRequest) (*dto.CancelPlanResponse, error)

	GenerateOnboardRecommendationTasks(
		ctx context.Context,
		req *dto.GenerateOnboardRecommendationTasksRequest,
	) (*dto.GenerateOnboardRecommendationTasksResponse, error)

	reverse_rpc.ReverseConversationRPCServer
}
