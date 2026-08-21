package organization

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/organization/impl"
	"sico-backend/internal/store/organization/repository"
)

var defaultSvc Service

// Default returns the initialized organization service instance.
func Default() Service { return defaultSvc }

// InitService wires dependencies and publishes the organization service singleton.
func InitService(components *impl.Components) Service {
	svc := impl.NewService(components)
	defaultSvc = WithTracing(svc)
	return defaultSvc
}

var ProviderSet = wire.NewSet(
	repository.NewOrganizationRepository,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
