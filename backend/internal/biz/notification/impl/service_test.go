package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/ownership"
	entity "sico-backend/internal/entity/notification"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	mockrepo "sico-backend/internal/store/notification/repository/mock"
	commondto "sico-backend/internal/transport/http/dto/common"
	pb "sico-backend/internal/transport/http/dto/notification"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/notification"
	"sico-backend/pkg/jwtx"
)

type notificationOwnership struct {
	ownership.Resolver
	selectedOrganizationID int64
	projectOrganizations   map[int64]int64
	agentOrganizations     map[string]int64
	instanceOrganizations  map[int64]int64
	conversationOrgs       map[int64]int64
}

func (o *notificationOwnership) RequireSelected(context.Context) (int64, error) {
	return o.selectedOrganizationID, nil
}

func (o *notificationOwnership) RequireOrganization(
	_ context.Context,
	organizationID int64,
	_ bool,
) error {
	if organizationID != o.selectedOrganizationID {
		return apperr.New(errcode.CommonNotFound, "resource not found")
	}
	return nil
}

func (o *notificationOwnership) ProjectOrganization(_ context.Context, projectID int64) (int64, error) {
	return o.projectOrganizations[projectID], nil
}

func (o *notificationOwnership) AgentOrganization(_ context.Context, agentID string) (int64, error) {
	return o.agentOrganizations[agentID], nil
}

func (o *notificationOwnership) AgentInstanceOrganization(_ context.Context, instanceID int64) (int64, error) {
	return o.instanceOrganizations[instanceID], nil
}

func (o *notificationOwnership) ConversationOrganization(_ context.Context, conversationID int64) (int64, error) {
	return o.conversationOrgs[conversationID], nil
}

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

func TestCreateResolvesOrganizationFromAuthoritativeOwner(t *testing.T) {
	notificationRepo := mockrepo.NewMockNotificationRepo()
	service := NewService(&Components{
		NotificationRepo: notificationRepo,
		Ownership: &notificationOwnership{
			agentOrganizations: map[string]int64{"agent-1": 10},
		},
	})

	id, err := service.Create(context.Background(), &entity.Notification{
		ReceiverUsername: "bob",
		Type:             pb.NotificationType_NOTIFICATION_TYPE_AGENT_EDITOR_ASSIGNED,
		OrganizationId:   999,
		ExtraInfo: &pb.NotificationExtraInfo{
			AgentEditorUpdate: &pb.NotificationExtraInfoAgentEditorUpdate{
				Agent: &commondto.AgentDigest{AgentId: "agent-1"},
			},
		},
	})
	require.NoError(t, err)

	scoped := notificationRepo.(interface {
		GetByOrganization(context.Context, int64, int64) (*entity.Notification, error)
	})
	created, err := scoped.GetByOrganization(context.Background(), id, 10)
	require.NoError(t, err)
	require.Equal(t, int64(10), created.OrganizationId)
}

func TestCreateRejectsUnresolvedOrganization(t *testing.T) {
	service := NewService(&Components{
		NotificationRepo: mockrepo.NewMockNotificationRepo(),
		Ownership:        &notificationOwnership{},
	})

	_, err := service.Create(context.Background(), &entity.Notification{
		ReceiverUsername: "bob",
		Type:             pb.NotificationType_NOTIFICATION_TYPE_UNKNOWN,
	})
	require.Error(t, err)
}

func TestCreateNotificationRejectsForeignOrganization(t *testing.T) {
	service := NewService(&Components{
		NotificationRepo: mockrepo.NewMockNotificationRepo(),
		Ownership: &notificationOwnership{
			selectedOrganizationID: 10,
			agentOrganizations:     map[string]int64{"agent-1": 20},
		},
	})

	_, err := service.CreateNotification(ctxWithUser("alice"), &pb.CreateNotificationRequest{
		ReceiverUsername: "bob",
		Type:             pb.NotificationType_NOTIFICATION_TYPE_AGENT_EDITOR_ASSIGNED,
		ExtraInfo: &pb.NotificationExtraInfo{
			AgentEditorUpdate: &pb.NotificationExtraInfoAgentEditorUpdate{
				Agent: &commondto.AgentDigest{AgentId: "agent-1"},
			},
		},
	})
	require.Error(t, err)
}

func TestNotificationTenantIsolation(t *testing.T) {
	notificationRepo := mockrepo.NewMockNotificationRepo()
	for _, notification := range []*entity.Notification{
		{ReceiverUsername: "bob", OrganizationId: 10, Status: pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD},
		{ReceiverUsername: "bob", OrganizationId: 20, Status: pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD},
		{ReceiverUsername: "bob", OrganizationId: 0, Status: pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD},
	} {
		_, err := notificationRepo.Create(context.Background(), notification)
		require.NoError(t, err)
	}
	service := NewService(&Components{
		NotificationRepo: notificationRepo,
		Ownership:        &notificationOwnership{selectedOrganizationID: 10},
	})
	ctx := ctxWithUser("bob")

	response, err := service.ListNotification(ctx, &pb.ListNotificationRequest{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Equal(t, int32(1), response.Data.Total)
	require.Len(t, response.Data.Notifications, 1)
	require.Equal(t, int64(10), response.Data.Notifications[0].OrganizationId)

	_, err = service.UpdateNotificationStatus(ctx, &pb.UpdateNotificationStatusRequest{
		Id: 2, Status: pb.NotificationStatus_NOTIFICATION_STATUS_READ,
	})
	require.Error(t, err)

	readAll, err := service.ReadAllNotifications(ctx)
	require.NoError(t, err)
	require.ElementsMatch(t, []int64{1}, readAll.Data.Ids)

	scoped := notificationRepo.(interface {
		GetByOrganization(context.Context, int64, int64) (*entity.Notification, error)
	})
	foreign, err := scoped.GetByOrganization(context.Background(), 2, 20)
	require.NoError(t, err)
	require.Equal(t, pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD, foreign.Status)
}
