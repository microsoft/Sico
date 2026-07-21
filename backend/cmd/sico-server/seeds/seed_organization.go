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

package seeds

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"sico-backend/internal/di"
	orgrepo "sico-backend/internal/store/organization/repository"
	"sico-backend/pkg/logger"
)

func ensureOrganization(ctx context.Context, injector *di.Injector) error {
	repo := orgrepo.NewOrganizationRepository(injector.DB)

	existing, err := repo.GetByID(ctx, defaultOrganizationId)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	if existing != nil {
		// Update if fields changed.
		if existing.Name != defaultOrganizationName || existing.Description != defaultOrganizationDesc {
			existing.Name = defaultOrganizationName
			existing.Description = defaultOrganizationDesc
			return repo.Update(ctx, existing)
		}
		return nil
	}

	org := &orgrepo.OrganizationModel{
		ID:          defaultOrganizationId,
		Name:        defaultOrganizationName,
		Description: defaultOrganizationDesc,
	}
	if err := repo.Create(ctx, org); err != nil {
		if !errors.Is(err, gorm.ErrDuplicatedKey) {
			return err
		}
		// Recover soft-deleted org.
		logger.CtxWarn(ctx, "Organization %d already exists but is marked as deleted, recovering", defaultOrganizationId)
		injector.DB.WithContext(ctx).Exec(
			"UPDATE t_organization SET deleted_at = null WHERE id = ?", defaultOrganizationId)
		return repo.Update(ctx, org)
	}
	return nil
}
