package storage

import (
	"context"
	"fmt"
	"io"
	"strings"

	"sico-backend/internal/consts"
	"sico-backend/internal/shared/enum"
	"sico-backend/pkg/env"
)

// ObjectKey <-> Path <-> URL

// DefaultPathPrefix is the path prefix used for objects that aren't scoped to
// a specific project. Mirrors the per-implementation default (see e.g.
// seaweedfs.go newSeaweedFS) AND the t_project_asset.project_id column default,
// so that empty-projectId uploads round-trip consistently between storage and
// the database.
const DefaultPathPrefix = "default_space"

type Storage interface {
	// PutObject returns a path
	PutObject(ctx context.Context, objectKey string, content []byte, opts ...PutOptFn) (string, error)
	UploadObject(ctx context.Context, objectKey string, content io.Reader, opts ...PutOptFn) (*UploadedObject, error)
	CreateUploadURL(ctx context.Context, objectKey string, opts ...PutOptFn) (*UploadURL, error)
	GetObject(ctx context.Context, objectKey string, opts ...GetOptFn) ([]byte, error)
	GetObjectInfo(ctx context.Context, objectKey string, opts ...GetOptFn) (*ObjectInfo, error)
	DeleteObject(ctx context.Context, objectKey string, opts ...DelOptFn) error
	GetObjectUrl(ctx context.Context, objectKey string, opts ...GetOptFn) (string, error)
	GetObjectUrlByPath(ctx context.Context, path string) (string, error)
	DelObjectByPath(ctx context.Context, path string) error
}

var defaultStorage Storage

func Default() Storage { return defaultStorage }

func SetDefault(s Storage) { defaultStorage = s }

func New(ctx context.Context, storageType enum.StorageType) (Storage, error) {
	if defaultStorage != nil {
		return defaultStorage, nil
	}
	switch storageType {
	case enum.StorageTypeSeaweedFS:
		storage, err := newSeaweedFS(
			ctx,
			env.MustGet(consts.SeaweedFSEndpoint),
		)
		if err != nil {
			panic(fmt.Sprintf("failed to initialize SeaweedFS Storage: %v", err))
		}
		defaultStorage = storage
	case enum.StorageTypeAzureBlob:
		storage, err := newAzureBlob(
			ctx,
			env.MustGet(consts.AzureBlobEndpoint),
			env.MustGet(consts.AzureBlobContainer),
			env.GetOrDefault(consts.AzureBlobCDNEndpoint, ""),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to initialize Azure Blob Storage: %w", err)
		}
		defaultStorage = storage
	default:
		panic(fmt.Sprintf("unknown storage type: %s", storageType))
	}
	return defaultStorage, nil
}

func PathToUrl(path string) (string, error) {
	return defaultStorage.GetObjectUrlByPath(context.Background(), path)
}

func buildObjectPath(prefix, objectKey string) string {
	if prefix == "" {
		return strings.TrimPrefix(objectKey, "/")
	}
	if objectKey == "" {
		return strings.TrimSuffix(prefix, "/")
	}

	normalizedPrefix := strings.TrimSuffix(prefix, "/")
	normalizedObjectKey := strings.TrimPrefix(objectKey, "/")

	return normalizedPrefix + "/" + normalizedObjectKey
}
