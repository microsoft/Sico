package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	singleAgentSVC "sico-backend/internal/biz/agent"
	conversationbiz "sico-backend/internal/biz/conversation"
	saEntity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
	"sico-backend/internal/transport/http/middleware"
)

// CreateSingleAgent creates a new single agent
// @Router /api/sico/agent/single_agent [POST]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request body single_agent.CreateSingleAgentRequest true "Create single agent request"
// @Success 200 {object} single_agent.CreateSingleAgentResponse
// @Security BearerAuth
func CreateSingleAgent(ctx *gin.Context) {
	var (
		err error
		req single_agent.CreateSingleAgentRequest
	)

	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	req.CreatorUsername = userInfo.Name
	req.UpdaterUsername = userInfo.Name
	req.AgentId = uuid.New().String()

	resp, err := singleAgentSVC.DefaultFull().CreateSingleAgent(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetSingleAgent gets a single agent by ID
// @Router /api/sico/agent/single_agent [GET]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request query single_agent.GetSingleAgentRequest true "Query parameters"
// @Success 200 {object} single_agent.GetSingleAgentResponse
// @Security BearerAuth
func GetSingleAgent(ctx *gin.Context) {
	var (
		err error
		req single_agent.GetSingleAgentRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	if err := singleAgentSVC.DefaultFull().CheckAgentVisibility(reqctx(ctx), req.AgentId); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	resp, err := singleAgentSVC.DefaultFull().GetSingleAgent(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateSingleAgent updates a single agent
// @Router /api/sico/agent/single_agent [PUT]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request body single_agent.UpdateSingleAgentRequest true "Update single agent request"
// @Success 200 {object} single_agent.UpdateSingleAgentResponse
// @Security BearerAuth
func UpdateSingleAgent(ctx *gin.Context) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var (
		err error
		req single_agent.UpdateSingleAgentRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	req.UpdaterUsername = userInfo.Name
	resp, err := singleAgentSVC.DefaultFull().UpdateSingleAgent(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteSingleAgent deletes a single agent
// @Router /api/sico/agent/single_agent [DELETE]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request query single_agent.DeleteSingleAgentRequest true "Query parameters"
// @Success 200 {object} single_agent.DeleteSingleAgentResponse
// @Security BearerAuth
func DeleteSingleAgent(ctx *gin.Context) {
	var (
		err error
		req single_agent.DeleteSingleAgentRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	if err := singleAgentSVC.DefaultFull().CheckAgentOwner(reqctx(ctx), req.AgentId); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	resp, err := singleAgentSVC.DefaultFull().DeleteSingleAgent(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListSingleAgents lists single agents
// @Router /api/sico/agent/single_agents [GET]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request query single_agent.ListSingleAgentsRequest true "Query parameters"
// @Success 200 {object} single_agent.ListSingleAgentsResponse
// @Security BearerAuth
func ListSingleAgents(ctx *gin.Context) {
	var (
		err error
		req single_agent.ListSingleAgentsRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	req.PublishStatusArr = parsePublishStatusList(req.PublishStatusList)

	resp, err := singleAgentSVC.DefaultFull().ListSingleAgents(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListSingleAgentInfos lists single agent infos (including roles and capability tags)
// @Router /api/sico/agent/single_agent_infos [GET]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request query single_agent.ListSingleAgentInfosRequest true "Query parameters"
// @Success 200 {object} single_agent.ListSingleAgentInfosResponse
// @Security BearerAuth
func ListSingleAgentInfos(ctx *gin.Context) {
	var (
		err error
		req single_agent.ListSingleAgentInfosRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	req.PublishStatusArr = parsePublishStatusList(req.PublishStatusList)

	resp, err := singleAgentSVC.DefaultFull().ListSingleAgentInfos(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListRoles returns all available agent role types
// @Summary List Agent Roles
// @Router /api/sico/agent/roles [GET]
// @Tags Agent
// @Produce json
// @Success 200 {object} single_agent.ListRolesResponse
// @Security BearerAuth
func ListRoles(ctx *gin.Context) {
	var (
		err error
	)

	resp, err := singleAgentSVC.DefaultFull().ListRoles(ctx)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

func validateSingleAgentInstanceStatus(status ...single_agent.SingleAgentInstanceStatus) bool {
	for _, s := range status {
		if s <= single_agent.SingleAgentInstanceStatus_INSTANCE_UNKNOWN ||
			s > single_agent.SingleAgentInstanceStatus_INSTANCE_ONBOARDING_SAVED {
			return false
		}
	}

	return true
}

func parseSingleAgentInstanceStatusList(list string) []single_agent.SingleAgentInstanceStatus {
	var statuses []single_agent.SingleAgentInstanceStatus
	for _, part := range strings.Split(list, ",") {
		if status, err := strconv.Atoi(strings.TrimSpace(part)); err == nil {
			statuses = append(statuses, single_agent.SingleAgentInstanceStatus(status))
		}
	}
	return statuses
}

// DeploySingleAgent deploys a single agent by creating an agent instance for the current user
// @Router /api/sico/agent/single_agent/deploy [POST]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request body single_agent.DeploySingleAgentRequest true "Deploy single agent request"
// @Success 200 {object} single_agent.DeploySingleAgentResponse
// @Security BearerAuth
func DeploySingleAgent(ctx *gin.Context) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req single_agent.DeploySingleAgentRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := singleAgentSVC.DefaultFull().DeploySingleAgent(reqctx(ctx), &req, userInfo.Name)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// CreateSingleAgentInstance creates a new single agent instance
// @Router /api/sico/agent/single_agent_instance [POST]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request body single_agent.CreateSingleAgentInstanceRequest true "Create single agent instance request"
// @Success 200 {object} single_agent.CreateSingleAgentInstanceResponse
// @Security BearerAuth
func CreateSingleAgentInstance(ctx *gin.Context) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req single_agent.CreateSingleAgentInstanceRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	req.OperatorUsername = userInfo.Name
	if req.EmployerUsername == "" {
		req.EmployerUsername = userInfo.Name
	}

	resp, err := singleAgentSVC.DefaultFull().CreateSingleAgentInstance(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetSingleAgentInstance gets a single agent instance by ID
// @Router /api/sico/agent/single_agent_instance [GET]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request query single_agent.GetSingleAgentInstanceRequest true "Query parameters"
// @Success 200 {object} single_agent.GetSingleAgentInstanceResponse
// @Security BearerAuth
func GetSingleAgentInstance(ctx *gin.Context) {
	var (
		err error
		req single_agent.GetSingleAgentInstanceRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := singleAgentSVC.DefaultFull().GetSingleAgentInstanceHTTP(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	if resp != nil && resp.Data != nil && resp.Data.Instance != nil {
		instanceID := strconv.FormatInt(resp.Data.Instance.Id, 10)
		resp.Data.Instance.Sandboxes = getInstanceSandboxes(reqctx(ctx), instanceID)
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateSingleAgentInstance updates a single agent instance
// @Router /api/sico/agent/single_agent_instance [PUT]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request body single_agent.UpdateSingleAgentInstanceRequest true "Update single agent instance request"
// @Success 200 {object} single_agent.UpdateSingleAgentInstanceResponse
// @Security BearerAuth
func UpdateSingleAgentInstance(ctx *gin.Context) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var (
		err error
		req single_agent.UpdateSingleAgentInstanceRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	req.OperatorUsername = userInfo.Name

	resp, err := singleAgentSVC.DefaultFull().UpdateSingleAgentInstance(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteSingleAgentInstance deletes a single agent instance
// @Router /api/sico/agent/single_agent_instance [DELETE]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request query single_agent.DeleteSingleAgentInstanceRequest true "Query parameters"
// @Success 200 {object} single_agent.DeleteSingleAgentInstanceResponse
// @Security BearerAuth
func DeleteSingleAgentInstance(ctx *gin.Context) {
	var (
		err error
		req single_agent.DeleteSingleAgentInstanceRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := singleAgentSVC.DefaultFull().DeleteSingleAgentInstance(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DismissSingleAgentInstance sets a single agent instance to inactive
// @Router /api/sico/agent/single_agent_instance/dismiss [POST]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request body single_agent.DismissSingleAgentInstanceRequest true "Dismiss request"
// @Success 200 {object} single_agent.DismissSingleAgentInstanceResponse
// @Security BearerAuth
func DismissSingleAgentInstance(ctx *gin.Context) {
	var req single_agent.DismissSingleAgentInstanceRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := singleAgentSVC.DefaultFull().DismissSingleAgentInstance(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateSingleAgentInstanceStatus updates the status of a single agent instance
// @Router /api/sico/agent/single_agent_instance/status [PUT]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request body single_agent.UpdateSingleAgentInstanceStatusRequest true "Status update request"
// @Success 200 {object} single_agent.UpdateSingleAgentInstanceStatusResponse
// @Security BearerAuth
func UpdateSingleAgentInstanceStatus(ctx *gin.Context) {
	var req single_agent.UpdateSingleAgentInstanceStatusRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := singleAgentSVC.DefaultFull().UpdateSingleAgentInstanceStatus(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ReassignSingleAgentInstance reassigns a single agent instance to a new operator
// @Router /api/sico/agent/single_agent_instance/reassign [POST]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request body single_agent.ReassignSingleAgentInstanceRequest true "Reassign request"
// @Success 200 {object} single_agent.ReassignSingleAgentInstanceResponse
// @Security BearerAuth
func ReassignSingleAgentInstance(ctx *gin.Context) {
	var req single_agent.ReassignSingleAgentInstanceRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := singleAgentSVC.DefaultFull().ReassignSingleAgentInstance(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListSingleAgentInstances lists single agent instances
// @Router /api/sico/agent/single_agent_instances [GET]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request query single_agent.ListSingleAgentInstancesFilter true "Query parameters"
// @Success 200 {object} single_agent.ListSingleAgentInstancesResponse
// @Security BearerAuth
func ListSingleAgentInstances(ctx *gin.Context) {
	var (
		err error
		req single_agent.ListSingleAgentInstancesFilter
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	req.StatusArr = parseSingleAgentInstanceStatusList(req.GetStatusList())

	if !validateSingleAgentInstanceStatus(req.StatusArr...) {
		invalidParamRequestResponse(ctx, "Invalid status")
		return
	}

	// Build filter from request
	filter := &saEntity.ListSingleAgentInstanceFilter{
		FilterByStatus:   len(req.StatusArr) > 0,
		StatusArr:        req.StatusArr,
		OrderBy:          req.OrderBy,
		SortOrder:        req.SortOrder,
		ProjectId:        req.ProjectId,
		EmployerUsername: req.EmployerUsername,
		OperatorUsername: req.OperatorUsername,
	}

	offset := int(req.Page-1) * int(req.PageSize)
	limit := int(req.PageSize)

	instances, total, err := singleAgentSVC.Default().ListSingleAgentInstancesByFilter(
		reqctx(ctx), filter, offset, limit,
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	// Build response
	pbInstances := make([]*single_agent.SingleAgentInstance, len(instances))
	for i, inst := range instances {
		pbInstances[i] = inst.SingleAgentInstance
	}

	hasNext := int64(offset+len(instances)) < total
	resp := &single_agent.ListSingleAgentInstancesResponse{
		Data: &single_agent.ListSingleAgentInstancesData{
			Instances: pbInstances,
			Total:     int32(total),
			HasNext:   hasNext,
		},
	}

	// Enrich each instance with assigned sandboxes from Redis
	for _, inst := range resp.Data.Instances {
		if inst == nil {
			continue
		}
		instanceID := strconv.FormatInt(inst.Id, 10)
		inst.Sandboxes = getInstanceSandboxes(reqctx(ctx), instanceID)
	}
	if req.GetFetchConversationStatus() {
		instanceIDs := make([]int64, 0, len(resp.Data.Instances))
		for _, inst := range resp.Data.Instances {
			if inst != nil {
				instanceIDs = append(instanceIDs, inst.Id)
			}
		}
		statuses := conversationbiz.Default().GetAgentInstanceConversationRunStatuses(reqctx(ctx), instanceIDs)
		for _, inst := range resp.Data.Instances {
			if inst != nil {
				status := statuses[inst.Id]
				inst.ConversationStatus = &status
			}
		}
	}

	ctx.JSON(http.StatusOK, resp)
}

// PublishSingleAgent publishes a single agent (transitions from draft to published)
// @Router /api/sico/agent/single_agent/publish [POST]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param request body single_agent.PublishSingleAgentRequest true "Publish single agent request"
// @Success 200 {object} single_agent.PublishSingleAgentResponse
// @Security BearerAuth
func PublishSingleAgent(ctx *gin.Context) {
	var req single_agent.PublishSingleAgentRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	if err := singleAgentSVC.DefaultFull().CheckAgentManageAccess(reqctx(ctx), req.AgentId); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	resp, err := singleAgentSVC.DefaultFull().PublishSingleAgent(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// parsePublishStatusList parses a comma-separated publish-status query value
// (e.g. "0,1") into a list of SingleAgentPublishStatus values.
func parsePublishStatusList(list string) []single_agent.SingleAgentPublishStatus {
	list = strings.TrimSpace(list)
	if list == "" {
		return nil
	}
	var out []single_agent.SingleAgentPublishStatus
	for _, part := range strings.Split(list, ",") {
		if v, convErr := strconv.Atoi(strings.TrimSpace(part)); convErr == nil {
			out = append(out, single_agent.SingleAgentPublishStatus(v))
		}
	}
	return out
}
