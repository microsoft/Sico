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

package storage

import (
	"context"
	"fmt"
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
	GetObject(ctx context.Context, objectKey string, opts ...GetOptFn) ([]byte, error)
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
