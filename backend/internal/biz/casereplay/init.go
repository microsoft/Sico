package casereplay

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/casereplay/impl"
	"sico-backend/internal/store/casereplay/repository"
)

func InitService(repository repository.CaseReplayRepository) Service {
	service := WithTracing(impl.NewService(repository))
	setDefault(service)

	return service
}

var ProviderSet = wire.NewSet(
	repository.NewCaseReplayRepo,
	InitService,
)
