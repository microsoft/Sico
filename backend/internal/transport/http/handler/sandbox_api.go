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
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	singleAgentSVC "sico-backend/internal/biz/agent"
	sandboxbiz "sico-backend/internal/biz/sandbox"
	saEntity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/enum"
	commondto "sico-backend/internal/transport/http/dto/common"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/internal/transport/http/middleware"
)

// ==================== Client APIs (require SandboxAuthMiddleware) ====================

// SandboxApply applies for a sandbox of the specified type
// @Summary Apply for a sandbox
// @Description Apply for a sandbox of the specified type. One instanceID can have multiple sandboxes.
// @Router /api/sico/sandbox/apply [POST]
// @Tags Sandbox
// @Accept json
// @Produce json
// @Param X-Sico-Context header string true "Instance context (JSON with agentInstanceId)"
// @Param X-Sico-Client-Id header string true "Client ID"
// @Param X-Sico-Timestamp header string true "Unix timestamp"
// @Param X-Sico-Nonce header string true "Random nonce"
// @Param X-Sico-Signature header string true "HMAC signature"
// @Param request body sandboxdto.SandboxApplyRequest true "Sandbox type to apply"
// @Success 200 {object} commondto.StandardResponse
func SandboxApply(c *gin.Context) {
	var req sandboxdto.SandboxApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(c, "invalid request body: "+err.Error())
		return
	}

	if !enum.IsValidSandboxType(req.Type) {
		invalidParamRequestResponse(c, fmt.Sprintf(
			"invalid sandbox type: %s, valid types are: %v",
			req.Type, enum.AllSandboxTypes(),
		))
		return
	}

	instanceID, ok := getSandboxInstanceID(c)
	if !ok {
		invalidParamRequestResponse(c, "instanceId not found in X-Sico-Context")
		return
	}

	svc := sandboxbiz.Default()
	result, err := svc.ApplySandbox(reqctx(c), instanceID, req.Type)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: result,
	}
	c.JSON(http.StatusOK, resp)
}

// SandboxRelease releases a sandbox so it can be re-acquired by a future apply
// @Summary Release a sandbox
// @Description Release a sandbox that was acquired via apply. The sandbox becomes available for re-use.
// @Router /api/sico/sandbox/release [POST]
// @Tags Sandbox
// @Accept json
// @Produce json
// @Param X-Sico-Context header string true "Instance context (JSON with agentInstanceId)"
// @Param X-Sico-Client-Id header string true "Client ID"
// @Param X-Sico-Timestamp header string true "Unix timestamp"
// @Param X-Sico-Nonce header string true "Random nonce"
// @Param X-Sico-Signature header string true "HMAC signature"
// @Param request body sandboxdto.SandboxReleaseRequest true "Sandbox to release"
// @Success 200 {object} commondto.StandardResponse
func SandboxRelease(c *gin.Context) {
	var req sandboxdto.SandboxReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(c, "invalid request body: "+err.Error())
		return
	}

	if req.SandboxId == "" {
		invalidParamRequestResponse(c, "sandbox_id is required")
		return
	}

	instanceID, ok := getSandboxInstanceID(c)
	if !ok {
		invalidParamRequestResponse(c, "instanceId not found in X-Sico-Context")
		return
	}

	svc := sandboxbiz.Default()
	if err := svc.ReleaseSandbox(reqctx(c), instanceID, req.SandboxId); err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
	})
}

// getSandboxInstanceID returns the instance ID from X-Sico-Context header
func getSandboxInstanceID(c *gin.Context) (string, bool) {
	if instanceID, ok := middleware.GetSandboxInstanceIDFromContext(c); ok {
		instanceID = strings.TrimSpace(instanceID)
		if instanceID != "" {
			return instanceID, true
		}
	}

	return "", false
}

// ==================== Management APIs (Dashboard 使用，不需要 SandboxAuthMiddleware) ====================

// SandboxListAll lists all sandbox resources grouped by type
// @Summary List all sandboxes
// @Description List all sandbox resources grouped by type, with status and usage info
// @Router /api/sico/sandbox/list [GET]
// @Tags Sandbox-Management
// @Produce json
// @Success 200 {object} commondto.StandardResponse{data=sandboxdto.SandboxResourcesByType}
func SandboxListAll(c *gin.Context) {
	svc := sandboxbiz.Default()
	result, err := svc.ListAllResources(reqctx(c))
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	// Enrich sandbox list with instance names for dashboard display
	enrichSandboxListWithInstanceNames(result)

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: result,
	}
	c.JSON(http.StatusOK, resp)
}

