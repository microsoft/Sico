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

package router

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/transport/http/handler"
	"sico-backend/internal/transport/http/middleware"
)

// Health is a simple handler for health check endpoint
// @Summary Health Check
// @Description Get the health status of the server
// @Tags Health
// @Success 200 {object} map[string]string
// @Router /api/sico/health [get]
func Health(ctx *gin.Context) {
	ctx.JSON(200, gin.H{"status": "ok"})
}

func RegisterAPIs(router *gin.Engine) {
	router.Use(cors.Default())

	// Health check must be registered before auth middleware
	router.GET("/api/sico/health", func(ctx *gin.Context) {
		ctx.JSON(200, gin.H{"status": "ok"})
	})

	router.Use(middleware.AuthMiddleware())
	r := router.Group("/api/sico")
	r.Use(middleware.CasbinMiddleware(rbac.Default().GetEnforcer()))

	registerSandboxRoutes(r)
	registerRBACRoutes(r)
	registerConversationRoutes(r)
	registerLLMRoutes(r)
	registerProjectRoutes(r)
	registerAgentRoutes(r)
	registerAgentsRoutes(r)
	registerKnowledgeRoutes(r)
	registerSkillsRoutes(r)

	// Swagger documentation route (public)
	r.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
}

func registerSandboxRoutes(r *gin.RouterGroup) {
	sandboxApi := r.Group("/sandbox")

	// ==================== Management APIs (Dashboard) ====================
	sandboxApi.GET("/list", handler.SandboxListAll)                // List all sandboxes by type
	sandboxApi.POST("/reset", handler.SandboxReset)                // Soft-reset a sandbox
	sandboxApi.POST("/admin/release", handler.SandboxAdminRelease) // Admin release a sandbox
	sandboxApi.GET("/docs/:type", handler.SandboxTypeDocs)         // Get API docs for sandbox type

	// Sandbox Assignment APIs (Dashboard)
	sandboxApi.POST("/assign", handler.SandboxAssign)          // Assign sandbox to instance
	sandboxApi.POST("/unassign", handler.SandboxUnassign)      // Unassign sandbox from instance
	sandboxApi.GET("/instances", handler.SandboxListInstances) // List instances for assignment dropdown

	// VNC View APIs
	sandboxApi.GET("/instance/:instanceId/vnc", handler.GetInstanceVNC) // Get VNC URLs for instance
	sandboxApi.GET("/instance", handler.SandboxGetInstanceSandboxes)    // Get instance sandboxes with status
	sandboxApi.GET("/:sandboxId/vnc", handler.GetSandboxVNC)            // Get VNC URL for sandbox

	// Emulator resource proxy - H264 WS stream + UI for HTTPS iframe embedding + API proxy
	sandboxApi.GET("/resources/emulator/:rid/vnc", handler.ResourceEmulatorUI)
	sandboxApi.GET("/resources/emulator/:rid/ws/h264", handler.ResourceEmulatorH264WS)
	sandboxApi.Any("/resources/emulator/:rid/api/*path", handler.ResourceEmulatorProxy)

	// ==================== Sandbox Client APIs (Requires X-Sico-* headers) ====================
	sandboxApi.Use(middleware.SandboxAuthMiddleware())
	sandboxApi.POST("/apply", handler.SandboxApply)     // Apply for an available sandbox
	sandboxApi.POST("/release", handler.SandboxRelease) // Release sandbox back to pool
}

func registerRBACRoutes(r *gin.RouterGroup) {
	rbacApi := r.Group("/rbac")

	rbacApi.POST("/user", handler.CreateUser)
	rbacApi.PUT("/user", handler.UpdateUser)
	rbacApi.DELETE("/user", handler.DeleteUser)
	rbacApi.GET("/user", handler.GetUser)
	rbacApi.GET("/users", handler.QueryUsers)
	rbacApi.PUT("/user/password", handler.ResetPassword)
	// role endpoints
	rbacApi.POST("/role", handler.CreateRole)
	rbacApi.PUT("/role", handler.UpdateRole)
	rbacApi.DELETE("/role", handler.DeleteRole)
	rbacApi.GET("/role", handler.GetRole)
	rbacApi.GET("/roles", handler.QueryRoles)
	// user-role assignments
	rbacApi.POST("/user_role", handler.AssignUserRole)
	rbacApi.DELETE("/user_role", handler.RemoveUserRole)
	rbacApi.GET("/user_roles", handler.ListUserRoles)
	rbacApi.GET("/role_users", handler.ListUsersByRole)
	// casbin policy
	rbacApi.POST("/policy", handler.CreatePolicy)
	rbacApi.PUT("/policy", handler.UpdatePolicy)
	rbacApi.DELETE("/policy", handler.DeletePolicy)
	rbacApi.GET("/policy", handler.GetPolicy)
	rbacApi.GET("/policies", handler.QueryPolicies)

	rbacApi.POST("/login", handler.Login)
	rbacApi.POST("/logout", handler.Logout)
	rbacApi.POST("/refresh", handler.RefreshToken)
}

