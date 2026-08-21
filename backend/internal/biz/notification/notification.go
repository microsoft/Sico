package notification

import (
	"context"

	entity "sico-backend/internal/entity/notification"
	pb "sico-backend/internal/transport/http/dto/notification"
	reverse_rpc "sico-backend/internal/transport/reverse_grpc/pb/notification"
)

type Service interface {
	Create(ctx context.Context, notification *entity.Notification) (int64, error)
	CreateNotification(
		ctx context.Context,
		req *pb.CreateNotificationRequest,
	) (*pb.CreateNotificationResponse, error)
	UpdateNotificationStatus(
		ctx context.Context,
		req *pb.UpdateNotificationStatusRequest,
	) (*pb.UpdateNotificationStatusResponse, error)
	ListNotification(ctx context.Context, req *pb.ListNotificationRequest) (*pb.ListNotificationResponse, error)
	ListProjectNotifications(
		ctx context.Context,
		req *pb.ListProjectNotificationsRequest,
	) (*pb.ListProjectNotificationsResponse, error)
	ReadAllNotifications(ctx context.Context) (*pb.ReadAllNotificationsResponse, error)

	reverse_rpc.ReverseNotificationRPCServer
}
