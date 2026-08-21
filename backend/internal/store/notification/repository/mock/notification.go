package mock

import (
	"context"

	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	entity "sico-backend/internal/entity/notification"
	"sico-backend/internal/store/notification/repository"
	pb "sico-backend/internal/transport/http/dto/notification"
)

type mockNotificationRepo struct {
	notifications map[int64]*entity.Notification
	counter       int64
}

func NewMockNotificationRepo() repository.NotificationRepo {
	return &mockNotificationRepo{
		notifications: make(map[int64]*entity.Notification),
		counter:       0,
	}
}

func (m *mockNotificationRepo) Create(_ context.Context, record *entity.Notification) (int64, error) {
	m.counter++
	record.Id = m.counter
	m.notifications[record.Id] = proto.Clone(record).(*entity.Notification)
	return record.Id, nil
}

func (m *mockNotificationRepo) Update(_ context.Context, record *entity.Notification) error {
	if _, exists := m.notifications[record.Id]; !exists {
		return gorm.ErrRecordNotFound
	}
	m.notifications[record.Id] = proto.Clone(record).(*entity.Notification)
	return nil
}

func (m *mockNotificationRepo) Delete(_ context.Context, id int64) error {
	if _, exists := m.notifications[id]; !exists {
		return gorm.ErrRecordNotFound
	}
	delete(m.notifications, id)
	return nil
}

func (m *mockNotificationRepo) SetStatus(_ context.Context, id int64, status entity.NotificationStatus) error {
	notification, exists := m.notifications[id]
	if !exists {
		return gorm.ErrRecordNotFound
	}
	clone := proto.Clone(notification).(*entity.Notification)
	clone.Status = status
	m.notifications[id] = clone
	return nil
}

func (m *mockNotificationRepo) ListByReceiverUsername(
	_ context.Context,
	receiverUsername string,
	offset int,
	limit int,
) ([]*entity.Notification, int64, error) {
	var filtered []*entity.Notification
	for _, n := range m.notifications {
		if n.ReceiverUsername == receiverUsername {
			filtered = append(filtered, proto.Clone(n).(*entity.Notification))
		}
	}
	total := int64(len(filtered))
	if offset >= len(filtered) {
		return []*entity.Notification{}, total, nil
	}
	end := offset + limit
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[offset:end], total, nil
}

func (m *mockNotificationRepo) ListByProjectID(
	_ context.Context,
	projectID int64,
	offset int,
	limit int,
) ([]*entity.Notification, int64, error) {
	var filtered []*entity.Notification
	for _, n := range m.notifications {
		if n.ProjectId == projectID {
			filtered = append(filtered, proto.Clone(n).(*entity.Notification))
		}
	}
	total := int64(len(filtered))
	if offset >= len(filtered) {
		return []*entity.Notification{}, total, nil
	}
	end := offset + limit
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[offset:end], total, nil
}

func (m *mockNotificationRepo) MarkAllAsReadByReceiverUsername(
	_ context.Context,
	receiverUsername string,
) ([]int64, error) {
	ids := make([]int64, 0)
	for _, n := range m.notifications {
		if n.ReceiverUsername == receiverUsername &&
			n.Status == pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD {
			n.Status = pb.NotificationStatus_NOTIFICATION_STATUS_READ
			ids = append(ids, n.Id)
		}
	}
	return ids, nil
}
