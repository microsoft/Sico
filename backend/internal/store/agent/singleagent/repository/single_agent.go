package repository

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/store/agent/singleagent/internal/dal"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

func NewSingleAgentRepo(db *gorm.DB) SingleAgentRepository {
	return WithTracingSingleAgentRepository(dal.NewSingleAgentDAO(db))
}

type SingleAgentRepository interface {
	Create(ctx context.Context, creatorUsername string, agent *entity.SingleAgent) error
	Get(ctx context.Context, agentID string) (*entity.SingleAgent, error)
	GetForUpdate(ctx context.Context, agentID string) (*entity.SingleAgent, error)
	Update(ctx context.Context, agent *entity.SingleAgent) error
	Delete(ctx context.Context, agentID string) error
	List(ctx context.Context, creatorUsername string, offset, limit int) ([]*entity.SingleAgent, int64, error)
	ListByFilter(ctx context.Context, filter *entity.ListSingleAgentFilter) ([]*entity.SingleAgent, int64, error)
	ListInfos(ctx context.Context) ([]*single_agent.SingleAgentInfo, error)
	Count(ctx context.Context, creatorUsername string) (int64, error)
}
