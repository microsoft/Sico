package knowledge

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/knowledge/impl"
	"sico-backend/internal/store/knowledge/repository"
)

// InitService wires the knowledge application service and sets the default instance.
func InitService(components *impl.Components) Service {
	svc := impl.NewService(components)
	tracedSvc := WithTracing(svc)
	setDefault(tracedSvc)
	return tracedSvc
}

var ProviderSet = wire.NewSet(
	repository.NewDocumentRepo,
	repository.NewKnowledgeTagRepo,
	repository.NewDocumentTagRepo,
	repository.NewPlaybookRepo,
	repository.NewPlaybookTagRepo,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
