//go:build wireinject
// +build wireinject

package di

import (
	"context"

	"github.com/google/wire"

	"sico-backend/internal/di/app"
	"sico-backend/internal/di/infra"
)

func BuildInjector(ctx context.Context) (*Injector, func(), error) {
	wire.Build(
		infra.ProviderSet,
		app.ProviderSet,
		wire.Struct(new(Injector), "*"),
	)
	return new(Injector), nil, nil
}
