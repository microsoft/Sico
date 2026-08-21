package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/organization/internal/dal"
	"sico-backend/internal/store/organization/internal/dal/model"
)

type OrganizationModel = model.TOrganization

type OrganizationRepository interface {
	Create(ctx context.Context, org *OrganizationModel) error
	Update(ctx context.Context, org *OrganizationModel) error
	Delete(ctx context.Context, id int64) error
	GetByID(ctx context.Context, id int64) (*OrganizationModel, error)
	GetByIDs(ctx context.Context, ids []int64) ([]*OrganizationModel, error)
	GetByName(ctx context.Context, name string) (*OrganizationModel, error)
	List(ctx context.Context, name string, page, pageSize int32) ([]*OrganizationModel, int64, error)
}

func NewOrganizationRepository(db *gorm.DB) OrganizationRepository {
	return WithTracingOrganizationRepository(dal.NewOrganizationDAO(db))
}
