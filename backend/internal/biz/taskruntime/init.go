package taskruntime

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/taskruntime/impl"
	taskruntimerepo "sico-backend/internal/store/taskruntime/repository"
	"sico-backend/pkg/logger"
)

var defaultSvc Service

// Default returns the singleton task runtime service.
func Default() Service { return defaultSvc }

func InitService(svc *impl.Service) Service {
	defaultSvc = WithTracing(svc)
	logger.Info("Task runtime service initialized")
	return defaultSvc
}

// ProviderSet wires the task runtime persistence service: the store-layer
// repository, the reverse-gRPC adapter over it, and the singleton installer.
var ProviderSet = wire.NewSet(
	taskruntimerepo.NewTaskRuntimeRepo,
	impl.NewService,
	InitService,
)