// SandboxReset soft-resets a sandbox environment (e.g. close apps on emulator)
// @Summary Reset a sandbox
// @Description Soft-reset a sandbox by sandbox ID. The lease and assignment are preserved.
// @Router /api/sico/sandbox/reset [POST]
// @Tags Sandbox-Management
// @Accept json
// @Produce json
// @Param request body sandboxdto.SandboxResetRequest true "Sandbox ID to reset"
// @Success 200 {object} commondto.StandardResponse
func SandboxReset(c *gin.Context) {
	var req sandboxdto.SandboxResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(c, "invalid request body: "+err.Error())
		return
	}

	svc := sandboxbiz.Default()
	err := svc.ResetSandbox(reqctx(c), "", req.SandboxId)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: map[string]any{
			"message":    "Sandbox reset successfully",
			"sandbox_id": req.SandboxId,
		},
	}
	c.JSON(http.StatusOK, resp)
}

// SandboxAdminRelease releases an in-use sandbox from dashboard (management operation)
// @Summary Admin release a sandbox
// @Description Release a sandbox from in-use state while preserving assignment mapping.
// @Router /api/sico/sandbox/admin/release [POST]
// @Tags Sandbox-Management
// @Accept json
// @Produce json
// @Param request body sandboxdto.SandboxUnassignRequest true "Release request (instance_id + sandbox_id)"
// @Success 200 {object} commondto.StandardResponse
func SandboxAdminRelease(c *gin.Context) {
	var req sandboxdto.SandboxUnassignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(c, "invalid request body: "+err.Error())
		return
	}

	svc := sandboxbiz.Default()
	if err := svc.ReleaseSandbox(reqctx(c), req.InstanceId, req.SandboxId); err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: map[string]any{
			"message":     "Sandbox released successfully",
			"sandbox_id":  req.SandboxId,
			"instance_id": req.InstanceId,
		},
	}
	c.JSON(http.StatusOK, resp)
}

// ==================== VNC / View APIs ====================

// GetInstanceVNC gets VNC URLs for all sandboxes of an instance
// @Summary Get instance VNC URLs
// @Description Get VNC URLs for all sandboxes associated with an instance
// @Router /api/sico/sandbox/instance/{instanceId}/vnc [GET]
// @Tags Sandbox-View
// @Produce json
// @Param instanceId path string true "Instance ID"
// @Success 200 {object} commondto.StandardResponse{data=[]sandboxdto.SandboxVNCInfo}
func GetInstanceVNC(c *gin.Context) {
	instanceID := c.Param("instanceId")
	if instanceID == "" {
		invalidParamRequestResponse(c, "instanceId is required")
		return
	}

	svc := sandboxbiz.Default()
	result, err := svc.GetInstanceVNCURLs(reqctx(c), instanceID)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: result,
	}
	c.JSON(http.StatusOK, resp)
}

// SandboxGetInstanceSandboxes returns all sandboxes for an instance with type and status.
// Uses the query-param route `/api/sico/sandbox/instance?instanceId=...`.
// @Summary Get instance sandboxes
// @Description Get all sandboxes assigned to an instance with type, status, and endpoint info.
// @Description If type query param is provided, only sandboxes of that type are returned.
// @Router /api/sico/sandbox/instance [GET]
// @Tags Sandbox
// @Produce json
// @Param request query sandboxdto.GetInstanceSandboxesRequest true "Instance sandbox query"
// @Success 200 {object} sandboxdto.GetInstanceSandboxesResponse
func SandboxGetInstanceSandboxes(c *gin.Context) {
	var req sandboxdto.GetInstanceSandboxesRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(c, "invalid query params: "+err.Error())
		return
	}

	instanceID := strings.TrimSpace(req.InstanceId)
	if instanceID == "" {
		invalidParamRequestResponse(c, "instanceId is required")
		return
	}

	typeFilter := strings.TrimSpace(req.Type)

	svc := sandboxbiz.Default()
	result, err := svc.GetInstanceSandboxesWithStatus(reqctx(c), instanceID, typeFilter)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	items := make([]*sandboxdto.InstanceSandboxStatusInfo, 0, len(result))
	for _, info := range result {
		items = append(items, &sandboxdto.InstanceSandboxStatusInfo{
			SandboxId:   getMapString(info, "sandbox_id"),
			Type:        getMapString(info, "type"),
			Status:      getMapString(info, "status"),
			Endpoint:    getMapString(info, "endpoint"),
			VncUrl:      getMapString(info, "vnc_url"),
			DocsUrl:     getMapString(info, "docs_url"),
			DisplayName: getMapString(info, "display_name"),
		})
	}

	c.JSON(http.StatusOK, &sandboxdto.GetInstanceSandboxesResponse{
		Data: &sandboxdto.GetInstanceSandboxesData{Items: items},
		Code: 0,
		Msg:  "success",
	})
}

