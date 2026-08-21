package notification

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/notification/impl"
	"sico-backend/internal/store/notification/repository"
)

var defaultSvc Service

func Default() Service { return defaultSvc }

func InitService(components *impl.Components) Service {
	svc := impl.NewService(components)
	defaultSvc = WithTracing(svc)
	return defaultSvc
}

var ProviderSet = wire.NewSet(
	repository.NewNotificationRepo,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
