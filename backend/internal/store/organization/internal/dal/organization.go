package dal

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/organization/internal/dal/model"
)

type OrganizationDAO struct {
	db *gorm.DB
}

func NewOrganizationDAO(db *gorm.DB) *OrganizationDAO {
	return &OrganizationDAO{db: db}
}

func (d *OrganizationDAO) Create(ctx context.Context, org *model.TOrganization) error {
	return d.db.WithContext(ctx).Create(org).Error
}

func (d *OrganizationDAO) Update(ctx context.Context, org *model.TOrganization) error {
	return d.db.WithContext(ctx).Model(&model.TOrganization{}).Where("id = ?", org.ID).Updates(org).Error
}

func (d *OrganizationDAO) Delete(ctx context.Context, id int64) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.TOrganization{}).Error
}

func (d *OrganizationDAO) GetByID(ctx context.Context, id int64) (*model.TOrganization, error) {
	var org model.TOrganization
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&org).Error; err != nil {
		return nil, err
	}
	return &org, nil
}

func (d *OrganizationDAO) GetByName(ctx context.Context, name string) (*model.TOrganization, error) {
	var org model.TOrganization
	if err := d.db.WithContext(ctx).Where("name = ?", name).First(&org).Error; err != nil {
		return nil, err
	}
	return &org, nil
}

func (d *OrganizationDAO) List(
	ctx context.Context, name string, page, pageSize int32,
) ([]*model.TOrganization, int64, error) {
	q := d.db.WithContext(ctx).Model(&model.TOrganization{})
	if name != "" {
		q = q.Where("name LIKE ?", "%"+name+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 10
	}
	offset := int((page - 1) * pageSize)

	var list []*model.TOrganization
	if err := q.Offset(offset).Limit(int(pageSize)).Order("id DESC").Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}
