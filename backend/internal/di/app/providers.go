package app

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/agent"
	"sico-backend/internal/biz/authstate"
	"sico-backend/internal/biz/casereplay"
	"sico-backend/internal/biz/conversation"
	"sico-backend/internal/biz/integration"
	"sico-backend/internal/biz/knowledge"
	"sico-backend/internal/biz/llmhubs"
	"sico-backend/internal/biz/notification"
	"sico-backend/internal/biz/organization"
	"sico-backend/internal/biz/ownership"
	"sico-backend/internal/biz/project"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/biz/sandbox"
	"sico-backend/internal/biz/scheduledtask"
	"sico-backend/internal/biz/skill"
	"sico-backend/internal/biz/taskruntime"
)

var ProviderSet = wire.NewSet(
	project.ProviderSet,
	rbac.ProviderSet,
	ownership.ProviderSet,
	organization.ProviderSet,
	knowledge.ProviderSet,
	agent.ProviderSet,
	conversation.ProviderSet,
	integration.ProviderSet,
	sandbox.ProviderSet,
	llmhubs.ProviderSet,
	skill.ProviderSet,
	taskruntime.ProviderSet,
	notification.ProviderSet,
	scheduledtask.ProviderSet,
	authstate.ProviderSet,
	casereplay.ProviderSet,
)
