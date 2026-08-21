package di

import (
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"sico-backend/internal/biz/agent"
	"sico-backend/internal/biz/authstate"
	"sico-backend/internal/biz/casereplay"
	"sico-backend/internal/biz/conversation"
	"sico-backend/internal/biz/knowledge"
	"sico-backend/internal/biz/llmhubs"
	"sico-backend/internal/biz/notification"
	"sico-backend/internal/biz/organization"
	"sico-backend/internal/biz/project"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/biz/sandbox"
	sandboxproviders "sico-backend/internal/biz/sandbox/providers"
	"sico-backend/internal/biz/scheduledtask"
	"sico-backend/internal/biz/skill"
	"sico-backend/internal/biz/taskruntime"
	"sico-backend/internal/infra/coregrpc"
	"sico-backend/internal/infra/email"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/infra/storage"
)

type Injector struct {
	DB       *gorm.DB
	Cache    *redis.Client
	IDGen    idgen.IDGenerator
	Storage  storage.Storage
	CoreGRPC coregrpc.Connection
	Email    email.Client

	ProjectApp         project.Service
	RBACApp            rbac.Service
	OrganizationApp    organization.Service
	KnowledgeApp       knowledge.Service
	AgentApp           agent.Service
	ConversationApp    conversation.Service
	SandboxApp         sandbox.Service
	SkillApp           skill.Service
	LLMHubApp          llmhubs.Service
	TaskRuntimeApp     taskruntime.Service
	NotificationApp    notification.Service
	ScheduledTaskApp   scheduledtask.Service
	AuthStateApp       authstate.Service
	CaseReplayApp      casereplay.Service
	SandboxIntegration sandboxproviders.Integration
}
