package conversation

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/conversation/impl"
	convRepo "sico-backend/internal/store/conversation/conversation/repository"
	msgRepo "sico-backend/internal/store/conversation/message/repository"
)

var defaultSvc Service

// Default returns the singleton conversation business service.
func Default() Service { return defaultSvc }

// InitService wires dependencies and stores them in the default conversation service instance.
func InitService(components *impl.Components) Service {
	if components == nil {
		return nil
	}

	svc := impl.NewService(components)
	defaultSvc = WithTracing(svc)
	return defaultSvc
}

var ProviderSet = wire.NewSet(
	msgRepo.NewMessageRepo,
	convRepo.NewConversationRepo,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
