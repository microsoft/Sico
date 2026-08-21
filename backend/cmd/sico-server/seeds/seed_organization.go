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
