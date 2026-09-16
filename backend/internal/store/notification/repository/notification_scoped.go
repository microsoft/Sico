package repository

import (
	"context"
	"fmt"

	entity "sico-backend/internal/entity/notification"
)

func (w *otelTracedNotificationRepo) scoped() (OrganizationScopedNotificationRepo, error) {
	scoped, ok := w.next.(OrganizationScopedNotificationRepo)
	if !ok {
		return nil, fmt.Errorf("notification repository does not support organization scoping")
	}
	return scoped, nil
}

func (w *otelTracedNotificationRepo) GetByOrganization(
	ctx context.Context,
	id, organizationID int64,
) (*entity.Notification, error) {
	scoped, err := w.scoped()
	if err != nil {
		return nil, err
	}
	return scoped.GetByOrganization(ctx, id, organizationID)
}

func (w *otelTracedNotificationRepo) SetStatusByOrganization(
	ctx context.Context,
	id, organizationID int64,
	status entity.NotificationStatus,
) error {
	scoped, err := w.scoped()
	if err != nil {
		return err
	}
	return scoped.SetStatusByOrganization(ctx, id, organizationID, status)
}

func (w *otelTracedNotificationRepo) ListByReceiverUsernameInOrganization(
	ctx context.Context,
	receiverUsername string,
	organizationID int64,
	offset, limit int,
) ([]*entity.Notification, int64, error) {
	scoped, err := w.scoped()
	if err != nil {
		return nil, 0, err
	}
	return scoped.ListByReceiverUsernameInOrganization(ctx, receiverUsername, organizationID, offset, limit)
}

func (w *otelTracedNotificationRepo) ListByProjectIDInOrganization(
	ctx context.Context,
	projectID, organizationID int64,
	offset, limit int,
) ([]*entity.Notification, int64, error) {
	scoped, err := w.scoped()
	if err != nil {
		return nil, 0, err
	}
	return scoped.ListByProjectIDInOrganization(ctx, projectID, organizationID, offset, limit)
}

func (w *otelTracedNotificationRepo) MarkAllAsReadByReceiverUsernameInOrganization(
	ctx context.Context,
	receiverUsername string,
	organizationID int64,
) ([]int64, error) {
	scoped, err := w.scoped()
	if err != nil {
		return nil, err
	}
	return scoped.MarkAllAsReadByReceiverUsernameInOrganization(ctx, receiverUsername, organizationID)
}
