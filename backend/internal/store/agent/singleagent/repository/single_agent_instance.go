package repository

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/store/agent/singleagent/internal/dal"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

func NewSingleAgentInstanceRepo(db *gorm.DB) SingleAgentInstanceRepository {
	return WithTracingSingleAgentInstanceRepository(dal.NewSingleAgentInstanceDAO(db))
}

type SingleAgentInstanceRepository interface {
	Create(ctx context.Context, instance *entity.SingleAgentInstance) (int64, error)
	Get(ctx context.Context, id int64) (*entity.SingleAgentInstance, error)
	MGet(ctx context.Context, ids []int64) ([]*entity.SingleAgentInstance, error)
	Update(ctx context.Context, instance *entity.SingleAgentInstance) error
	Delete(ctx context.Context, id int64) error
	UpdateStatus(ctx context.Context, id int64, status single_agent.SingleAgentInstanceStatus) error
	ListByFilter(
		ctx context.Context,
		filter *entity.ListSingleAgentInstanceFilter,
		offset, limit int,
	) ([]*entity.SingleAgentInstance, int64, error)
}
