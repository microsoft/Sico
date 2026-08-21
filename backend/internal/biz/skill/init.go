package skill

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/skill/impl"
	"sico-backend/internal/store/skill/repository"
)

// InitService wires the skill application service and sets the default instance.
func InitService(components *impl.Components) Service {
	svc := impl.NewService(components)
	tracedSvc := WithTracing(svc)
	setDefault(tracedSvc)
	return tracedSvc
}

var ProviderSet = wire.NewSet(
	repository.NewSkillRepo,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
