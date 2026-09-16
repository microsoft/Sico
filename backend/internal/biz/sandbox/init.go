package sandbox

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/biz/sandbox/providers"
	telemetrymetrics "sico-backend/internal/infra/telemetry/metrics"
	"sico-backend/pkg/logger"
)

var defaultSvc Service

// Default returns the singleton Sandbox application service.
func Default() Service { return defaultSvc }

func InitService(svc *impl.Service) Service {
	defaultSvc = WithTracing(svc)
	telemetrymetrics.RegisterSandboxStats(impl.NewMetricsAdapter(svc.Pool))
	logger.Info("Sandbox service initialized")
	return defaultSvc
}

// ProviderSet wires the sandbox biz service.
var ProviderSet = wire.NewSet(
	providers.NewProviders,
	impl.NewProviderRegistry,
	impl.NewPool,
	impl.NewServiceWithAccess,
	InitService,
	providers.NewIntegration,
)
