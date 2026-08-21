package router

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"

	"sico-backend/internal/biz/rbac"
	sandboxproviders "sico-backend/internal/biz/sandbox/providers"
	"sico-backend/internal/transport/http/handler"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/env"
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

func RegisterAPIs(router *gin.Engine, sandboxIntegration sandboxproviders.Integration) {
	router.Use(otelgin.Middleware(env.GetOrDefault("OTEL_SERVICE_NAME", "sico-backend")))
	router.Use(cors.Default())

	// Health check must be registered before auth middleware
	router.GET("/api/sico/health", func(ctx *gin.Context) {
		ctx.JSON(200, gin.H{"status": "ok"})
	})
	registerPublicAuthStateRoutes(router)

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
	registerOrganizationRoutes(r)
	registerNotificationRoutes(r)
	registerScheduledTaskRoutes(r)
	registerAuthStateRoutes(r)
	sandboxIntegration.RegisterHTTPRoutes(r)

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

	// Organization / Project sandbox assignment
	sandboxApi.POST("/org/assign", handler.SandboxOrgAssign)
	sandboxApi.POST("/org/unassign", handler.SandboxOrgUnassign)
	sandboxApi.POST("/project/assign", handler.SandboxProjectAssign)
	sandboxApi.POST("/project/unassign", handler.SandboxProjectUnassign)

	// VNC View APIs
	sandboxApi.GET("/instance/:instanceId/vnc", handler.GetInstanceVNC) // Get VNC URLs for instance
	sandboxApi.GET("/instance", handler.SandboxGetInstanceSandboxes)    // Get instance sandboxes with status
	sandboxApi.GET("/:sandboxId/vnc", handler.GetSandboxVNC)            // Get VNC URL for sandbox

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
	// enforcer management
	rbacApi.POST("/enforcer/reload", handler.ReloadEnforcer)

	rbacApi.POST("/login", handler.Login)
	rbacApi.POST("/logout", handler.Logout)
	rbacApi.POST("/refresh", handler.RefreshToken)
}

