package agent

import (
	"context"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

type Service interface {
	GetSingleAgent(ctx context.Context, req *single_agent.GetSingleAgentRequest) (*single_agent.GetSingleAgentResponse, error)
	GetSingleAgentInstance(ctx context.Context, id int64) (*entity.SingleAgentInstance, error)
	GetSingleAgentInstanceNames(ctx context.Context, ids []int64) (map[int64]string, error)
	GetSingleAgentInstanceIconURIs(ctx context.Context, ids []int64) (map[int64]string, error)
	ListSingleAgentInstancesByFilter(
		ctx context.Context, filter *entity.ListSingleAgentInstanceFilter,
		offset, limit int,
	) ([]*entity.SingleAgentInstance, int64, error)
	DismissSingleAgentInstance(
		ctx context.Context, req *single_agent.DismissSingleAgentInstanceRequest,
	) (*single_agent.DismissSingleAgentInstanceResponse, error)
	ReassignSingleAgentInstance(
		ctx context.Context, req *single_agent.ReassignSingleAgentInstanceRequest,
	) (*single_agent.ReassignSingleAgentInstanceResponse, error)
	UpdateSingleAgentInstanceStatus(
		ctx context.Context, req *single_agent.UpdateSingleAgentInstanceStatusRequest,
	) (*single_agent.UpdateSingleAgentInstanceStatusResponse, error)
}

var defaultSvc Service

func Default() Service { return defaultSvc }

func SetDefault(svc Service) { defaultSvc = svc }
