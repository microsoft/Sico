package impl

import (
	"context"

	entity "sico-backend/internal/entity/notification"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	pb "sico-backend/internal/transport/http/dto/notification"
)

func (s *Service) resolveNotificationOrganization(
	ctx context.Context,
	notification *entity.Notification,
) (int64, error) {
	if notification.ProjectId > 0 {
		return s.requireResolvedOrganization(s.Ownership.ProjectOrganization(ctx, notification.ProjectId))
	}

	extraInfo := notification.ExtraInfo
	if extraInfo == nil {
		return 0, unresolvedNotificationOrganizationError()
	}

	switch notification.Type {
	case pb.NotificationType_NOTIFICATION_TYPE_DELIVERABLE_PUBLISHED:
		return s.resolveDeliverableOrganization(ctx, extraInfo)
	case pb.NotificationType_NOTIFICATION_TYPE_DW_DISMISSED,
		pb.NotificationType_NOTIFICATION_TYPE_DW_REASSIGNED:
		return s.resolveDWActionOrganization(ctx, extraInfo)
	case pb.NotificationType_NOTIFICATION_TYPE_MEMBER_INVITATION,
		pb.NotificationType_NOTIFICATION_TYPE_MEMBER_REMOVED,
		pb.NotificationType_NOTIFICATION_TYPE_PROJECT_ROLE_CHANGED:
		return s.resolveRoleChangeOrganization(ctx, extraInfo)
	case pb.NotificationType_NOTIFICATION_TYPE_AGENT_EDITOR_ASSIGNED,
		pb.NotificationType_NOTIFICATION_TYPE_AGENT_EDITOR_REVOKED:
		return s.resolveAgentEditorOrganization(ctx, extraInfo)
	case pb.NotificationType_NOTIFICATION_TYPE_SCHEDULED_TASK_FINISHED:
		return s.resolveScheduledTaskOrganization(ctx, extraInfo)
	}

	return 0, unresolvedNotificationOrganizationError()
}

func (s *Service) resolveDeliverableOrganization(
	ctx context.Context,
	extraInfo *pb.NotificationExtraInfo,
) (int64, error) {
	deliverable := extraInfo.GetDeliverable()
	if deliverable == nil || deliverable.AgentInstanceId <= 0 {
		return 0, unresolvedNotificationOrganizationError()
	}
	return s.requireResolvedOrganization(
		s.Ownership.AgentInstanceOrganization(ctx, deliverable.AgentInstanceId),
	)
}

func (s *Service) resolveDWActionOrganization(
	ctx context.Context,
	extraInfo *pb.NotificationExtraInfo,
) (int64, error) {
	dwAction := extraInfo.GetDwAction()
	if dwAction == nil || dwAction.AgentInstanceId <= 0 {
		return 0, unresolvedNotificationOrganizationError()
	}
	return s.requireResolvedOrganization(
		s.Ownership.AgentInstanceOrganization(ctx, dwAction.AgentInstanceId),
	)
}

func (s *Service) resolveRoleChangeOrganization(
	ctx context.Context,
	extraInfo *pb.NotificationExtraInfo,
) (int64, error) {
	roleChange := extraInfo.GetRoleChange()
	if roleChange == nil || roleChange.Project == nil || roleChange.Project.Id <= 0 {
		return 0, unresolvedNotificationOrganizationError()
	}
	return s.requireResolvedOrganization(
		s.Ownership.ProjectOrganization(ctx, roleChange.Project.Id),
	)
}

func (s *Service) resolveAgentEditorOrganization(
	ctx context.Context,
	extraInfo *pb.NotificationExtraInfo,
) (int64, error) {
	agentUpdate := extraInfo.GetAgentEditorUpdate()
	if agentUpdate == nil || agentUpdate.Agent == nil || agentUpdate.Agent.AgentId == "" {
		return 0, unresolvedNotificationOrganizationError()
	}
	return s.requireResolvedOrganization(
		s.Ownership.AgentOrganization(ctx, agentUpdate.Agent.AgentId),
	)
}

func (s *Service) resolveScheduledTaskOrganization(
	ctx context.Context,
	extraInfo *pb.NotificationExtraInfo,
) (int64, error) {
	finished := extraInfo.GetScheduledTaskFinished()
	if finished == nil {
		return 0, unresolvedNotificationOrganizationError()
	}
	if finished.AgentInstance != nil && finished.AgentInstance.Id > 0 {
		return s.requireResolvedOrganization(
			s.Ownership.AgentInstanceOrganization(ctx, finished.AgentInstance.Id),
		)
	}
	if finished.ConversationId > 0 {
		return s.requireResolvedOrganization(
			s.Ownership.ConversationOrganization(ctx, finished.ConversationId),
		)
	}
	return 0, unresolvedNotificationOrganizationError()
}

func (s *Service) requireResolvedOrganization(organizationID int64, err error) (int64, error) {
	if err != nil {
		return 0, err
	}
	if organizationID <= 0 {
		return 0, unresolvedNotificationOrganizationError()
	}
	return organizationID, nil
}

func unresolvedNotificationOrganizationError() error {
	return apperr.New(errcode.CommonInvalidParam, "notification organization cannot be resolved")
}
