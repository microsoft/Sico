package project

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/project/impl"
	"sico-backend/internal/store/project/repository"
)

var defaultSvc Service

// Default returns the initialized project service instance.
func Default() Service { return defaultSvc }

// InitService wires dependencies and publishes the project service singleton.
func InitService(components *impl.Components) Service {
	svc := impl.NewService(components)
	defaultSvc = WithTracing(svc)
	return defaultSvc
}

var ProviderSet = wire.NewSet(
	repository.NewProjectRepo,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