func getMapString(m map[string]interface{}, key string) string {
	if value, ok := m[key]; ok {
		if stringValue, ok := value.(string); ok {
			return stringValue
		}
	}
	return ""
}

// GetSandboxVNC gets VNC URL for a specific sandbox
// @Summary Get sandbox VNC URL
// @Description Get VNC URL for a specific sandbox by ID
// @Router /api/sico/sandbox/{sandboxId}/vnc [GET]
// @Tags Sandbox-View
// @Produce json
// @Param sandboxId path string true "Sandbox ID"
// @Success 200 {object} commondto.StandardResponse{data=sandboxdto.SandboxVNCInfo}
func GetSandboxVNC(c *gin.Context) {
	sandboxID := c.Param("sandboxId")
	if sandboxID == "" {
		invalidParamRequestResponse(c, "sandboxId is required")
		return
	}

	svc := sandboxbiz.Default()
	result, err := svc.GetSandboxVNCURL(reqctx(c), sandboxID)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: result,
	}
	c.JSON(http.StatusOK, resp)
}

// ==================== Sandbox Type Documentation ====================

// SandboxTypeDocs returns OpenAPI documentation for a specific sandbox type
// @Summary Get sandbox type API documentation
// @Description Returns the OpenAPI spec for a sandbox type (fetched from an available sandbox instance)
// @Router /api/sico/sandbox/docs/{type} [GET]
// @Tags Sandbox
// @Produce json
// @Param type path string true "Sandbox type (emulator)"
// @Success 200 {object} object "OpenAPI JSON spec"
func SandboxTypeDocs(c *gin.Context) {
	sandboxType := strings.ToLower(strings.TrimSpace(c.Param("type")))
	if sandboxType == "" {
		invalidParamRequestResponse(c, "type is required")
		return
	}

	if !enum.IsValidSandboxType(sandboxType) {
		invalidParamRequestResponse(c, fmt.Sprintf(
			"invalid sandbox type: %s, valid types are: %v",
			sandboxType, enum.AllSandboxTypes(),
		))
		return
	}

	svc := sandboxbiz.Default()
	data, err := svc.GetSandboxOpenAPI(reqctx(c), sandboxType)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	// Return raw OpenAPI JSON
	c.Data(http.StatusOK, "application/json", data)
}

// ==================== Sandbox Assignment APIs (Dashboard) ====================

// SandboxAssign assigns a sandbox to an agent instance (dashboard operation)
// @Summary Assign sandbox to instance
// @Description Manually assign a sandbox to an agent instance from the dashboard.
// @Description The sandbox will be reserved for the specified instance.
// @Router /api/sico/sandbox/assign [POST]
// @Tags Sandbox-Management
// @Accept json
// @Produce json
// @Param request body sandboxdto.SandboxAssignRequest true "Assignment request"
// @Success 200 {object} commondto.StandardResponse
func SandboxAssign(c *gin.Context) {
	var req sandboxdto.SandboxAssignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(c, "invalid request body: "+err.Error())
		return
	}

	svc := sandboxbiz.Default()
	err := svc.AssignSandbox(reqctx(c), req.InstanceId, req.SandboxId)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: map[string]any{
			"message":     "Sandbox assigned successfully",
			"sandbox_id":  req.SandboxId,
			"instance_id": req.InstanceId,
		},
	}
	c.JSON(http.StatusOK, resp)
}

// SandboxUnassign removes a sandbox assignment from an agent instance (dashboard operation)
// @Summary Unassign sandbox from instance
// @Description Remove a sandbox assignment from an agent instance and release the sandbox.
// @Router /api/sico/sandbox/unassign [POST]
// @Tags Sandbox-Management
// @Accept json
// @Produce json
// @Param request body sandboxdto.SandboxUnassignRequest true "Unassignment request"
// @Success 200 {object} commondto.StandardResponse
func SandboxUnassign(c *gin.Context) {
	var req sandboxdto.SandboxUnassignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(c, "invalid request body: "+err.Error())
		return
	}

	svc := sandboxbiz.Default()
	err := svc.UnassignSandbox(reqctx(c), req.InstanceId, req.SandboxId)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: map[string]any{
			"message":     "Sandbox unassigned successfully",
			"sandbox_id":  req.SandboxId,
			"instance_id": req.InstanceId,
		},
	}
	c.JSON(http.StatusOK, resp)
}

