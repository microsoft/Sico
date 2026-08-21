package repository

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/conversation/conversation"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/store/conversation/conversation/internal/dal"
)

func NewConversationRepo(db *gorm.DB, idGen idgen.IDGenerator) ConversationRepo {
	return WithTracingConversationRepo(dal.NewConversationDAO(db, idGen))
}

type ConversationRepo interface {
	Create(ctx context.Context, msg *entity.Conversation) (*entity.Conversation, error)
	Update(ctx context.Context, msg *entity.Conversation) error
	UpdateTitleIfCurrent(ctx context.Context, id int64, currentTitle, nextTitle string) (int64, error)
	GetByID(ctx context.Context, id int64) (*entity.Conversation, error)
	Get(ctx context.Context, username string, agentID string, agentInstanceID int64) (*entity.Conversation, error)
	Delete(ctx context.Context, id int64) (int64, error)
	List(
		ctx context.Context,
		username string, agentID string, agentInstanceID int64,
		limit int, page int,
	) ([]*entity.Conversation, bool, error)
}
