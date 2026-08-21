package dal

import (
	"context"
	"time"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/notification"
	"sico-backend/internal/store/notification/internal/dal/model"
	"sico-backend/internal/store/notification/internal/dal/query"
	modelpb "sico-backend/internal/transport/http/dto/notification"
	"sico-backend/pkg/logger"
)

type NotificationDAO struct {
	query *query.Query
}

func NewNotificationDAO(db *gorm.DB) *NotificationDAO {
	return &NotificationDAO{query: query.Use(db)}
}

func (dao *NotificationDAO) Create(ctx context.Context, record *entity.Notification) (int64, error) {
	poData, err := dao.notificationDo2Po(ctx, record)
	if err != nil {
		return 0, err
	}
	poData.CreatedAt = time.Now().UnixMilli()
	poData.UpdatedAt = time.Now().UnixMilli()
	cErr := dao.query.TNotification.WithContext(ctx).Create(poData)
	if cErr != nil {
		return 0, cErr
	}
	return poData.ID, nil
}

func (dao *NotificationDAO) Update(ctx context.Context, record *entity.Notification) error {
	poData, err := dao.notificationDo2Po(ctx, record)
	if err != nil {
		return err
	}
	poData.UpdatedAt = time.Now().UnixMilli()
	_, uErr := dao.query.TNotification.WithContext(ctx).Where(dao.query.TNotification.ID.Eq(poData.ID)).Updates(poData)
	return uErr
}

func (dao *NotificationDAO) Delete(ctx context.Context, id int64) error {
	_, err := dao.query.TNotification.WithContext(ctx).Where(dao.query.TNotification.ID.Eq(id)).Delete()
	return err
}

func (dao *NotificationDAO) SetStatus(ctx context.Context, id int64, status entity.NotificationStatus) error {
	_, err := dao.query.TNotification.WithContext(ctx).
		Where(dao.query.TNotification.ID.Eq(id)).
		UpdateColumn(dao.query.TNotification.Status, int32(status))
	return err
}

func (dao *NotificationDAO) ListByReceiverUsername(
	ctx context.Context,
	receiverUsername string,
	offset int,
	limit int,
) ([]*entity.Notification, int64, error) {
	q := dao.query.TNotification.WithContext(ctx).
		Where(dao.query.TNotification.ReceiverUsername.Eq(receiverUsername))
	total, err := q.Count()
	if err != nil {
		return nil, 0, err
	}
	list, err := q.Offset(offset).Limit(limit).Order(dao.query.TNotification.CreatedAt.Desc()).Find()
	if err != nil {
		return nil, 0, err
	}
	notifications, convErr := dao.notificationPo2DoBatch(ctx, list)
	if convErr != nil {
		return nil, 0, convErr
	}
	return notifications, total, nil
}

func (dao *NotificationDAO) List(
	ctx context.Context,
	notificationType entity.NotificationType,
	status entity.NotificationStatus,
	receiverUsername string,
	offset int,
	limit int,
) ([]*entity.Notification, int64, error) {
	q := dao.query.TNotification.WithContext(ctx)
	if receiverUsername != "" {
		q = q.Where(dao.query.TNotification.ReceiverUsername.Eq(receiverUsername))
	}
	if notificationType != modelpb.NotificationType_NOTIFICATION_TYPE_UNKNOWN {
		q = q.Where(dao.query.TNotification.Type.Eq(int32(notificationType)))
	}
	if status != modelpb.NotificationStatus_NOTIFICATION_STATUS_UNKNOWN {
		q = q.Where(dao.query.TNotification.Status.Eq(int32(status)))
	}
	total, err := q.Count()
	if err != nil {
		return nil, 0, err
	}

	list, err := q.Offset(offset).Limit(limit).Order(dao.query.TNotification.CreatedAt.Desc()).Find()
	if err != nil {
		return nil, 0, err
	}

	notifications := make([]*entity.Notification, 0, len(list))
	for _, poData := range list {
		doData, convErr := dao.notificationPo2Do(ctx, poData)
		if convErr != nil {
			logger.CtxError(ctx, "Failed to convert notification PO to DO: %v", convErr)
			continue
		}
		notifications = append(notifications, doData)
	}
	return notifications, total, nil
}

