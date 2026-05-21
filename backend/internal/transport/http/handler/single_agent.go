// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	singleAgentSVC "sico-backend/internal/biz/agent"
	llmhubsSVC "sico-backend/internal/biz/llmhubs"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
	llmhubsDTO "sico-backend/internal/transport/http/dto/llmhubs"
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
	)

	resp, err := singleAgentSVC.DefaultFull().ListSingleAgentInfos(reqctx(ctx))
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
	var req single_agent.CreateSingleAgentInstanceRequest

	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
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

// ListSingleAgentInstances lists single agent instances
// @Router /api/sico/agent/single_agent_instances [GET]
// @Tags SingleAgentInstance
// @Accept json
// @Produce json
// @Param request query single_agent.ListSingleAgentInstancesRequest true "Query parameters"
// @Success 200 {object} single_agent.ListSingleAgentInstancesResponse
// @Security BearerAuth
func ListSingleAgentInstances(ctx *gin.Context) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var (
		err error
		req single_agent.ListSingleAgentInstancesRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}
	req.Username = userInfo.Name

	resp, err := singleAgentSVC.DefaultFull().ListSingleAgentInstances(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	if resp != nil && resp.Data != nil {
		for _, instance := range resp.Data.Instances {
			if instance == nil {
				continue
			}
			instanceID := strconv.FormatInt(instance.Id, 10)
			instance.Sandboxes = getInstanceSandboxes(reqctx(ctx), instanceID)
		}
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetSingleAgentModels lists builtin models, current agent custom models, and current selection.
// @Router /api/sico/agents/{agentId}/models [GET]
// @Tags SingleAgent
// @Accept json
// @Produce json
// @Param agentId path string true "Agent ID"
// @Success 200 {object} single_agent.GetSingleAgentModelsResponse
// @Security BearerAuth
func GetSingleAgentModels(ctx *gin.Context) {
	agentID := strings.TrimSpace(ctx.Param("agentId"))
	if agentID == "" {
		invalidParamRequestResponse(ctx, "agentId is required")
		return
	}

	agentResp, err := singleAgentSVC.DefaultFull().GetSingleAgent(
		reqctx(ctx), &single_agent.GetSingleAgentRequest{AgentId: agentID},
	)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	builtinModels, err := llmhubsSVC.Default().ListBuiltinModels(reqctx(ctx))
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	customEntries, err := llmhubsSVC.ListAgentCustomModelEntries(reqctx(ctx), agentID)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	resp := &single_agent.GetSingleAgentModelsResponse{
		Data: &single_agent.GetSingleAgentModelsData{
			BuiltinModels:  mapAgentModelOptions(builtinModels),
			CustomModels:   mapAgentModelOptions(customEntries),
			SelectedConfig: &single_agent.LLMHubConfig{},
		},
	}
	if agentResp != nil && agentResp.Data != nil && agentResp.Data.Agent != nil {
		if agentResp.Data.Agent.LlmhubConfig != nil {
			resp.Data.SelectedConfig = agentResp.Data.Agent.LlmhubConfig
		}
	}

	ctx.JSON(http.StatusOK, resp)
}

func mapAgentModelOptions(entries []*llmhubsDTO.ModelRegistryEntry) []*single_agent.AgentModelOption {
	items := make([]*single_agent.AgentModelOption, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		items = append(items, &single_agent.AgentModelOption{
			ModelKey:             entry.ModelKey,
			DisplayName:          entry.DisplayName,
			Description:          entry.Description,
			IconUri:              entry.IconUri,
			ModelType:            entry.ModelType,
			ProviderTemplateType: entry.ProviderTemplateType,
		})
	}
	return items
}
