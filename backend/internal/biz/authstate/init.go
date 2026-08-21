package authstate

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/authstate/impl"
	"sico-backend/internal/store/authstate/repository"
)

func InitService(components *impl.Components) Service {
	service := WithTracing(impl.NewService(components))
	setDefault(service)

	return service
}

var ProviderSet = wire.NewSet(
	repository.NewAuthStateRepo,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
