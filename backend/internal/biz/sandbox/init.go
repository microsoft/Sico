package sandbox

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/biz/sandbox/providers"
	"sico-backend/pkg/logger"
)

var defaultSvc Service

// Default returns the singleton Sandbox application service.
func Default() Service { return defaultSvc }

func InitService(svc *impl.Service) Service {
	defaultSvc = WithTracing(svc)
	logger.Info("Sandbox service initialized")
	return defaultSvc
}

// ProviderSet wires the sandbox biz service.
var ProviderSet = wire.NewSet(
	providers.NewProviders,
	impl.NewProviderRegistry,
	impl.NewPool,
	impl.NewService,
	InitService,
	providers.NewIntegration,
)
