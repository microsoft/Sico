package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	singleAgentSVC "sico-backend/internal/biz/agent"
	notificationbiz "sico-backend/internal/biz/notification"
	projectbiz "sico-backend/internal/biz/project"
	rbacbiz "sico-backend/internal/biz/rbac"
	notificationEntity "sico-backend/internal/entity/notification"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	single_agent "sico-backend/internal/transport/http/dto/agent/single_agent"
	commondto "sico-backend/internal/transport/http/dto/common"
	notificationdto "sico-backend/internal/transport/http/dto/notification"
	"sico-backend/internal/transport/http/dto/project"
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/logger"
)

// authorizeUserRoleChange authorizes an assign/remove of the given role. Agent-scoped
// roles (agent_editor) are authorized by agent ownership; all other roles by RBAC policy.
func authorizeUserRoleChange(ctx context.Context, roleCode, scopeType, scopeID string) error {
	if roleCode == rbacbiz.RoleAgentEditor {
		if scopeType != rbacbiz.ScopeAgent || scopeID == "" {
			return apperr.New(errcode.CommonInvalidParam, "agent scope required for agent roles")
		}
		return singleAgentSVC.DefaultFull().CheckAgentOwner(ctx, scopeID)
	}
	return rbacbiz.Default().AuthorizeRoleChange(ctx, roleCode, scopeType, scopeID)
}

// AssignUserRole assigns a role to a user
// @Summary Assign User Role
// @Router /api/sico/rbac/user_role [POST]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body user_role.AssignUserRoleRequest true "Assign User Role"
// @Success 200 {object} user_role.AssignUserRoleResponse
// @Security BearerAuth
func AssignUserRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.AssignUserRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	if err := authorizeUserRoleChange(reqctx(ctx), req.RoleCode, req.ScopeType, req.ScopeId); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	resp, err := rbacbiz.Default().AssignUserRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	notifyProjectRoleChange(
		ctx,
		req.UserId,
		req.RoleCode,
		req.ScopeType,
		req.ScopeId,
		notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_ASSIGNED,
	)
	notifyAgentEditorChange(
		ctx,
		req.UserId,
		req.RoleCode,
		req.ScopeType,
		req.ScopeId,
		notificationdto.NotificationType_NOTIFICATION_TYPE_AGENT_EDITOR_ASSIGNED,
	)

	ctx.JSON(http.StatusOK, resp)
}

// RemoveUserRole removes a role from a user
// @Summary Remove User Role
// @Router /api/sico/rbac/user_role [DELETE]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request body user_role.RemoveUserRoleRequest true "Remove User Role"
// @Success 200 {object} user_role.RemoveUserRoleResponse
// @Security BearerAuth
func RemoveUserRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.RemoveUserRoleRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	if err := authorizeUserRoleChange(reqctx(ctx), req.RoleCode, req.ScopeType, req.ScopeId); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	resp, err := rbacbiz.Default().RemoveUserRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	notifyProjectRoleChange(
		ctx,
		req.UserId,
		req.RoleCode,
		req.ScopeType,
		req.ScopeId,
		notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_REMOVED,
	)
	notifyAgentEditorChange(
		ctx,
		req.UserId,
		req.RoleCode,
		req.ScopeType,
		req.ScopeId,
		notificationdto.NotificationType_NOTIFICATION_TYPE_AGENT_EDITOR_REVOKED,
	)

	ctx.JSON(http.StatusOK, resp)
}

