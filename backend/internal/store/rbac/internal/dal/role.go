package dal

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/rbac/internal/dal/model"
)

type RoleDAO struct {
	db *gorm.DB
}

func NewRoleDAO(db *gorm.DB) *RoleDAO {
	return &RoleDAO{db: db}
}

func (d *RoleDAO) CreateRole(ctx context.Context, role *model.TRole) error {
	return d.db.WithContext(ctx).Create(role).Error
}

func (d *RoleDAO) UpdateRole(ctx context.Context, role *model.TRole) error {
	return d.db.WithContext(ctx).Model(&model.TRole{}).Where("id = ?", role.ID).Updates(role).Error
}

func (d *RoleDAO) DeleteRole(ctx context.Context, id int64) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.TRole{}).Error
}

func (d *RoleDAO) GetRole(ctx context.Context, id int64) (*model.TRole, error) {
	var r model.TRole
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&r).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

func (d *RoleDAO) GetRoleByCode(ctx context.Context, code string) (*model.TRole, error) {
	var r model.TRole
	if err := d.db.WithContext(ctx).Where("code = ?", code).First(&r).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

func (d *RoleDAO) QueryRoles(
	ctx context.Context, code, name string, status *int32, page, pageSize int32,
) ([]*model.TRole, int64, error) {
	q := d.db.WithContext(ctx).Model(&model.TRole{})

	if code != "" {
		q = q.Where("code LIKE ?", "%"+code+"%")
	}
	if name != "" {
		q = q.Where("name LIKE ?", "%"+name+"%")
	}
	if status != nil {
		q = q.Where("status = ?", *status)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := int((page - 1) * pageSize)
	var roles []*model.TRole
	if err := q.Offset(offset).Limit(int(pageSize)).Find(&roles).Error; err != nil {
		return nil, 0, err
	}

	return roles, total, nil
}