func registerConversationRoutes(r *gin.RouterGroup) {
	conversation := r.Group("/conversation")

	conversation.POST("", handler.CreateConversation)
	conversation.GET("", handler.GetConversation)
	conversation.PUT("", handler.UpdateConversation)
	conversation.DELETE("", handler.DeleteConversation)
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

func registerNotificationRoutes(r *gin.RouterGroup) {
	r.POST("/notification", handler.CreateNotification)
	r.PUT("/notification/status", handler.UpdateNotificationStatus)
	r.GET("/notifications", handler.ListNotification)
	r.GET("/project/notifications", handler.ListProjectNotifications)
	r.PUT("/notification/read-all", handler.ReadAllNotifications)
}

func registerAuthStateRoutes(r *gin.RouterGroup) {
	authStateApi := r.Group("/auth-state")
	authStateApi.GET("", handler.GetAuthState)
	authStateApi.POST("/status", handler.UpdateAuthStateStatus)
}

func registerPublicAuthStateRoutes(router *gin.Engine) {
	router.POST("/api/sico/auth-state/import", handler.ImportAuthState)
}

func registerScheduledTaskRoutes(r *gin.RouterGroup) {
	tasks := r.Group("/scheduled-tasks")
	tasks.POST("", handler.CreateScheduledTask)
	tasks.GET("", handler.GetScheduledTask)
	tasks.PUT("", handler.UpdateScheduledTask)
	tasks.DELETE("", handler.DeleteScheduledTask)
	tasks.GET("/list", handler.ListScheduledTasks)
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

	orgConfigApi := llmApi.Group("/org-config")
	orgConfigApi.POST("", handler.SetOrganizationLLMConfig)
	orgConfigApi.GET("", handler.GetOrganizationLLMConfig)
}

func registerProjectRoutes(r *gin.RouterGroup) {
	projectApi := r.Group("/project")

	projectApi.GET("/list", handler.ListProjects)
	projectApi.GET("/user_projects", handler.GetUserProjectList)
	projectApi.GET("", handler.GetProject)
	projectApi.POST("", handler.CreateProject)
	projectApi.PUT("", handler.UpdateProject)
	projectApi.DELETE("", handler.DeleteProject)
	projectApi.POST("/asset", handler.AddProjectAsset)
	projectApi.POST("/asset/upload_url", handler.CreateProjectAssetUploadURL)
	projectApi.POST("/asset/complete", handler.CompleteProjectAssetUpload)
	projectApi.GET("/sas_asset", handler.GetProjectSASAsset)
	projectApi.GET("/assets", handler.GetProjectAssetList)
	projectApi.DELETE("/asset", handler.DeleteProjectAsset)
	projectApi.GET("/statistics", handler.QueryProjectStatistics)
	projectApi.POST("/deliverable", handler.CreateProjectDeliverable)
	projectApi.GET("/deliverable", handler.GetProjectDeliverable)
	projectApi.DELETE("/deliverable", handler.DeleteProjectDeliverable)
	projectApi.GET("/deliverables", handler.ListProjectDeliverables)
}

func registerAgentRoutes(r *gin.RouterGroup) {
	agentApi := r.Group("/agent")

	agentApi.POST("/single_agent", handler.CreateSingleAgent)
	agentApi.GET("/single_agent", handler.GetSingleAgent)
	agentApi.PUT("/single_agent", handler.UpdateSingleAgent)
	agentApi.DELETE("/single_agent", handler.DeleteSingleAgent)
	agentApi.GET("/single_agents", handler.ListSingleAgents)
	agentApi.GET("/single_agent_infos", handler.ListSingleAgentInfos)
	agentApi.GET("/roles", handler.ListRoles)
	agentApi.POST("/single_agent/deploy", handler.DeploySingleAgent)
	agentApi.POST("/single_agent/publish", handler.PublishSingleAgent)

	agentApi.POST("/single_agent_instance", handler.CreateSingleAgentInstance)
	agentApi.GET("/single_agent_instance", handler.GetSingleAgentInstance)
	agentApi.PUT("/single_agent_instance", handler.UpdateSingleAgentInstance)
	agentApi.DELETE("/single_agent_instance", handler.DeleteSingleAgentInstance)
	agentApi.POST("/single_agent_instance/dismiss", handler.DismissSingleAgentInstance)
	agentApi.PUT("/single_agent_instance/status", handler.UpdateSingleAgentInstanceStatus)
	agentApi.POST("/single_agent_instance/reassign", handler.ReassignSingleAgentInstance)
	agentApi.GET("/single_agent_instances", handler.ListSingleAgentInstances)
}

func registerAgentsRoutes(r *gin.RouterGroup) {
	// Agent-level model binding removed; models are now configured at the organization level.
	_ = r
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
	playbookApi.DELETE("", handler.DeletePlaybook)
	playbookApi.GET("/details", handler.GetPlaybookDetails)
	knowledgeApi.GET("/playbooks", handler.ListPlaybooks)
	knowledgeApi.GET("/items", handler.ListKnowledgeItems)
}

func registerSkillsRoutes(r *gin.RouterGroup) {
	skillsApi := r.Group("/skills")

	skillsApi.POST("", handler.CreateSkill)
	skillsApi.GET("", handler.GetSkill)
	skillsApi.PUT("", handler.UpdateSkill)
	skillsApi.DELETE("", handler.DeleteSkill)
	skillsApi.GET("/list", handler.ListSkills)
}

func registerOrganizationRoutes(r *gin.RouterGroup) {
	orgApi := r.Group("/organization")
	{
		orgApi.GET("/user_organizations", handler.GetUserOrganizationList)
		orgApi.POST("", handler.CreateOrganization)
		orgApi.PUT("", handler.UpdateOrganization)
		orgApi.DELETE("", handler.DeleteOrganization)
		orgApi.GET("", handler.GetOrganization)
	}
	r.GET("/organizations", handler.ListOrganizations)
}
