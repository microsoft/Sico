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

func (m *mockNotificationRepo) GetByOrganization(
	_ context.Context,
	id, organizationID int64,
) (*entity.Notification, error) {
	notification, exists := m.notifications[id]
	if !exists || notification.OrganizationId != organizationID {
		return nil, gorm.ErrRecordNotFound
	}
	return proto.Clone(notification).(*entity.Notification), nil
}

func (m *mockNotificationRepo) SetStatusByOrganization(
	_ context.Context,
	id, organizationID int64,
	status entity.NotificationStatus,
) error {
	notification, exists := m.notifications[id]
	if !exists || notification.OrganizationId != organizationID {
		return gorm.ErrRecordNotFound
	}
	notification.Status = status
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

func (m *mockNotificationRepo) ListByReceiverUsernameInOrganization(
	_ context.Context,
	receiverUsername string,
	organizationID int64,
	offset, limit int,
) ([]*entity.Notification, int64, error) {
	filtered := make([]*entity.Notification, 0)
	for _, notification := range m.notifications {
		if notification.ReceiverUsername == receiverUsername && notification.OrganizationId == organizationID {
			filtered = append(filtered, proto.Clone(notification).(*entity.Notification))
		}
	}
	return paginateNotifications(filtered, offset, limit)
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

func (m *mockNotificationRepo) ListByProjectIDInOrganization(
	_ context.Context,
	projectID, organizationID int64,
	offset, limit int,
) ([]*entity.Notification, int64, error) {
	filtered := make([]*entity.Notification, 0)
	for _, notification := range m.notifications {
		if notification.ProjectId == projectID && notification.OrganizationId == organizationID &&
			notification.ReceiverUsername == "" {
			filtered = append(filtered, proto.Clone(notification).(*entity.Notification))
		}
	}
	return paginateNotifications(filtered, offset, limit)
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

func (m *mockNotificationRepo) MarkAllAsReadByReceiverUsernameInOrganization(
	_ context.Context,
	receiverUsername string,
	organizationID int64,
) ([]int64, error) {
	ids := make([]int64, 0)
	for _, notification := range m.notifications {
		if notification.ReceiverUsername == receiverUsername &&
			notification.OrganizationId == organizationID &&
			notification.Status == pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD {
			notification.Status = pb.NotificationStatus_NOTIFICATION_STATUS_READ
			ids = append(ids, notification.Id)
		}
	}
	return ids, nil
}

func paginateNotifications(
	notifications []*entity.Notification,
	offset, limit int,
) ([]*entity.Notification, int64, error) {
	total := int64(len(notifications))
	if offset >= len(notifications) {
		return []*entity.Notification{}, total, nil
	}
	end := offset + limit
	if end > len(notifications) {
		end = len(notifications)
	}
	return notifications[offset:end], total, nil
}
