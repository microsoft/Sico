package repository

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/notification"
	"sico-backend/internal/store/notification/internal/dal"
)

func NewNotificationRepo(db *gorm.DB) NotificationRepo {
	return WithTracingNotificationRepo(dal.NewNotificationDAO(db))
}

type NotificationRepo interface {
	Create(ctx context.Context, record *entity.Notification) (int64, error)
	Update(ctx context.Context, record *entity.Notification) error
	Delete(ctx context.Context, id int64) error
	SetStatus(ctx context.Context, id int64, status entity.NotificationStatus) error
	ListByReceiverUsername(
		ctx context.Context,
		receiverUsername string,
		offset int,
		limit int,
	) ([]*entity.Notification, int64, error)
	ListByProjectID(
		ctx context.Context,
		projectID int64,
		offset int,
		limit int,
	) ([]*entity.Notification, int64, error)
	MarkAllAsReadByReceiverUsername(ctx context.Context, receiverUsername string) ([]int64, error)
}
