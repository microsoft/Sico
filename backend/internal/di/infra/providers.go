package infra

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/wire"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"sico-backend/internal/consts"
	sico_redis "sico-backend/internal/infra/cache/redis"
	"sico-backend/internal/infra/coregrpc"
	"sico-backend/internal/infra/cron"
	"sico-backend/internal/infra/email"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/infra/mysql"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/enum"
	"sico-backend/pkg/logger"
)

var ProviderSet = wire.NewSet(
	ProvideDB,
	ProvideRedisClient,
	ProvideIDGenerator,
	ProvideEmailClient,
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

func ProvideEmailClient() (email.Client, error) {
	return email.NewClient()
}

func ProvideBlobStorage(ctx context.Context) (storage.Storage, error) {
	storageType := enum.StorageTypeSeaweedFS
	switch strings.ToLower(strings.TrimSpace(os.Getenv(consts.StorageType))) {
	case "", "seaweedfs":
	case "azure_blob", "blob":
		storageType = enum.StorageTypeAzureBlob
	default:
		return nil, fmt.Errorf("unsupported storage type %q", os.Getenv(consts.StorageType))
	}
	return storage.New(ctx, storageType)
}

func ProvideCoreGRPCConnection() (coregrpc.Connection, error) {
	return coregrpc.New(), nil
}

func ProvideCron() (cron.Cron, func(), error) {
	runner := cron.NewCron()
	runner.Start()
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := runner.Stop(ctx); err != nil {
			logger.CtxError(ctx, "failed to stop cron runner: %v", err)
		}
	}
	return runner, cleanup, nil
}
