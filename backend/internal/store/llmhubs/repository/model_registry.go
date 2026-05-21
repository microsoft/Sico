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

package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/llmhubs/internal/dal"
)

// Type aliases for the GORM models.
type ModelRegistryModel = dal.ModelRegistry
type ModelRegistrySecretModel = dal.ModelRegistrySecret

// ModelRegistryFilter represents query filters for listing models.
type ModelRegistryFilter = dal.ModelRegistryFilter

// ModelRegistryRepository defines data access for the model registry.
type ModelRegistryRepository interface {
	Create(ctx context.Context, m *ModelRegistryModel) (int64, error)
	GetByID(ctx context.Context, id int64) (*ModelRegistryModel, error)
	GetByModelKey(ctx context.Context, modelKey string) (*ModelRegistryModel, error)
	ExistsByModelKey(ctx context.Context, modelKey string) (bool, error)
	List(ctx context.Context, filter *ModelRegistryFilter) ([]*ModelRegistryModel, int64, error)
	Delete(ctx context.Context, id int64) error
}

// ModelRegistrySecretRepository defines data access for model secrets.
type ModelRegistrySecretRepository interface {
	UpsertSecrets(ctx context.Context, registryID int64, secrets []*ModelRegistrySecretModel) error
	GetSecrets(ctx context.Context, registryID int64) ([]*ModelRegistrySecretModel, error)
	DeleteSecrets(ctx context.Context, registryID int64) error
}

// NewModelRegistryRepo creates a new ModelRegistryRepository backed by MySQL.
func NewModelRegistryRepo(db *gorm.DB) ModelRegistryRepository {
	return dal.NewModelRegistryDAO(db)
}

// NewModelRegistrySecretRepo creates a new ModelRegistrySecretRepository backed by MySQL.
func NewModelRegistrySecretRepo(db *gorm.DB) ModelRegistrySecretRepository {
	return dal.NewModelRegistrySecretDAO(db)
}

// IsNotFoundErr reports whether the error is a GORM record-not-found error.
func IsNotFoundErr(err error) bool { return dal.IsNotFoundErr(err) }
