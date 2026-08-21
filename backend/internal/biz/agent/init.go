package agent

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/agent/impl"
	"sico-backend/internal/store/agent/singleagent/repository"
)

var defaultFullSvc *impl.Service

// DefaultFull returns the full agent service implementation (for handlers that need CRUD).
func DefaultFull() *impl.Service { return defaultFullSvc }

// InitService wires the agent service and sets the default singleton.
func InitService(svc *impl.Service) Service {
	defaultFullSvc = svc
	tracedSvc := WithTracing(svc)
	SetDefault(tracedSvc)
	return tracedSvc
}

// ProviderSet wires the agent biz service.
var ProviderSet = wire.NewSet(
	repository.NewSingleAgentRepo,
	repository.NewSingleAgentInstanceRepo,
	wire.Struct(new(impl.Components), "*"),
	impl.NewService,
	InitService,
)