func registerConversationRoutes(r *gin.RouterGroup) {
	conversation := r.Group("/conversation")

	conversation.POST("", handler.CreateConversation)
	conversation.GET("", handler.GetConversation)
	conversation.PUT("", handler.UpdateConversation)
	conversation.POST("/chat", handler.Chat)
	conversation.POST("/chat/reconnect", handler.Reconnect)
	conversation.GET("/messages", handler.ListMessagesByUserAndAgent)
	conversation.GET("/messages/user/turn", handler.GetUserMessageByUserAgentTurnID)
	conversation.GET("/batch_summaries", handler.ListBatchSummaries)
	conversation.GET("/list", handler.ListConversations)
	conversation.GET("/plan", handler.GetPlan)
	conversation.POST("/plan/cancel", handler.CancelPlan)

	onboard := conversation.Group("/onboard")
	{
		onboard.POST("/recommendation_tasks", handler.GenerateOnboardRecommendationTasks)
	}
}

func registerLLMRoutes(r *gin.RouterGroup) {
	llmApi := r.Group("/llm")

	modelsApi := llmApi.Group("/models")
	modelsApi.POST("", handler.CreateModelRegistry)
	modelsApi.DELETE("", handler.DeleteModelRegistry)

	llmApi.GET("/sdk-examples", handler.GetSdkExamples)
	llmApi.GET("/source-slots", handler.ListSourceSlots)
	llmApi.POST("/runtime/generate", handler.RuntimeGenerate)
	llmApi.POST("/runtime/generate/stream", handler.RuntimeGenerateStream)
}

func registerProjectRoutes(r *gin.RouterGroup) {
	projectApi := r.Group("/project")

	projectApi.GET("/user_projects", handler.GetUserProjectList)
	projectApi.GET("", handler.GetProject)
	projectApi.POST("", handler.CreateProject)
	projectApi.PUT("", handler.UpdateProject)
	projectApi.DELETE("", handler.DeleteProject)
	projectApi.POST("/asset", handler.AddProjectAsset)
	projectApi.GET("/sas_asset", handler.GetProjectSASAsset)
	projectApi.GET("/assets", handler.GetProjectAssetList)
	projectApi.DELETE("/asset", handler.DeleteProjectAsset)
	projectApi.GET("/statistics", handler.QueryProjectStatistics)
}

func registerAgentRoutes(r *gin.RouterGroup) {
	agentApi := r.Group("/agent")

	agentApi.POST("/single_agent", handler.CreateSingleAgent)
	agentApi.GET("/single_agent", handler.GetSingleAgent)
	agentApi.PUT("/single_agent", handler.UpdateSingleAgent)
	//agentApi.DELETE("/single_agent", handler.DeleteSingleAgent)
	agentApi.GET("/single_agents", handler.ListSingleAgents)
	agentApi.GET("/single_agent_infos", handler.ListSingleAgentInfos)
	agentApi.GET("/roles", handler.ListRoles)
	agentApi.POST("/single_agent/deploy", handler.DeploySingleAgent)

	//agentApi.POST("/single_agent_instance", handler.CreateSingleAgentInstance)
	agentApi.GET("/single_agent_instance", handler.GetSingleAgentInstance)
	agentApi.PUT("/single_agent_instance", handler.UpdateSingleAgentInstance)
	agentApi.DELETE("/single_agent_instance", handler.DeleteSingleAgentInstance)
	agentApi.GET("/single_agent_instances", handler.ListSingleAgentInstances)
}

func registerAgentsRoutes(r *gin.RouterGroup) {
	agentsApi := r.Group("/agents")
	agentsApi.GET("/:agentId/models", handler.GetSingleAgentModels)
}

func registerKnowledgeRoutes(r *gin.RouterGroup) {
	knowledgeApi := r.Group("/knowledge")

	documentApi := knowledgeApi.Group("/document")
	documentApi.POST("", handler.CreateDocument)
	documentApi.GET("", handler.GetDocument)
	documentApi.PUT("", handler.UpdateDocument)
	documentApi.DELETE("", handler.DeleteDocument)
	documentApi.GET("/details", handler.GetDocumentDetails)
	knowledgeApi.GET("/documents", handler.ListDocuments)

	knowledgeApi.POST("/tag", handler.CreateKnowledgeTag)
	knowledgeApi.PUT("/tag", handler.UpdateKnowledgeTag)
	knowledgeApi.DELETE("/tag", handler.DeleteKnowledgeTag)
	knowledgeApi.GET("/tag", handler.GetKnowledgeTag)
	knowledgeApi.GET("/tags", handler.ListKnowledgeTag)

	playbookApi := knowledgeApi.Group("/playbook")
	playbookApi.GET("", handler.GetPlaybook)
	playbookApi.PUT("", handler.UpdatePlaybook)
	playbookApi.GET("/details", handler.GetPlaybookDetails)
	knowledgeApi.GET("/playbooks", handler.ListPlaybooks)
}

func registerSkillsRoutes(r *gin.RouterGroup) {
	skillsApi := r.Group("/skills")

	skillsApi.POST("", handler.CreateSkill)
	skillsApi.GET("", handler.GetSkill)
	skillsApi.PUT("", handler.UpdateSkill)
	skillsApi.DELETE("", handler.DeleteSkill)
	skillsApi.GET("/list", handler.ListSkills)
}
