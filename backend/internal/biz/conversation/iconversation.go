package conversation

import (
	"context"

	"sico-backend/internal/biz/conversation/model"
	"sico-backend/internal/infra/sse"
	commondto "sico-backend/internal/transport/http/dto/common"
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
	GetConversationRunStatuses(
		ctx context.Context,
		conversationIDs []int64,
	) map[int64]commondto.ConversationRunStatus
	GetAgentInstanceConversationRunStatuses(
		ctx context.Context,
		agentInstanceIDs []int64,
	) map[int64]commondto.ConversationRunStatus
	DeleteConversation(
		ctx context.Context,
		req *dto.DeleteConversationRequest,
	) (*dto.DeleteConversationResponse, error)
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
	ValidateAgentInstanceAccess(ctx context.Context, agentInstanceID int64) error
	RunHeadlessChat(ctx context.Context, req *model.HeadlessChatRequest) (*model.HeadlessChatResponse, error)
	Reconnect(ctx context.Context, sender sse.SSESender, req *dto.ReconnectRequest) error
	GetPlan(ctx context.Context, req *dto.GetPlanRequest) (*dto.GetPlanResponse, error)
	CancelPlan(ctx context.Context, req *dto.CancelPlanRequest) (*dto.CancelPlanResponse, error)

	GenerateOnboardRecommendationTasks(
		ctx context.Context,
		req *dto.GenerateOnboardRecommendationTasksRequest,
	) (*dto.GenerateOnboardRecommendationTasksResponse, error)

	reverse_rpc.ReverseConversationRPCServer
}
