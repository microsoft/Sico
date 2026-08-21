package repository

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/conversation/message"
	"sico-backend/internal/store/conversation/message/internal/dal"
)

type MessageFilter = dal.MessageFilter

func NewMessageRepo(db *gorm.DB) MessageRepo {
	return WithTracingMessageRepo(dal.NewMessageDAO(db))
}

type MessageRepo interface {
	Create(ctx context.Context, msg *entity.Message) (*entity.Message, error)
	GetLatestTurnID(ctx context.Context, conversationID int64) (int64, error)
	ListByFilter(ctx context.Context, filter *MessageFilter) ([]*entity.Message, bool, error)
	ListByConversationPage(ctx context.Context, conversationID int64, page, pageSize int32) ([]*entity.Message, bool, error)
	GetUserMessageByConversationTurnID(ctx context.Context, conversationID int64, turnID int64) (*entity.Message, error)
}
