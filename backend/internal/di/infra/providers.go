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

package infra

import (
	"context"

	"github.com/google/wire"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	sico_redis "sico-backend/internal/infra/cache/redis"
	"sico-backend/internal/infra/coregrpc"
	"sico-backend/internal/infra/cron"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/infra/mysql"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/enum"
)

var ProviderSet = wire.NewSet(
	ProvideDB,
	ProvideRedisClient,
	ProvideIDGenerator,
	ProvideBlobStorage,
	ProvideCoreGRPCConnection,
	ProvideCron,
)

func ProvideDB(ctx context.Context) (*gorm.DB, func(), error) {
	db, err := mysql.New()
	if err != nil {
		return nil, nil, err
	}

	cleanup := func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	}

	return db, cleanup, nil
}

func ProvideRedisClient() (*redis.Client, func(), error) {
	client := sico_redis.NewFromEnvironment()
	cleanup := func() {
		_ = client.Close()
	}

	return client, cleanup, nil
}

func ProvideIDGenerator(client *redis.Client) (idgen.IDGenerator, error) {
	return idgen.NewIDGen(client)
}

func ProvideBlobStorage(ctx context.Context) (storage.Storage, error) {
	return storage.New(ctx, enum.StorageTypeSeaweedFS)
}

func ProvideCoreGRPCConnection() (coregrpc.Connection, error) {
	return coregrpc.New(), nil
}

func ProvideCron() (cron.Cron, func(), error) {
	cron := cron.NewCron()
	cleanup := func() {
		if stopper, ok := cron.(interface{ Stop() }); ok {
			stopper.Stop()
		}
	}
	return cron, cleanup, nil
}
