package integration

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/integration/impl"
	"sico-backend/internal/store/integration/repository"
)

var defaultSvc Service

func Default() Service { return defaultSvc }

func InitService(components *impl.Components) Service {
	defaultSvc = WithTracing(impl.NewService(components))
	return defaultSvc
}

var ProviderSet = wire.NewSet(
	repository.NewRepository,
	azuredevops.NewConnector,
	wire.Bind(new(impl.AzureDevOpsConnector), new(*azuredevops.Connector)),
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
