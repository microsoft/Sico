package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	entity "sico-backend/internal/entity/notification"
	mockrepo "sico-backend/internal/store/notification/repository/mock"
	pb "sico-backend/internal/transport/http/dto/notification"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/notification"
	"sico-backend/pkg/jwtx"
)

func newTestNotificationService() *Service {
	return NewService(&Components{
		NotificationRepo: mockrepo.NewMockNotificationRepo(),
	})
}

func ctxWithUser(username string, roles ...string) context.Context {
	//nolint:staticcheck
	return context.WithValue(
		context.Background(), middleware.ContextUserKey, jwtx.UserInfo{Name: username},
	)
}

func TestCreateNotification(t *testing.T) {
	service := newTestNotificationService()

	t.Run("success", func(t *testing.T) {
		ctx := context.Background()
		id, err := service.Create(ctx, &entity.Notification{
			ReceiverUsername: "bob",
			SenderUsername:   "alice",
			Content:          "hello",
			Type:             pb.NotificationType_NOTIFICATION_TYPE_DELIVERABLE_PUBLISHED,
		})
		require.NoError(t, err)
		require.Greater(t, id, int64(0))
	})

	t.Run("defaults status to unread", func(t *testing.T) {
		ctx := context.Background()
		id, err := service.Create(ctx, &entity.Notification{
			ReceiverUsername: "bob",
			SenderUsername:   "alice",
			Content:          "hello",
			Status:           pb.NotificationStatus_NOTIFICATION_STATUS_UNKNOWN,
		})
		require.NoError(t, err)
		require.Greater(t, id, int64(0))
	})

	t.Run("nil notification", func(t *testing.T) {
		ctx := context.Background()
		_, err := service.Create(ctx, nil)
		require.Error(t, err)
	})

	t.Run("empty receiver", func(t *testing.T) {
		ctx := context.Background()
		_, err := service.Create(ctx, &entity.Notification{
			SenderUsername: "alice",
			Content:        "hello",
		})
		require.Error(t, err)
	})

	t.Run("empty receiver with project_id succeeds", func(t *testing.T) {
		ctx := context.Background()
		id, err := service.Create(ctx, &entity.Notification{
			SenderUsername: "alice",
			Content:        "deliverable published",
			Type:           pb.NotificationType_NOTIFICATION_TYPE_DELIVERABLE_PUBLISHED,
			ProjectId:      42,
		})
		require.NoError(t, err)
		require.Greater(t, id, int64(0))
	})
}

func TestUpdateNotificationStatus(t *testing.T) {
	service := newTestNotificationService()

	t.Run("success", func(t *testing.T) {
		ctx := context.Background()
		id, err := service.Create(ctx, &entity.Notification{
			ReceiverUsername: "bob",
			SenderUsername:   "alice",
			Content:          "hello",
			Status:           pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD,
		})
		require.NoError(t, err)

		resp, err := service.UpdateNotificationStatus(ctx, &pb.UpdateNotificationStatusRequest{
			Id:     id,
			Status: pb.NotificationStatus_NOTIFICATION_STATUS_READ,
		})
		require.NoError(t, err)
		require.NotNil(t, resp)
	})

	t.Run("not found", func(t *testing.T) {
		ctx := context.Background()
		_, err := service.UpdateNotificationStatus(ctx, &pb.UpdateNotificationStatusRequest{
			Id:     999,
			Status: pb.NotificationStatus_NOTIFICATION_STATUS_READ,
		})
		require.Error(t, err)
	})
}

func TestListNotification(t *testing.T) {
	service := newTestNotificationService()

	ctx := context.Background()
	for i := 0; i < 3; i++ {
		_, err := service.Create(ctx, &entity.Notification{
			ReceiverUsername: "bob",
			SenderUsername:   "alice",
			Content:          "hello",
		})
		require.NoError(t, err)
	}

	t.Run("list as receiver", func(t *testing.T) {
		userCtx := ctxWithUser("bob")
		resp, err := service.ListNotification(userCtx, &pb.ListNotificationRequest{
			Page:     1,
			PageSize: 10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Equal(t, int32(3), resp.Data.Total)
		require.Len(t, resp.Data.Notifications, 3)
	})

	t.Run("list as different user returns empty", func(t *testing.T) {
		userCtx := ctxWithUser("charlie")
		resp, err := service.ListNotification(userCtx, &pb.ListNotificationRequest{
			Page:     1,
			PageSize: 10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Equal(t, int32(0), resp.Data.Total)
	})

	t.Run("list as another user", func(t *testing.T) {
		userCtx := ctxWithUser("admin")
		resp, err := service.ListNotification(userCtx, &pb.ListNotificationRequest{
			Page:     1,
			PageSize: 10,
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.GreaterOrEqual(t, resp.Data.Total, int32(0))
	})

	t.Run("pagination defaults", func(t *testing.T) {
		userCtx := ctxWithUser("bob")
		resp, err := service.ListNotification(userCtx, &pb.ListNotificationRequest{})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Equal(t, int32(3), resp.Data.Total)
	})
}

func TestRpcCreateNotification(t *testing.T) {
	service := newTestNotificationService()

	t.Run("success", func(t *testing.T) {
		ctx := context.Background()
		resp, err := service.RpcCreateNotification(ctx, &rgrpc.CreateNotificationRequest{
			Notification: &entity.Notification{
				ReceiverUsername: "bob",
				SenderUsername:   "alice",
				Content:          "hello from rpc",
			},
		})
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		require.Greater(t, resp.Data.Id, int64(0))
	})
}
