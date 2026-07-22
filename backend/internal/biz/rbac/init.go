// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
	defaultSvc = svc
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
