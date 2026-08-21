package notification

import "sico-backend/internal/transport/http/dto/notification"

type Notification = notification.Notification
type NotificationType = notification.NotificationType
type NotificationStatus = notification.NotificationStatus
type NotificationExtraInfo = notification.NotificationExtraInfo
type ListNotificationRequest = notification.ListNotificationRequest

type QueryNotificationOptions struct {
	ReceiverId string
	Status     NotificationStatus
	Type       NotificationType
	Page       int32
	PageSize   int32
}