func (dao *NotificationDAO) notificationDo2Po(
	ctx context.Context,
	record *entity.Notification,
) (*model.TNotification, error) {
	poData := &model.TNotification{
		ID:               record.Id,
		SenderUsername:   record.SenderUsername,
		ReceiverUsername: record.ReceiverUsername,
		Type:             int32(record.Type),
		Status:           int32(record.Status),
		Content:          record.Content,
		ExtraInfo:        record.ExtraInfo,
		ProjectID:        record.ProjectId,
		CreatedAt:        record.CreatedAt,
		UpdatedAt:        record.UpdatedAt,
	}
	return poData, nil
}

func (dao *NotificationDAO) notificationPo2Do(
	ctx context.Context,
	poData *model.TNotification,
) (*entity.Notification, error) {
	doData := &entity.Notification{
		Id:               poData.ID,
		SenderUsername:   poData.SenderUsername,
		ReceiverUsername: poData.ReceiverUsername,
		Type:             entity.NotificationType(poData.Type),
		Status:           entity.NotificationStatus(poData.Status),
		Content:          poData.Content,
		ExtraInfo:        poData.ExtraInfo,
		ProjectId:        poData.ProjectID,
		CreatedAt:        poData.CreatedAt,
		UpdatedAt:        poData.UpdatedAt,
	}
	return doData, nil
}

func (dao *NotificationDAO) ListByProjectID(
	ctx context.Context,
	projectID int64,
	offset int,
	limit int,
) ([]*entity.Notification, int64, error) {
	q := dao.query.TNotification.WithContext(ctx).
		Where(dao.query.TNotification.ProjectID.Eq(projectID)).
		Where(dao.query.TNotification.ReceiverUsername.Eq(""))
	total, err := q.Count()
	if err != nil {
		return nil, 0, err
	}
	list, err := q.Offset(offset).Limit(limit).Order(dao.query.TNotification.CreatedAt.Desc()).Find()
	if err != nil {
		return nil, 0, err
	}
	notifications, convErr := dao.notificationPo2DoBatch(ctx, list)
	if convErr != nil {
		return nil, 0, convErr
	}
	return notifications, total, nil
}

func (dao *NotificationDAO) notificationPo2DoBatch(
	ctx context.Context,
	poList []*model.TNotification,
) ([]*entity.Notification, error) {
	doList := make([]*entity.Notification, 0, len(poList))
	for _, poData := range poList {
		doData, convErr := dao.notificationPo2Do(ctx, poData)
		if convErr != nil {
			logger.CtxError(ctx, "Failed to convert notification PO to DO: %v", convErr)
			continue
		}
		doList = append(doList, doData)
	}
	return doList, nil
}

func (dao *NotificationDAO) MarkAllAsReadByReceiverUsername(
	ctx context.Context,
	receiverUsername string,
) ([]int64, error) {
	t := dao.query.TNotification
	unread := int32(modelpb.NotificationStatus_NOTIFICATION_STATUS_UNREAD)
	read := int32(modelpb.NotificationStatus_NOTIFICATION_STATUS_READ)

	list, err := t.WithContext(ctx).
		Where(t.ReceiverUsername.Eq(receiverUsername)).
		Where(t.Status.Eq(unread)).
		Select(t.ID).
		Find()
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return []int64{}, nil
	}

	ids := make([]int64, 0, len(list))
	for _, po := range list {
		ids = append(ids, po.ID)
	}

	_, err = t.WithContext(ctx).
		Where(t.ID.In(ids...)).
		UpdateColumn(t.Status, read)
	if err != nil {
		return nil, err
	}
	return ids, nil
}
