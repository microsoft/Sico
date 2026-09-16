package rbac

import (
	"github.com/google/wire"
	"github.com/redis/go-redis/v9"

	"sico-backend/internal/biz/rbac/impl"
	sico_redis "sico-backend/internal/infra/cache/redis"
	"sico-backend/internal/store/rbac/enforcer"
	"sico-backend/internal/store/rbac/repository"
	"sico-backend/pkg/jwtx"
)

var defaultSvc Service

func Default() Service { return defaultSvc }

func NewService(components *impl.Components, cache *redis.Client) *impl.Service {
	cacheClient := sico_redis.New(cache)
	jwtAuth := jwtx.New(jwtx.NewStoreWithCache(cacheClient))
	return impl.NewService(components, jwtAuth)
}

func InitService(svc *impl.Service) Service {
	defaultSvc = WithTracing(svc)
	return defaultSvc
}

var ProviderSet = wire.NewSet(
	repository.NewUserRepository,
	repository.NewUserRoleRepository,
	repository.NewCasbinRuleRepository,
	enforcer.ProvideCasbinEnforcer,
	wire.Struct(new(impl.Components), "*"),
	NewService,
	wire.Bind(new(roleAssignmentWriter), new(*impl.Service)),
	NewAccessServices,
	InitService,
	ProvideAccess,
)