// ListUserRoles lists roles owned by a user
// @Summary List User Roles
// @Router /api/sico/rbac/user_roles [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query user_role.ListUserRolesRequest true "List User Roles"
// @Success 200 {object} user_role.ListUserRolesResponse
// @Security BearerAuth
func ListUserRoles(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.ListUserRolesRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 10
	}

	resp, err := rbacbiz.Default().ListUserRoles(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListUsersByRole lists users bound to a role
// @Summary List Users By Role
// @Router /api/sico/rbac/role_users [GET]
// @Tags RBAC
// @Accept json
// @Produce json
// @Param request query user_role.ListUsersByRoleRequest true "List Users By Role"
// @Success 200 {object} user_role.ListUsersByRoleResponse
// @Security BearerAuth
func ListUsersByRole(ctx *gin.Context) {
	_, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req user_role.ListUsersByRoleRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 10
	}

	resp, err := rbacbiz.Default().ListUsersByRole(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

func resolveRoleChangeNotificationType(
	roleCode string,
	action notificationdto.RoleChangeAction,
) notificationdto.NotificationType {
	switch {
	case roleCode == "project_member" && action == notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_ASSIGNED:
		return notificationdto.NotificationType_NOTIFICATION_TYPE_MEMBER_INVITATION
	case roleCode == "project_member" && action == notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_REMOVED:
		return notificationdto.NotificationType_NOTIFICATION_TYPE_MEMBER_REMOVED
	case roleCode == "project_admin":
		return notificationdto.NotificationType_NOTIFICATION_TYPE_PROJECT_ROLE_CHANGED
	default:
		return 0
	}
}

func notifyProjectRoleChange(
	ginCtx *gin.Context,
	userID int64,
	roleCode, scopeType string,
	scopeID string,
	action notificationdto.RoleChangeAction,
) {
	if scopeType != "project" || userID <= 0 {
		return
	}
	projectID, err := strconv.ParseInt(scopeID, 10, 64)
	if err != nil || projectID <= 0 {
		return
	}

	notifType := resolveRoleChangeNotificationType(roleCode, action)
	if notifType == 0 {
		return
	}

	notifSvc := notificationbiz.Default()
	if notifSvc == nil {
		return
	}

	ctx := reqctx(ginCtx)

	sender := middleware.GetUsernameFromCtx(ctx)
	if sender == nil {
		logger.CtxError(ctx, "notifyRoleChange: no authenticated user in context")
		return
	}

	receiverUsername, err := rbacbiz.ResolveUsername(ctx, userID)
	if err != nil {
		logger.CtxError(ctx, "notifyRoleChange: failed to resolve user %d: %v", userID, err)
		return
	}

	var projectDigest *commondto.ProjectDigest
	if projSvc := projectbiz.Default(); projSvc != nil {
		resp, err := projSvc.GetProject(ctx, &project.GetProjectDetailRequest{Id: projectID})
		if err == nil && resp != nil && resp.Data != nil {
			projectDigest = &commondto.ProjectDigest{
				Id:   resp.Data.Id,
				Name: resp.Data.Name,
			}
		}
	}

	extraInfo := &notificationdto.NotificationExtraInfo{
		RoleChange: &notificationdto.NotificationExtraInfoRoleChange{
			Project:  projectDigest,
			RoleCode: roleCode,
			Action:   action,
		},
	}

	if _, err := notifSvc.Create(ctx, &notificationEntity.Notification{
		Type:             notifType,
		SenderUsername:   *sender,
		ReceiverUsername: receiverUsername,
		ExtraInfo:        extraInfo,
		ProjectId:        projectID,
	}); err != nil {
		logger.CtxError(ctx, "notifyRoleChange: failed to create notification for %s: %v", receiverUsername, err)
	}
}

func notifyAgentEditorChange(
	ginCtx *gin.Context,
	userID int64,
	roleCode, scopeType string,
	scopeID string,
	notifType notificationdto.NotificationType,
) {
	if roleCode != rbacbiz.RoleAgentEditor || scopeType != rbacbiz.ScopeAgent || scopeID == "" {
		return
	}

	notifSvc := notificationbiz.Default()
	if notifSvc == nil {
		return
	}

	ctx := reqctx(ginCtx)

	operatorInfo, ok := middleware.GetUserFromContext(ginCtx)
	if !ok {
		logger.CtxError(ctx, "notifyAgentEditorChange: no authenticated user in context")
		return
	}

	receiverUsername, err := rbacbiz.ResolveUsername(ctx, userID)
	if err != nil {
		logger.CtxError(ctx, "notifyAgentEditorChange: failed to resolve user %d: %v", userID, err)
		return
	}

	var agentDigest *commondto.AgentDigest
	if agentSvc := singleAgentSVC.Default(); agentSvc != nil {
		resp, err := agentSvc.GetSingleAgent(ctx, &single_agent.GetSingleAgentRequest{AgentId: scopeID})
		if err == nil && resp != nil && resp.Data != nil && resp.Data.Agent != nil {
			agent := resp.Data.Agent
			agentDigest = &commondto.AgentDigest{
				AgentId:        agent.AgentId,
				Name:           agent.Name,
				IconUri:        agent.IconUri,
				Role:           agent.Role,
				OrganizationId: agent.OrganizationId,
			}
		}
	}

	operatorDigest := &commondto.UserDigest{
		Id:       operatorInfo.UserID,
		Username: operatorInfo.Name,
		Email:    operatorInfo.Email,
	}

	extraInfo := &notificationdto.NotificationExtraInfo{
		AgentEditorUpdate: &notificationdto.NotificationExtraInfoAgentEditorUpdate{
			Operator: operatorDigest,
			Agent:    agentDigest,
		},
	}

	if _, err := notifSvc.Create(ctx, &notificationEntity.Notification{
		Type:             notifType,
		SenderUsername:   operatorInfo.Name,
		ReceiverUsername: receiverUsername,
		ExtraInfo:        extraInfo,
	}); err != nil {
		logger.CtxError(ctx, "notifyAgentEditorChange: failed to create notification for %s: %v", receiverUsername, err)
	}
}