// SandboxListAllWithNames lists all sandbox resources with instance name resolution.
// This wraps the existing SandboxListAll and enriches the response with instance names.
func enrichSandboxListWithInstanceNames(resources map[string]interface{}) {
	// Collect all unique instanceIDs from the resource lists
	instanceIDs := collectSandboxInstanceIDs(resources)

	if len(instanceIDs) == 0 {
		return
	}

	// Resolve instance IDs to names for display only. Stale cleanup runs in a
	// background job rather than as a side effect of this read request.
	nameMap := resolveInstanceNames(instanceIDs)

	applyInstanceNamesToResources(resources, nameMap)
}

// collectSandboxInstanceIDs extracts the unique instance_id values from resource lists.
func collectSandboxInstanceIDs(resources map[string]interface{}) map[string]struct{} {
	instanceIDs := map[string]struct{}{}

	for _, typeResources := range resources {
		list, ok := typeResources.([]map[string]interface{})
		if !ok {
			continue
		}
		for _, info := range list {
			if id, ok := info["instance_id"].(string); ok && id != "" {
				instanceIDs[id] = struct{}{}
			}
		}
	}

	return instanceIDs
}

// applyInstanceNamesToResources fills instance_name on each resource entry using nameMap.
func applyInstanceNamesToResources(resources map[string]interface{}, nameMap map[string]string) {
	for _, typeResources := range resources {
		list, ok := typeResources.([]map[string]interface{})
		if !ok {
			continue
		}
		for _, info := range list {
			if id, ok := info["instance_id"].(string); ok && id != "" {
				if name, found := nameMap[id]; found {
					info["instance_name"] = name
				}
			}
		}
	}
}

// resolveInstanceNames resolves a set of instance IDs (strings) to their names.
func resolveInstanceNames(instanceIDs map[string]struct{}) map[string]string {
	nameMap := make(map[string]string)
	agentSvc := singleAgentSVC.Default()
	if agentSvc == nil {
		return nameMap
	}

	// Parse string IDs to int64 and batch query
	var ids []int64
	for idStr := range instanceIDs {
		if id, err := strconv.ParseInt(idStr, 10, 64); err == nil {
			ids = append(ids, id)
		}
	}

	if len(ids) == 0 {
		return nameMap
	}

	resolvedNames, err := agentSvc.GetSingleAgentInstanceNames(contextBackground(), ids)
	if err != nil {
		return nameMap
	}

	for id, name := range resolvedNames {
		idStr := strconv.FormatInt(id, 10)
		if _, needed := instanceIDs[idStr]; needed {
			nameMap[idStr] = name
		}
	}

	return nameMap
}

// contextBackground returns context.Background for best-effort lookups.
func contextBackground() context.Context {
	return context.Background()
}

// SandboxListInstances lists agent instances for sandbox assignment dropdown.
// Returns a simplified list of instance ID + name for the dashboard assign dialog.
// @Summary List agent instances for sandbox assignment
// @Description Returns a list of active agent instances (id and name) for sandbox assignment.
// @Router /api/sico/sandbox/instances [GET]
// @Tags Sandbox-Management
// @Produce json
// @Success 200 {object} commondto.StandardResponse{data=[]sandboxdto.SandboxInstanceInfo}
func SandboxListInstances(c *gin.Context) {
	agentSvc := singleAgentSVC.Default()
	if agentSvc == nil {
		internalServerErrorResponse(c, fmt.Errorf("agent service not available"))
		return
	}

	// List all instances (non-deleted) for the dropdown
	instances, _, err := agentSvc.ListSingleAgentInstancesByFilter(reqctx(c), &saEntity.ListSingleAgentInstanceFilter{}, 0, 0)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	// Build simplified list using proto types
	var list []*sandboxdto.SandboxInstanceInfo
	for _, inst := range instances {
		if inst == nil {
			continue
		}
		instanceID := strconv.FormatInt(inst.Id, 10)
		info := &sandboxdto.SandboxInstanceInfo{
			Id:   instanceID,
			Name: inst.Name,
			Role: inst.Role,
		}
		// Enrich with assigned sandboxes from Redis
		info.Sandboxes = getInstanceSandboxes(reqctx(c), instanceID)
		list = append(list, info)
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: list,
	}
	c.JSON(http.StatusOK, resp)
}
