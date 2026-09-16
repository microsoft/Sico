package impl

import (
	"context"
	"errors"

	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	"sico-backend/internal/biz/ownership"
	entity "sico-backend/internal/entity/notification"
	"sico-backend/internal/infra/coregrpc"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/store/notification/repository"
	pb "sico-backend/internal/transport/http/dto/notification"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/notification"
	"sico-backend/pkg/logger"
)

type Components struct {
	NotificationRepo repository.NotificationRepo
	Storage          storage.Storage
	CoreGRPC         coregrpc.Connection
	Ownership        ownership.Resolver
}

type Service struct {
	rgrpc.UnimplementedReverseNotificationRPCServer
	*Components
}

func NewService(components *Components) *Service {
	return &Service{Components: components}
}

func (s *Service) scopedRepo(
	ctx context.Context,
) (repository.OrganizationScopedNotificationRepo, int64, error) {
	if s.Ownership == nil {
		return nil, 0, nil
	}
	organizationID, err := s.Ownership.RequireSelected(ctx)
	if err != nil {
		return nil, 0, err
	}
	scoped, ok := s.NotificationRepo.(repository.OrganizationScopedNotificationRepo)
	if !ok {
		return nil, 0, apperr.New(
			errcode.CommonUnavailable, "notification repository does not support organization scoping",
		)
	}
	return scoped, organizationID, nil
}

func (s *Service) requireProjectOrganization(ctx context.Context, projectID int64) error {
	if s.Ownership == nil {
		return nil
	}
	organizationID, err := s.Ownership.ProjectOrganization(ctx, projectID)
	if err != nil {
		return err
	}
	return s.Ownership.RequireOrganization(ctx, organizationID, false)
}

func (s *Service) Create(ctx context.Context, notification *entity.Notification) (int64, error) {
	if notification == nil {
		return 0, apperr.New(errcode.CommonInvalidParam, "notification payload is required")
	}
	if s.NotificationRepo == nil {
		return 0, apperr.New(errcode.CommonUnavailable, "notification repository not initialized")
	}
	if notification.ReceiverUsername == "" && notification.ProjectId == 0 {
		return 0, apperr.New(errcode.NotificationInvalidReceiver, "receiver username is required")
	}

	if notification.Status == pb.NotificationStatus_NOTIFICATION_STATUS_UNKNOWN {
		notification.Status = pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD
	}
	if s.Ownership != nil {
		organizationID, err := s.resolveNotificationOrganization(ctx, notification)
		if err != nil {
			return 0, err
		}
		notification.OrganizationId = organizationID
	}

	id, err := s.NotificationRepo.Create(ctx, notification)
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return id, apperr.New(errcode.CommonConflict, "notification create failed")
		}
		return id, err
	}

	return id, nil
}

func (s *Service) CreateNotification(
	ctx context.Context,
	req *pb.CreateNotificationRequest,
) (*pb.CreateNotificationResponse, error) {
	sender := middleware.MustGetUsernameFromCtx(ctx)

	notification := &entity.Notification{
		Type:             req.Type,
		SenderUsername:   sender,
		ReceiverUsername: req.ReceiverUsername,
		Content:          req.Content,
		ExtraInfo:        req.ExtraInfo,
		Status:           pb.NotificationStatus_NOTIFICATION_STATUS_UNREAD,
	}
	if s.Ownership != nil {
		organizationID, err := s.resolveNotificationOrganization(ctx, notification)
		if err != nil {
			return nil, err
		}
		if err := s.Ownership.RequireOrganization(ctx, organizationID, false); err != nil {
			return nil, err
		}
	}

	notificationID, err := s.Create(ctx, notification)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&pb.CreateNotificationResponse{
		Data: &pb.CreateNotificationData{Id: notificationID},
	}), nil
}

func (s *Service) UpdateNotificationStatus(
	ctx context.Context,
	req *pb.UpdateNotificationStatusRequest,
) (*pb.UpdateNotificationStatusResponse, error) {
	if s.NotificationRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "notification repository not initialized")
	}
	var err error
	if s.Ownership != nil {
		scoped, organizationID, scopeErr := s.scopedRepo(ctx)
		if scopeErr != nil {
			return nil, scopeErr
		}
		if err = s.authorizeNotificationStatusUpdate(ctx, scoped, organizationID, req.Id); err == nil {
			err = scoped.SetStatusByOrganization(ctx, req.Id, organizationID, req.Status)
		}
	} else {
		err = s.NotificationRepo.SetStatus(ctx, req.Id, req.Status)
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "resource not found")
		}
		return nil, err
	}

	return appresp.Success(&pb.UpdateNotificationStatusResponse{}), nil
}

func (s *Service) authorizeNotificationStatusUpdate(
	ctx context.Context,
	scoped repository.OrganizationScopedNotificationRepo,
	organizationID, notificationID int64,
) error {
	notification, err := scoped.GetByOrganization(ctx, notificationID, organizationID)
	if err != nil {
		return apperr.New(errcode.CommonNotFound, "resource not found")
	}
	if notification.ReceiverUsername != "" &&
		notification.ReceiverUsername != middleware.MustGetUsernameFromCtx(ctx) {
		return apperr.New(errcode.CommonNotFound, "resource not found")
	}
	return nil
}

