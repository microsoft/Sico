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
var defaultImpl *impl.Service

func Default() Service { return defaultSvc }

// defaultImplService returns the concrete service for internal helpers that
// need direct access to repositories (e.g. membership.go).
func defaultImplService() *impl.Service { return defaultImpl }

func InitService(components *impl.Components, cache *redis.Client) Service {
	cacheClient := sico_redis.New(cache)
	jwtAuth := jwtx.New(jwtx.NewStoreWithCache(cacheClient))
	svc := impl.NewService(components, jwtAuth)
	defaultImpl = svc
	defaultSvc = WithTracing(svc)
	return defaultSvc
}

var ProviderSet = wire.NewSet(
	repository.NewUserRepository,
	repository.NewUserRoleRepository,
	repository.NewCasbinRuleRepository,
	enforcer.ProvideCasbinEnforcer,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
