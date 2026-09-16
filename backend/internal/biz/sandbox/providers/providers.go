package providers

import (
	"context"

	"github.com/gin-gonic/gin"
	"google.golang.org/grpc"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
)

type Integration interface {
	RegisterHTTPRoutes(routes *gin.RouterGroup)
	RegisterReverseGRPCServices(registrar grpc.ServiceRegistrar)
}

type sandboxPool interface {
	ResolveResourceByHash(ctx context.Context, sandboxType, rid string) (*sandboximpl.Resource, error)
	UpdateResolvedResourceCache(ctx context.Context, resource *sandboximpl.Resource) error
}

type resourceProxyAuthorizer interface {
	AuthorizeResourceProxy(ctx context.Context, resource *sandboximpl.Resource) error
	AuthorizeSandboxProviderOperation(ctx context.Context) error
}

type httpRouteProvider interface {
	registerHTTPRoutes(routes *gin.RouterGroup, pool sandboxPool)
}

type authorizedHTTPRouteProvider interface {
	registerAuthorizedHTTPRoutes(
		routes *gin.RouterGroup,
		pool sandboxPool,
		authorizer resourceProxyAuthorizer,
	)
}

type Factory interface {
	Providers() []sandboximpl.Provider
	NewIntegration(
		providers []sandboximpl.Provider,
		service *sandboximpl.Service,
		pool *sandboximpl.Pool,
	) Integration
}

var factory Factory = publicFactory{}

func NewProviders() []sandboximpl.Provider {
	return factory.Providers()
}

func NewIntegration(
	providers []sandboximpl.Provider,
	service *sandboximpl.Service,
	pool *sandboximpl.Pool,
) Integration {
	return factory.NewIntegration(providers, service, pool)
}

type publicFactory struct{}

type publicIntegration struct {
	providers  []sandboximpl.Provider
	pool       sandboxPool
	authorizer resourceProxyAuthorizer
}

func (publicFactory) Providers() []sandboximpl.Provider {
	return []sandboximpl.Provider{NewEmulatorProvider(), NewLinuxWorkstationProvider()}
}

func (publicFactory) NewIntegration(
	providers []sandboximpl.Provider,
	service *sandboximpl.Service,
	pool *sandboximpl.Pool,
) Integration {
	return &publicIntegration{providers: providers, pool: pool, authorizer: service}
}

func (c *publicIntegration) RegisterHTTPRoutes(routes *gin.RouterGroup) {
	registerProviderHTTPRoutes(routes, c.providers, c.pool, c.authorizer)
}

func (*publicIntegration) RegisterReverseGRPCServices(grpc.ServiceRegistrar) {}

func registerProviderHTTPRoutes(
	routes *gin.RouterGroup,
	providers []sandboximpl.Provider,
	pool sandboxPool,
	authorizer resourceProxyAuthorizer,
) {
	sandboxRoutes := routes.Group("/sandbox")
	for _, provider := range providers {
		if routeProvider, ok := provider.(authorizedHTTPRouteProvider); ok {
			routeProvider.registerAuthorizedHTTPRoutes(sandboxRoutes, pool, authorizer)
			continue
		}
		if routeProvider, ok := provider.(httpRouteProvider); ok {
			routeProvider.registerHTTPRoutes(sandboxRoutes, pool)
		}
	}
}