func (s *Service) ListNotification(
	ctx context.Context,
	req *pb.ListNotificationRequest,
) (*pb.ListNotificationResponse, error) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		return nil, apperr.New(errcode.CommonUnauthorized, "Authentication required")
	}
	if s.NotificationRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "notification repository not initialized")
	}

	page := req.GetPage()
	if page <= 0 {
		page = 1
	}

	pageSize := req.GetPageSize()
	if pageSize <= 0 {
		pageSize = 10
	}

	offset := int((page - 1) * pageSize)
	limit := int(pageSize)

	var notifications []*entity.Notification
	var total int64
	var err error
	if s.Ownership != nil {
		scoped, organizationID, scopeErr := s.scopedRepo(ctx)
		if scopeErr != nil {
			return nil, scopeErr
		}
		notifications, total, err = scoped.ListByReceiverUsernameInOrganization(
			ctx, userInfo.Name, organizationID, offset, limit,
		)
	} else {
		notifications, total, err = s.NotificationRepo.ListByReceiverUsername(ctx, userInfo.Name, offset, limit)
	}
	if err != nil {
		return nil, err
	}

	s.enrichNotificationIcons(ctx, notifications)

	hasMore := int64(page*pageSize) < total

	return appresp.Success(&pb.ListNotificationResponse{
		Data: &pb.ListNotificationData{
			Notifications: notifications,
			Total:         int32(total),
			HasMore:       hasMore,
		},
	}), nil
}

func (s *Service) RpcCreateNotification(
	ctx context.Context,
	req *rgrpc.CreateNotificationRequest,
) (*rgrpc.CreateNotificationResponse, error) {
	notificationID, err := s.Create(ctx, req.Notification)
	if err != nil {
		return nil, err
	}

	return &rgrpc.CreateNotificationResponse{
		Data: &rgrpc.CreateNotificationData{Id: notificationID},
	}, nil
}

func (s *Service) ListProjectNotifications(
	ctx context.Context,
	req *pb.ListProjectNotificationsRequest,
) (*pb.ListProjectNotificationsResponse, error) {
	if s.NotificationRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "notification repository not initialized")
	}
	organizationID, err := s.Ownership.ProjectOrganization(ctx, req.ProjectId)
	if err != nil {
		return nil, err
	}
	if err := s.Ownership.RequireOrganization(ctx, organizationID, false); err != nil {
		return nil, err
	}

	page := req.GetPage()
	if page <= 0 {
		page = 1
	}
	pageSize := req.GetPageSize()
	if pageSize <= 0 {
		pageSize = 10
	}

	offset := int((page - 1) * pageSize)
	limit := int(pageSize)

	scoped, ok := s.NotificationRepo.(repository.OrganizationScopedNotificationRepo)
	if !ok {
		return nil, apperr.New(errcode.CommonUnavailable, "notification repository does not support organization scoping")
	}
	notifications, total, err := scoped.ListByProjectIDInOrganization(
		ctx, req.ProjectId, organizationID, offset, limit,
	)
	if err != nil {
		return nil, err
	}

	s.enrichNotificationIcons(ctx, notifications)

	hasMore := int64(page*pageSize) < total

	return appresp.Success(&pb.ListProjectNotificationsResponse{
		Data: &pb.ListNotificationData{
			Notifications: notifications,
			Total:         int32(total),
			HasMore:       hasMore,
		},
	}), nil
}

func (s *Service) enrichNotificationIcons(ctx context.Context, notifications []*entity.Notification) {
	for _, notification := range notifications {
		if notification.ExtraInfo == nil {
			continue
		}
		if notification.ExtraInfo.DwAction != nil && notification.ExtraInfo.DwAction.AgentInstanceIconUri != "" {
			notification.ExtraInfo.DwAction.AgentInstanceIconUrl = convertIconURI(
				ctx, notification.ExtraInfo.DwAction.AgentInstanceIconUri,
			)
		}
		if notification.ExtraInfo.Deliverable != nil && notification.ExtraInfo.Deliverable.AgentInstanceIconUri != "" {
			notification.ExtraInfo.Deliverable.AgentInstanceIconUrl = convertIconURI(
				ctx, notification.ExtraInfo.Deliverable.AgentInstanceIconUri,
			)
		}
		if notification.ExtraInfo.AgentEditorUpdate != nil &&
			notification.ExtraInfo.AgentEditorUpdate.Agent != nil &&
			notification.ExtraInfo.AgentEditorUpdate.Agent.IconUri != "" {
			notification.ExtraInfo.AgentEditorUpdate.Agent.IconUrl = convertIconURI(
				ctx, notification.ExtraInfo.AgentEditorUpdate.Agent.IconUri,
			)
		}
	}
}

func convertIconURI(ctx context.Context, uri string) string {
	url, err := storage.PathToUrl(uri)
	if err != nil {
		logger.CtxWarn(ctx, "failed to convert icon uri to CDN: %v", err)
		return ""
	}
	return url
}

func (s *Service) ReadAllNotifications(ctx context.Context) (*pb.ReadAllNotificationsResponse, error) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		return nil, apperr.New(errcode.CommonUnauthorized, "Authentication required")
	}
	if s.NotificationRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "notification repository not initialized")
	}

	var ids []int64
	var err error
	if s.Ownership != nil {
		scoped, organizationID, scopeErr := s.scopedRepo(ctx)
		if scopeErr != nil {
			return nil, scopeErr
		}
		ids, err = scoped.MarkAllAsReadByReceiverUsernameInOrganization(ctx, userInfo.Name, organizationID)
	} else {
		ids, err = s.NotificationRepo.MarkAllAsReadByReceiverUsername(ctx, userInfo.Name)
	}
	if err != nil {
		return nil, err
	}

	return appresp.Success(&pb.ReadAllNotificationsResponse{
		Data: &pb.ReadAllNotificationsData{Ids: ids},
	}), nil
}
